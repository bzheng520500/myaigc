/**
 * 本地 SMTP 通道验证脚本（Node 直连，不经 Workers）。
 *
 * 用法：npx tsx --env-file=.env scripts/verify-smtp.ts <收件邮箱>
 *
 * 用 node:tls 包出与 cloudflare:sockets 同构的 { readable, writable }，
 * 复用 lib/mailer/smtp.ts 的同一套协议实现，部署前先在本地验证
 * 授权码与协议正确性（发一封测试邮件到指定邮箱）。
 */
import tls from "node:tls";
import { Readable, Writable } from "node:stream";
import { sendViaSmtp, type SmtpDuplex } from "../lib/mailer/smtp";

function nodeSocketFactory(host: string, port: number): Promise<SmtpDuplex> {
  return new Promise((resolve, reject) => {
    const sock = tls.connect({ host, port, servername: host }, () =>
      resolve({
        readable: Readable.toWeb(sock) as ReadableStream<Uint8Array>,
        writable: Writable.toWeb(sock) as WritableStream<Uint8Array>,
      }),
    );
    sock.once("error", reject);
  });
}

const to = process.argv[2];
if (!to || !to.includes("@")) {
  console.error("用法：npx tsx --env-file=.env scripts/verify-smtp.ts <收件邮箱>");
  process.exit(1);
}

async function main(): Promise<void> {
  await sendViaSmtp(
    {
      host: process.env.SMTP_HOST!,
      port: Number(process.env.SMTP_PORT ?? 465),
      user: process.env.SMTP_USER!,
      pass: process.env.SMTP_PASS!,
      from: process.env.AUTH_EMAIL_FROM ?? `AI影视工坊 <${process.env.SMTP_USER}>`,
      to: to!,
      subject: "SMTP 通道验证（AI影视工坊）",
      text: [
        "如果你收到这封邮件，说明 SMTP 发信通道已配置成功。",
        "",
        "这是一封部署前的通道验证邮件，可以忽略。",
      ].join("\n"),
      html: "<p>如果你收到这封邮件，说明 <b>SMTP 发信通道</b>已配置成功。</p><p>部署前通道验证邮件，可忽略。</p>",
    },
    nodeSocketFactory,
  );
  console.log(
    `✅ 测试邮件已通过 SMTP(${process.env.SMTP_HOST}:${process.env.SMTP_PORT ?? 465}) 发送到 ${to}`,
  );
}

main().catch((error) => {
  console.error("❌ SMTP 发送失败：", error);
  process.exit(1);
});
