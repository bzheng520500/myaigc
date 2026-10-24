import { AccessDenied, AuthError } from "@auth/core/errors";
import { DrizzleAdapter } from "@auth/drizzle-adapter";
import NextAuth from "next-auth";
import type { Provider } from "next-auth/providers";
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

/** IP 发信限流窗口（秒）：每 IP 10 分钟（spec 安全要求） */
const IP_RATE_WINDOW_SEC = 10 * 60;

/** IP 发信限流上限：窗口内最多 5 封 */
const IP_RATE_MAX = 5;

/**
 * 从 Request 解析客户端 IP：x-forwarded-for 首段（多级代理取最原始 IP）。
 * 无该头（本地 / 直连部署）返回空串——调用方据此跳过 IP 维度限流。
 */
export function clientIpFromRequest(request: Request): string {
  return (request.headers.get("x-forwarded-for") ?? "")
    .split(",")[0]!
    .trim();
}

/**
 * 记录一次 IP 发信（终审 F1）：向 verification_tokens 插一行
 * `ip:<ip>` 计数标记，供 recentCount("tokens", `ip:${ip}`, 600) 统计。
 *
 * expires 必须按 TOKENS_MAX_AGE_SEC 基准写（created + 15min）：
 * recentCount 的 tokens 分支靠「expires = created + 15min」反推窗口，
 * 标记行同基准才能被精确计入 10 分钟窗口（若写 created+600s，
 * 实际可拦截窗口会缩短为 600-(900-600)=300s）。标记行无自动清理
 * （adapter 只按 identifier+token 单行删除），过期后不满足计数阈值、
 * 限流判定不受影响，仅缓慢积累；可后续加定期清理。写失败静默（计数
 * 标记不影响登录邮件主流程）。
 */
async function markIpSent(ip: string): Promise<void> {
  if (!ip) return;
  try {
    await db.insert(verificationTokens).values({
      identifier: `ip:${ip}`,
      token: crypto.randomUUID(),
      expires: new Date(Date.now() + TOKENS_MAX_AGE_SEC * 1000),
    });
  } catch {
    // 静默：限流计数降级不阻塞发信
  }
}

/**
 * 邮件发送失败（Resend 报错或环境变量缺失）。
 * 必须是 AuthError 子类：login 页 server action 只按 AuthError 映射中文文案，
 * 普通 Error 会被 next-auth 吞掉并转成默认错误页。
 */
class EmailSignInError extends AuthError {}

/**
 * 手写 Email provider 对象（Task 14 fix：next-auth/providers/email 是
 * @auth/core 的 deprecated 别名，内部静态 import nodemailer 导致构建
 * 失败。手写对象不引入任何 provider 包装函数，产物与 Email() 等价：
 * id 仍为 "email"，login 页 signIn("email", …) 行为语义不变）。
 *
 * sendVerificationRequest（原顶层函数整体搬入）：
 *
 * 频控拒绝必须抛 AuthError 子类（AccessDenied）：next-auth 的 signIn()
 * 在 server action 中以 raw 模式调用 Auth()，非 AuthError 异常会被吞掉
 * 并转成 error 页跳转，无法在 login 页区分错误类型。
 *
 * 导出（终审 F1）：测试直接调 sendVerificationRequest 断言 IP 限流。
 */
export const emailProvider: Provider = {
  id: "email",
  type: "email",
  name: "Email",
  from: process.env.AUTH_EMAIL_FROM,
  maxAge: TOKENS_MAX_AGE_SEC, // 15 分钟，与 lib/ratelimit.ts 的窗口反推保持一致
  async sendVerificationRequest({ identifier, url, request }) {
    const recent = await recentCount("tokens", identifier, RESEND_WINDOW_SEC);
    if (recent >= 1) {
      throw new AccessDenied(
        `发送过于频繁，请 ${RESEND_WINDOW_SEC / 60} 分钟后再试`,
      );
    }

    // IP 维度限流（终审 F1，spec：每 IP 10 分钟 5 封）。无 xff（本地 /
    // 直连）跳过；拒绝时抛 AccessDenied → login 页映射 ratelimit 文案
    const ip = clientIpFromRequest(request);
    if (
      ip &&
      (await recentCount("tokens", `ip:${ip}`, IP_RATE_WINDOW_SEC)) >=
        IP_RATE_MAX
    ) {
      throw new AccessDenied(
        `发送过于频繁，请 ${IP_RATE_WINDOW_SEC / 60} 分钟后再试`,
      );
    }

    if (process.env.AUTH_DEV_MODE === "1") {
      // 本地开发：完整链接打印到服务端 console，不调 Resend
      console.log(`[auth] 魔法链接已生成（${identifier}）：${url}`);
      // E2E（Task 14）：Playwright 读不到 dev server 控制台，DEV 模式下
      // 把链接落盘到 E2E_TOKEN_URL_FILE 供 spec 轮询（见 lib/e2e-login-log.ts）。
      // 本文件同时被 Edge middleware 引用：NEXT_RUNTIME 守卫 + 动态 import
      // 让 Turbopack 在 Edge 构建中剔除 node:fs 依赖图（零告警）。
      if (process.env.NEXT_RUNTIME === "nodejs") {
        await import("@/lib/e2e-login-log").then((m) => m.appendLoginUrl(url));
      }
      await markIpSent(ip);
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

    // 发信成功：写入 IP 计数标记（发信/打印链接两个成功路径末尾各调一次）
    await markIpSent(ip);
  },
};

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: DrizzleAdapter(db, {
    usersTable: users,
    accountsTable: accounts,
    sessionsTable: sessions,
    verificationTokensTable: verificationTokens,
  }),
  providers: [emailProvider],
  session: { strategy: "database" },
  callbacks: {
    /**
     * database 策略下 user 即 users 表整行（含业务字段 role），但默认
     * callback 只回填 name/email/image。这里把 id / role 注入
     * session.user，供管理后台权限判定使用（Task 12）。
     */
    session({ session, user }) {
      const sessionUser = session.user as {
        id?: string;
        role?: string;
      };
      sessionUser.id = user.id;
      sessionUser.role = (user as { role?: string }).role ?? "user";
      return session;
    },
  },
  pages: { signIn: "/login" },
  trustHost: true,
  secret: process.env.AUTH_SECRET,
});
