import { AccessDenied, AuthError } from "@auth/core/errors";
import { DrizzleAdapter } from "@auth/drizzle-adapter";
import NextAuth from "next-auth";
import type { NextAuthConfig } from "next-auth";
import type { Provider } from "next-auth/providers";
import { getDb } from "@/lib/db";
import {
  accounts,
  sessions,
  users,
  verificationTokens,
} from "@/lib/db/schema";
import { recentCount, TOKENS_MAX_AGE_SEC } from "@/lib/ratelimit";
import { sendEmail } from "@/lib/mailer";

/**
 * Auth.js v5 魔法链接登录（Task 4）
 *
 * - adapter：@auth/drizzle-adapter + Cloudflare D1（表结构见 lib/db/schema.ts）
 * - session：database 策略（session 表持久化，无 JWT）
 * - 邮件发送频控：同一邮箱 60s 内只允许发一封（recentCount('tokens', email, 60)）
 * - AUTH_DEV_MODE=1 且非生产环境时不调 Resend，验证链接打印到服务端 console
 *
 * ## 惰性配置（D1 迁移 C1，关键约束）
 *
 * 本模块顶层**不得**出现 `getCloudflareContext()`、`DrizzleAdapter(...)` 或任何
 * DB 查询，必须全部下沉到 `authConfig()` 函数体内。原因：
 *
 * 1. Cloudflare 绑定只能经 `getCloudflareContext()` 取得，它读的是
 *    `AsyncLocalStorage`（@opennextjs/cloudflare 的 runWithCloudflareRequestContext
 *    在**每个请求**里 set store）。生产 Worker 的模块初始化阶段没有 store，
 *    顶层调用会直接抛错。
 * 2. OpenNext 的 worker 模板静态 `import { handler } from "./middleware/handler.mjs"`，
 *    即 middleware/proxy bundle 在 worker **启动期**求值 —— 它会连带执行本模块顶层。
 * 3. 顶层 `DrizzleAdapter(db, ...)` 还会因 `db` 是 lib/db 的 Proxy（原型是
 *    Object.prototype）导致 adapter 内部 `is(db, BaseSQLiteDatabase)` 识别失败，
 *    直接抛 `Unsupported database type (object)`。
 *
 * 因此改用 Auth.js v5 的函数式配置 `NextAuth(() => config)`：每次请求才调用
 * 配置函数，`getDb()` 在其中解析绑定（首次成功后 lib/db 内部缓存）。
 */

/** 魔法链接重发间隔（秒） */
const RESEND_WINDOW_SEC = 60;

/** IP 发信限流窗口（秒）：每 IP 10 分钟（spec 安全要求） */
const IP_RATE_WINDOW_SEC = 10 * 60;

/** IP 发信限流上限：窗口内最多 5 封 */
const IP_RATE_MAX = 5;

/**
 * 是否启用「打印魔法链接」的本地开发模式（安全要求，C1）。
 *
 * 生产环境**硬禁用**：即使线上误设 `AUTH_DEV_MODE=1`，也绝不能把可直接登录的
 * 魔法链接写进 Worker 日志（Cloudflare observability 会长期留存）。
 *
 * 判定用白名单（fail-closed）：只有 `NODE_ENV` 明确为 `development`（next dev）
 * 或 `test`（vitest）才生效；`NODE_ENV` 缺失或为 `production` 一律按生产处理。
 * 注：OpenNext 的 server / node-middleware bundle 构建时会把
 * `process.env.NODE_ENV` 内联为 `"production"`，白名单不依赖该前提也能保证安全。
 *
 * 在请求期（sendVerificationRequest 内）调用而非模块顶层求值，避免 Worker
 * 模块初始化早于 process.env 注入（@opennextjs/cloudflare 的 populateProcessEnv）。
 *
 * 导出仅供单测断言「生产硬禁用」（与 clientIpFromRequest 同一定位）。
 */
export function isAuthDevMode(): boolean {
  if (process.env.AUTH_DEV_MODE !== "1") return false;
  return (
    process.env.NODE_ENV === "development" || process.env.NODE_ENV === "test"
  );
}

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
    await getDb().insert(verificationTokens).values({
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
 * 手写 Email provider 工厂（Task 14 fix：next-auth/providers/email 是
 * @auth/core 的 deprecated 别名，内部静态 import nodemailer 导致构建
 * 失败。手写对象不引入任何 provider 包装函数，产物与 Email() 等价：
 * id 仍为 "email"，login 页 signIn("email", …) 行为语义不变）。
 *
 * 必须是**工厂**而非顶层对象：`from`（AUTH_EMAIL_FROM）依赖
 * @opennextjs/cloudflare 的 populateProcessEnv 注入的 secrets，而本模块
 * 顶层在 Worker 启动期求值（早于注入）。顶层求值曾让 from 恒为
 * undefined，Auth.js 断言 email provider 缺 from 直接 error=Configuration。
 * authConfig() 在请求期调用本工厂，届时 env 已就绪（与 `secret:` 同理）。
 *
 * sendVerificationRequest（原顶层函数整体搬入）：
 *
 * 频控拒绝必须抛 AuthError 子类（AccessDenied）：next-auth 的 signIn()
 * 在 server action 中以 raw 模式调用 Auth()，非 AuthError 异常会被吞掉
 * 并转成 error 页跳转，无法在 login 页区分错误类型。
 *
 * 导出（终审 F1）：测试直接调 sendVerificationRequest 断言 IP 限流。
 */
export function emailProvider(): Provider {
  return {
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

    if (isAuthDevMode()) {
      // 本地开发：完整链接打印到服务端 console，不调 Resend。
      // 生产环境走不到这里（isAuthDevMode 白名单只认 development/test），
      // 因此下面的 node:fs 依赖图在 Worker 运行时永远不会被加载。
      console.log(`[auth] 魔法链接已生成（${identifier}）：${url}`);
      // E2E（Task 14）：Playwright 读不到 dev server 控制台，DEV 模式下
      // 把链接落盘到 E2E_TOKEN_URL_FILE 供 spec 轮询（见 lib/e2e-login-log.ts）。
      // NEXT_RUNTIME 守卫 + 动态 import：next dev（nodejs）才加载；
      // 测试环境（vitest，NEXT_RUNTIME 未定义）跳过，避免真实写盘。
      if (process.env.NEXT_RUNTIME === "nodejs") {
        await import("@/lib/e2e-login-log").then((m) => m.appendLoginUrl(url));
      }
      await markIpSent(ip);
      return;
    }

    try {
      await sendEmail({
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
    } catch (error) {
      // 诊断：Auth.js 会把异常转成 error=Verification 重定向，原始失败
      // 原因只有日志里能看到（observability / wrangler tail）
      console.error(
        "[auth] 登录邮件发送失败：",
        error instanceof Error ? error.message : error,
      );
      // SMTP / Resend 的失败统一映射为 AuthError 子类：login 页按此
      // 显示中文文案；普通 Error 会被 next-auth 吞掉转默认错误页。
      throw new EmailSignInError(
        `邮件发送失败：${error instanceof Error ? error.message : "未知错误"}`,
      );
    }

    // 发信成功：写入 IP 计数标记（发信/打印链接两个成功路径末尾各调一次）
    await markIpSent(ip);
  },
  };
}

/**
 * Auth.js 配置工厂（惰性，Auth.js v5 每次请求才调用求值）。
 *
 * 唯一允许构造 DrizzleAdapter / 解析 D1 绑定的地方：`getDb()` 在此处
 * 首次调用时才走 `getCloudflareContext()`，即一定处于请求作用域内。
 * 返回值语义与原静态配置逐项一致（session 策略 / callbacks / pages /
 * trustHost / secret 均未改动）。
 */
function authConfig(): NextAuthConfig {
  return {
    adapter: DrizzleAdapter(getDb(), {
      usersTable: users,
      accountsTable: accounts,
      sessionsTable: sessions,
      verificationTokensTable: verificationTokens,
    }),
    providers: [emailProvider()],
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
  };
}

/**
 * 函数式（惰性）初始化：模块顶层只做一次轻量包装，不触碰 Cloudflare 绑定。
 * `handlers` 仍是 `{ GET, POST }`（每次请求内部求值 config），对外路由签名不变。
 */
export const { handlers, auth, signIn, signOut } = NextAuth(authConfig);
