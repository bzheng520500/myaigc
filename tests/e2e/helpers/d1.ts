/**
 * E2E 直插库绑定初始化（Playwright worker 进程内）。
 *
 * 浏览器侧请求由 `next dev` 的 `initOpenNextCloudflareForDev()` 提供 D1 绑定；
 * 测试进程里的 `db`（lib/db Proxy）没有 Cloudflare context，需要像 vitest 的
 * `tests/setup/d1.ts` 一样用 wrangler 的 `getPlatformProxy()` 取得同一本地 D1
 * （`.wrangler/state` 下的 sqlite），挂到 `globalThis.__D1_BINDING__`。
 *
 * 调用位置有要求：必须是 spec 里注册的**第一个** `beforeAll`
 * （Playwright 按注册顺序执行钩子），后续 `beforeAll` 里的 `db` 调用
 * 才能解析到绑定。
 */
type GlobalWithBinding = typeof globalThis & { __D1_BINDING__?: unknown };

export async function ensureLocalDb(): Promise<void> {
  if (process.env.D1_LOCAL_TEST !== "1") return;

  const g = globalThis as GlobalWithBinding;
  // worker 进程会跨 spec 文件复用：已注入过就保持同一个 proxy
  if (g.__D1_BINDING__) return;

  const { getPlatformProxy } = await import("wrangler");
  const proxy = await getPlatformProxy({ configPath: "wrangler.jsonc" });
  g.__D1_BINDING__ = proxy.env.DB;
}
