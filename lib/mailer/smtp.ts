/**
 * 极简 SMTP 客户端（Cloudflare Workers / Node 双端可用）。
 *
 * 为什么不用 nodemailer：它依赖 Node 的 net/tls 模块，Workers 下不可用；
 * Resend 之外的自建 SMTP 在 Workers 上只能走 `cloudflare:sockets` 的
 * connect() 原生 TCP。因此这里手写会话（EHLO → AUTH LOGIN → MAIL/RCPT/
 * DATA → QUIT，隐式 TLS），socket 通过参数注入：
 * - Worker：cloudflare:sockets 的 connect（见 lib/mailer/index.ts）
 * - Node（本地验证 / 测试）：node:tls 包一层同构的 { readable, writable }
 *
 * 163 的约束：授权码登录只支持 AUTH LOGIN；MAIL FROM 必须与认证账号一致。
 */

/** 与 cloudflare:sockets 的 Socket 结构对齐的最小接口 */
export type SmtpDuplex = {
  readable: ReadableStream<Uint8Array>;
  writable: WritableStream<Uint8Array>;
};

export type SendViaSmtpOptions = {
  host: string;
  port: number;
  /** 认证账号（163 要求与 From 地址一致） */
  user: string;
  /** 163 客户端授权码（不是登录密码） */
  pass: string;
  /** 显示发件人，如 `AI影视工坊 <aigc202610@163.com>` */
  from: string;
  to: string;
  subject: string;
  text: string;
  html?: string;
  /** 单步响应读取超时（毫秒），默认 15s */
  timeoutMs?: number;
};

const enc = new TextEncoder();
const dec = new TextDecoder();

function utf8ToBase64(input: string): string {
  const bytes = enc.encode(input);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin);
}

/** RFC 2047 编码（主题 / 发件人名等头部中的非 ASCII） */
function encodeHeader(value: string): string {
  return `=?UTF-8?B?${utf8ToBase64(value)}?=`;
}

/**
 * 构建 RFC 5322 邮件（multipart/alternative：text 必带，html 可选）。
 * 纯函数，导出供单测断言编码与 dot-stuffing 之外的头部结构。
 */
export function buildMimeMessage(opts: {
  from: string;
  to: string;
  subject: string;
  text: string;
  html?: string;
  date?: Date;
  messageIdDomain?: string;
}): string {
  const boundary = `----=_afw_${crypto.randomUUID()}`;
  const lines: string[] = [
    `From: ${opts.from.includes("<") ? opts.from.replace(/^[^<]+/, (m) => encodeHeader(m.trim())) : encodeHeader(opts.from)}`,
    `To: <${opts.to}>`,
    `Subject: ${encodeHeader(opts.subject)}`,
    `Date: ${(opts.date ?? new Date()).toUTCString()}`,
    `Message-ID: <${crypto.randomUUID()}@${opts.messageIdDomain ?? "ai-film-workshop.local"}>`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    "",
    "This is a multi-part message in MIME format.",
  ];
  for (const part of [
    { type: "text/plain; charset=UTF-8", body: opts.text },
    ...(opts.html ? [{ type: "text/html; charset=UTF-8", body: opts.html }] : []),
  ]) {
    lines.push(
      `--${boundary}`,
      `Content-Type: ${part.type}`,
      "Content-Transfer-Encoding: base64",
      "",
      // base64 每 76 字符换行（RFC 2045）
      (utf8ToBase64(part.body).match(/.{1,76}/g) ?? []).join("\r\n"),
    );
  }
  lines.push(`--${boundary}--`);
  return lines.join("\r\n");
}

class SmtpError extends Error {
  constructor(
    step: string,
    code: number,
    lines: string[],
  ) {
    super(`SMTP ${step} 失败（${code}）：${lines.join(" / ")}`);
    this.name = "SmtpError";
  }
}

/** 单个 SMTP 会话：按行读写 + 每步响应校验 */
class SmtpSession {
  private reader: ReadableStreamDefaultReader<Uint8Array>;
  private writer: WritableStreamDefaultWriter<Uint8Array>;
  private buffer = "";

  constructor(
    private conn: SmtpDuplex,
    private timeoutMs: number,
  ) {
    this.reader = conn.readable.getReader();
    this.writer = conn.writable.getWriter();
  }

  /** 带超时的单次 read：超时后必须清掉 timer，避免悬挂的 rejection */
  private readChunk(): Promise<ReadableStreamReadResult<Uint8Array>> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`SMTP 响应超时（${this.timeoutMs}ms）`)),
        this.timeoutMs,
      );
      this.reader.read().then(
        (result) => {
          clearTimeout(timer);
          resolve(result);
        },
        (error: unknown) => {
          clearTimeout(timer);
          reject(error);
        },
      );
    });
  }

  private async readLine(): Promise<string> {
    for (;;) {
      const idx = this.buffer.indexOf("\r\n");
      if (idx >= 0) {
        const line = this.buffer.slice(0, idx);
        this.buffer = this.buffer.slice(idx + 2);
        return line;
      }
      const { value, done } = await this.readChunk();
      if (done) throw new Error("SMTP 连接被对端关闭");
      this.buffer += dec.decode(value, { stream: true });
    }
  }

  /** 读一条完整响应（多行 "250-…" 直到 "250 "） */
  private async response(step: string): Promise<{ code: number; lines: string[] }> {
    const first = await this.readLine();
    const code = Number.parseInt(first.slice(0, 3), 10);
    const lines = [first];
    while (lines[lines.length - 1]![3] === "-") {
      lines.push(await this.readLine());
    }
    if (Number.isNaN(code)) throw new Error(`SMTP ${step} 响应异常：${lines.join(" / ")}`);
    // 4xx/5xx 视为该步失败（DATA 中途的 354 由调用方特判）
    if (code >= 400) throw new SmtpError(step, code, lines);
    return { code, lines };
  }

  private async send(line: string): Promise<void> {
    await this.writer.write(enc.encode(`${line}\r\n`));
  }

  async handshake(user: string, pass: string): Promise<void> {
    await this.response("连接"); // 220 greeting
    await this.send(`EHLO ${user.split("@")[1] ?? "localhost"}`);
    await this.response("EHLO");
    await this.send("AUTH LOGIN");
    await this.response("AUTH LOGIN"); // 334 VXNlcm5hbWU6
    await this.send(utf8ToBase64(user));
    await this.response("AUTH 用户名"); // 334 UGFzc3dvcmQ6
    await this.send(utf8ToBase64(pass));
    await this.response("AUTH 认证"); // 235
  }

  async deliver(from: string, to: string, mime: string): Promise<void> {
    await this.send(`MAIL FROM:<${from}>`);
    await this.response("MAIL FROM");
    await this.send(`RCPT TO:<${to}>`);
    await this.response("RCPT TO");
    await this.send("DATA");
    await this.response("DATA"); // 354
    // dot-stuffing：行首 "." 翻倍，末尾以 "\r\n.\r\n" 结束报文
    const stuffed = mime
      .split("\r\n")
      .map((l) => (l.startsWith(".") ? `.${l}` : l))
      .join("\r\n");
    await this.writer.write(enc.encode(`${stuffed}\r\n.\r\n`));
    await this.response("报文");
  }

  async quit(): Promise<void> {
    try {
      await this.send("QUIT");
      await this.response("QUIT");
    } catch {
      // 221 已发出即可，读取失败不影响发送结果
    }
    try {
      this.writer.releaseLock();
      this.reader.releaseLock();
    } catch {
      // 释放失败忽略
    }
  }
}

/**
 * 发送一封邮件。任何一步失败都会抛错（消息里带 163 的原始响应，便于排查）。
 */
export async function sendViaSmtp(
  opts: SendViaSmtpOptions,
  socketFactory?: (host: string, port: number) => Promise<SmtpDuplex>,
): Promise<void> {
  const timeoutMs = opts.timeoutMs ?? 15_000;
  if (!socketFactory) {
    // Worker 路径：cloudflare:sockets 是 workerd 内置模块（npm 无包）。
    // 模块名用 base64 运行时解码 + turbopackIgnore，让 Turbopack / esbuild 都
    // 无法在构建期解析成静态依赖（两条打包链都不认识 cloudflare: 前缀，
    // 字面量或常量折叠都会导致打包报错；运行时 workerd 里可正常导入）。
    const spec = atob("Y2xvdWRmbGFyZTpzb2NrZXRz");
    const { connect } = (await import(/* turbopackIgnore: true */ spec)) as unknown as {
      connect: (addr: string, o?: object) => SmtpDuplex;
    };
    socketFactory = async (host, port) => connect(`${host}:${port}`, { secureTransport: "on", allowHalfOpen: false });
  }

  const conn = await socketFactory(opts.host, opts.port);
  const session = new SmtpSession(conn, timeoutMs);
  try {
    await session.handshake(opts.user, opts.pass);
    // 163 要求 MAIL FROM 与认证账号一致，地址从 from 的尖括号里取
    const fromAddr = /<([^>]+)>/.exec(opts.from)?.[1] ?? opts.from;
    const mime = buildMimeMessage({
      from: opts.from,
      to: opts.to,
      subject: opts.subject,
      text: opts.text,
      html: opts.html,
      messageIdDomain: fromAddr.split("@")[1],
    });
    await session.deliver(fromAddr, opts.to, mime);
  } finally {
    await session.quit();
  }
}
