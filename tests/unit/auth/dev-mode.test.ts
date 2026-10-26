import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * next-auth 必须 mock（同 ip-ratelimit.test.ts）：next-auth 顶层
 * `import "next/server"` 在 vitest 的 Node ESM 解析下找不到子路径。
 * 被测的 isAuthDevMode 是模块内真实定义，不经 NextAuth 包装。
 */
vi.mock("next-auth", () => ({
  default: () => ({
    handlers: { GET: vi.fn(), POST: vi.fn() },
    auth: vi.fn(),
    signIn: vi.fn(),
    signOut: vi.fn(),
  }),
}));

import { isAuthDevMode } from "@/lib/auth";

/**
 * AUTH_DEV_MODE 生产硬禁用（D1 迁移 C1 安全要求）。
 *
 * 白名单判定（fail-closed）：只有 AUTH_DEV_MODE=1 且 NODE_ENV 明确为
 * development / test 才打印魔法链接；NODE_ENV 为 production 或缺失
 * （生产 Worker 可能未注入）一律按生产处理，避免链接泄漏到日志。
 */
describe("isAuthDevMode 生产硬禁用", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("AUTH_DEV_MODE 未设置 → false", () => {
    vi.stubEnv("AUTH_DEV_MODE", "");
    vi.stubEnv("NODE_ENV", "development");
    expect(isAuthDevMode()).toBe(false);
  });

  it("AUTH_DEV_MODE=1 + NODE_ENV=production → false（即使误设也不打印）", () => {
    vi.stubEnv("AUTH_DEV_MODE", "1");
    vi.stubEnv("NODE_ENV", "production");
    expect(isAuthDevMode()).toBe(false);
  });

  it("AUTH_DEV_MODE=1 + NODE_ENV 缺失 → false（fail-closed）", () => {
    vi.stubEnv("AUTH_DEV_MODE", "1");
    vi.stubEnv("NODE_ENV", "");
    expect(isAuthDevMode()).toBe(false);
  });

  it("AUTH_DEV_MODE=1 + NODE_ENV=development → true（next dev）", () => {
    vi.stubEnv("AUTH_DEV_MODE", "1");
    vi.stubEnv("NODE_ENV", "development");
    expect(isAuthDevMode()).toBe(true);
  });

  it("AUTH_DEV_MODE=1 + NODE_ENV=test → true（vitest）", () => {
    vi.stubEnv("AUTH_DEV_MODE", "1");
    vi.stubEnv("NODE_ENV", "test");
    expect(isAuthDevMode()).toBe(true);
  });
});
