/**
 * 全站统一发信入口。
 *
 * 通道优先级：
 * 1. SMTP（`SMTP_HOST` + `SMTP_USER` + `SMTP_PASS` 齐全）——当前生产配置
 *    （163 邮箱授权码，`lib/mailer/smtp.ts` 手写客户端）；
 * 2. Resend（`RESEND_API_KEY`）——备用 REST 通道（Workers 无 SDK，直接 fetch）；
 * 3. 都未配置 → 抛错（登录场景映射为「邮件发送失败」，cron 计 failed）。
 *
 * 发件人显示名统一取 `AUTH_EMAIL_FROM`；SMTP 下若未单独配置则用
 * `AI影视工坊 <SMTP_USER>`（163 要求 From 与认证账号一致）。
 */
import { sendViaSmtp } from "./smtp";

export type EmailMessage = {
  to: string;
  subject: string;
  text: string;
  html?: string;
};

const SITE_NAME = "AI影视工坊";

/** SMTP 是否已配置（secret 三件套齐全） */
export function isSmtpConfigured(): boolean {
  return Boolean(
    process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS,
  );
}

/** SMTP / Resend 任一可用即视为已配置 */
export function isMailerConfigured(): boolean {
  return isSmtpConfigured() || Boolean(process.env.RESEND_API_KEY);
}

/**
 * Resend REST 通道（备用）。导出供单测 mock fetch 断言请求契约；
 * 生产主通道为 SMTP（isSmtpConfigured 优先命中）。
 */
export async function sendViaResend(
  msg: EmailMessage,
  opts: { apiKey: string; from: string },
): Promise<void> {
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${opts.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: opts.from,
      to: msg.to,
      subject: msg.subject,
      text: msg.text,
      ...(msg.html ? { html: msg.html } : {}),
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) {
    throw new Error(`Resend HTTP ${response.status}：${await response.text()}`);
  }
}

export async function sendEmail(msg: EmailMessage): Promise<void> {
  const from = process.env.AUTH_EMAIL_FROM;

  if (isSmtpConfigured()) {
    const user = process.env.SMTP_USER!;
    await sendViaSmtp({
      host: process.env.SMTP_HOST!,
      port: Number(process.env.SMTP_PORT ?? 465),
      user,
      pass: process.env.SMTP_PASS!,
      from: from ?? `${SITE_NAME} <${user}>`,
      to: msg.to,
      subject: msg.subject,
      text: msg.text,
      html: msg.html,
    });
    return;
  }

  const apiKey = process.env.RESEND_API_KEY;
  if (apiKey) {
    await sendViaResend(msg, {
      apiKey,
      from: from ?? `${SITE_NAME} <onboarding@resend.dev>`,
    });
    return;
  }

  throw new Error("邮件服务未配置（SMTP_HOST/SMTP_USER/SMTP_PASS 或 RESEND_API_KEY）");
}
