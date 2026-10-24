import { AccessDenied, AuthError } from "@auth/core/errors";
import { DrizzleAdapter } from "@auth/drizzle-adapter";
import NextAuth from "next-auth";
import Email from "next-auth/providers/email";
import { Resend } from "resend";
import { db } from "@/lib/db";
import {
  accounts,
  sessions,
  users,
  verificationTokens,
} from "@/lib/db/schema";
import { recentCount, TOKENS_MAX_AGE_SEC } from "@/lib/ratelimit";

/**
 * Auth.js v5 魔法链接登录（Task 4）
 *
 * - adapter：@auth/drizzle-adapter + Neon（表结构见 lib/db/schema.ts）
 * - session：database 策略（session 表持久化，无 JWT）
 * - 邮件发送频控：同一邮箱 60s 内只允许发一封（recentCount('tokens', email, 60)）
 * - AUTH_DEV_MODE=1 时不调 Resend，验证链接完整打印到服务端 console
 */

/** 魔法链接重发间隔（秒） */
const RESEND_WINDOW_SEC = 60;

/**
 * 邮件发送失败（Resend 报错或环境变量缺失）。
 * 必须是 AuthError 子类：login 页 server action 只按 AuthError 映射中文文案，
 * 普通 Error 会被 next-auth 吞掉并转成默认错误页。
 */
class EmailSignInError extends AuthError {}

/**
 * 发送验证邮件 / 打印开发链接。
 *
 * 频控拒绝必须抛 AuthError 子类（AccessDenied）：next-auth 的 signIn()
 * 在 server action 中以 raw 模式调用 Auth()，非 AuthError 异常会被吞掉
 * 并转成 error 页跳转，无法在 login 页区分错误类型。
 */
async function sendVerificationRequest({
  identifier,
  url,
}: {
  identifier: string;
  url: string;
}) {
  const recent = await recentCount("tokens", identifier, RESEND_WINDOW_SEC);
  if (recent >= 1) {
    throw new AccessDenied(`发送过于频繁，请 ${RESEND_WINDOW_SEC / 60} 分钟后再试`);
  }

  if (process.env.AUTH_DEV_MODE === "1") {
    // 本地开发：完整链接打印到服务端 console，不调 Resend
    console.log(`[auth] 魔法链接已生成（${identifier}）：${url}`);
    return;
  }

  const from = process.env.AUTH_EMAIL_FROM;
  const apiKey = process.env.RESEND_API_KEY;
  if (!from || !apiKey) {
    throw new EmailSignInError(
      "邮件发送失败：RESEND_API_KEY / AUTH_EMAIL_FROM 未配置",
    );
  }

  const resend = new Resend(apiKey);
  const { error } = await resend.emails.send({
    from,
    to: identifier,
    subject: "登录 AI影视工坊",
    text: [
      "你好！",
      "",
      "点击以下链接即可登录「AI影视工坊」，链接 15 分钟内有效：",
      "",
      url,
      "",
      "如果这不是你本人的操作，请忽略本邮件。",
    ].join("\n"),
  });
  if (error) {
    throw new EmailSignInError(
      `邮件发送失败：${error.name ?? "ResendError"} ${error.message ?? ""}`.trim(),
    );
  }
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: DrizzleAdapter(db, {
    usersTable: users,
    accountsTable: accounts,
    sessionsTable: sessions,
    verificationTokensTable: verificationTokens,
  }),
  providers: [
    Email({
      from: process.env.AUTH_EMAIL_FROM,
      maxAge: TOKENS_MAX_AGE_SEC, // 15 分钟，与 lib/ratelimit.ts 的窗口反推保持一致
      sendVerificationRequest,
    }),
  ],
  session: { strategy: "database" },
  pages: { signIn: "/login" },
  trustHost: true,
  secret: process.env.AUTH_SECRET,
});
