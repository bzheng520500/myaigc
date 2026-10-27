import { eq } from "drizzle-orm";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";

/**
 * next-auth 必须 mock：next-auth 顶层会 `import "next/server"`
 * （next-auth/lib/env.js），vitest 的 Node ESM 解析找不到该子路径而报
 * ERR_MODULE_NOT_FOUND。mock 掉 NextAuth 构造器即可加载 lib/auth——
 * 被测的 emailProvider / clientIpFromRequest 是模块内真实定义，
 * 不经 NextAuth 包装，不受影响。
 *
 * @auth/drizzle-adapter 不再 mock（D1 迁移 C1 修复后）：lib/auth.ts 已改为
 * `NextAuth(() => config)` 惰性配置，`DrizzleAdapter(getDb(), ...)` 只在
 * 配置函数（请求期）内构造，模块顶层不触碰 adapter / D1 绑定，因此这里
 * 可以加载真实 adapter。保留真实 adapter 还能顺带守住回归：若有人把
 * adapter 构造提回模块顶层，`lib/db` 的 Proxy 会抛
 * 「Unsupported database type」让用例直接失败。
 */
vi.mock("next-auth", () => ({
  default: () => ({
    handlers: { GET: vi.fn(), POST: vi.fn() },
    auth: vi.fn(),
    signIn: vi.fn(),
    signOut: vi.fn(),
  }),
}));

import { clientIpFromRequest, emailProvider } from "@/lib/auth";
import { db } from "@/lib/db";
import { verificationTokens } from "@/lib/db/schema";
import { TOKENS_MAX_AGE_SEC } from "@/lib/ratelimit";

/**
 * 魔法链接 IP 发信限流（终审 F1，spec：每 IP 10 分钟最多 5 封）。
 *
 * - 纯逻辑：clientIpFromRequest 的 x-forwarded-for 首段解析
 * - 连库：插 5 行 `ip:` 计数标记 → sendVerificationRequest 拒绝
 *   （AccessDenied → login 页 ratelimit 文案）；成功路径写入标记行
 */

/**
 * emailProvider 是工厂（from 需请求期求值）；测试按 email 分支的
 * 实际签名窄化后调用
 */
const sendVerificationRequest = (
  emailProvider() as unknown as {
    sendVerificationRequest: (p: {
      identifier: string;
      url: string;
      request: Request;
    }) => Promise<void>;
  }
).sendVerificationRequest;

/** 构造带 xff 头的伪请求 */
function requestWithIp(ip: string | null): Request {
  return new Request("http://localhost:3000/api/auth/callback/email", {
    headers: ip ? { "x-forwarded-for": ip } : {},
  });
}

/* ---------------------------------------------------------------- */
/* 纯逻辑：x-forwarded-for 首段解析                                   */
/* ---------------------------------------------------------------- */

describe("clientIpFromRequest 纯逻辑", () => {
  it("多级代理串取第一个：\"1.2.3.4, 5.6.7.8\" → 1.2.3.4", () => {
    expect(clientIpFromRequest(requestWithIp("1.2.3.4, 5.6.7.8"))).toBe(
      "1.2.3.4",
    );
  });

  it("首段两侧空白被 trim", () => {
    expect(clientIpFromRequest(requestWithIp("  1.2.3.4 , 5.6.7.8"))).toBe(
      "1.2.3.4",
    );
  });

  it("单 IP 原样返回", () => {
    expect(clientIpFromRequest(requestWithIp("9.9.9.9"))).toBe("9.9.9.9");
  });

  it("无 x-forwarded-for 头（本地/直连）→ 空串（跳过 IP 限流）", () => {
    expect(clientIpFromRequest(requestWithIp(null))).toBe("");
  });

  it("空头字符串 → 空串", () => {
    expect(clientIpFromRequest(requestWithIp(""))).toBe("");
  });
});

/* ---------------------------------------------------------------- */
/* 连库：IP 限流拒绝与成功路径计数标记                                 */
/* ---------------------------------------------------------------- */

describe.skipIf(!process.env.D1_LOCAL_TEST)("sendVerificationRequest IP 限流连库", () => {
  const uniq = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  // TEST-NET-2 地址做探针 IP，不与真实邮箱格式冲突
  const ip = `198.51.100.${Math.floor(Math.random() * 254) + 1}`;
  const markId = `ip:${ip}`;

  afterEach(async () => {
    // 每个用例后清掉本组 IP 标记，避免用例间计数串扰
    await db
      .delete(verificationTokens)
      .where(eq(verificationTokens.identifier, markId));
    vi.unstubAllEnvs();
  });

  afterAll(async () => {
    await db
      .delete(verificationTokens)
      .where(eq(verificationTokens.identifier, markId));
  });

  it("已有 5 行 ip: 标记 → AccessDenied 拒绝（10 分钟窗口第 6 封）", async () => {
    const now = Date.now();
    await db.insert(verificationTokens).values(
      Array.from({ length: 5 }, (_, i) => ({
        identifier: markId,
        token: `f1-mark-${uniq}-${i}`,
        // 与 markIpSent 同基准（created + 15min），保证被 600s 窗口精确计入
        expires: new Date(now + TOKENS_MAX_AGE_SEC * 1000),
      })),
    );

    await expect(
      sendVerificationRequest({
        identifier: `f1-a-${uniq}@test.local`,
        url: "http://localhost:3000/api/auth/callback/email?token=x",
        request: requestWithIp(ip),
      }),
    ).rejects.toThrow("发送过于频繁");
  });

  it("成功路径（DEV 模式）末尾写入 ip: 计数标记行", async () => {
    vi.stubEnv("AUTH_DEV_MODE", "1");
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await expect(
      sendVerificationRequest({
        identifier: `f1-b-${uniq}@test.local`,
        url: "http://localhost:3000/api/auth/callback/email?token=y",
        request: requestWithIp(ip),
      }),
    ).resolves.toBeUndefined();

    consoleSpy.mockRestore();

    const marks = await db
      .select({ token: verificationTokens.token })
      .from(verificationTokens)
      .where(eq(verificationTokens.identifier, markId));
    expect(marks).toHaveLength(1);
    expect(marks[0]!.token).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
  });
});
