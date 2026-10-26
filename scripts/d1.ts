/**
 * 脚本侧 D1 绑定注入。
 *
 * Workers / `next dev` 的绑定来自运行时上下文；tsx 脚本没有该上下文，用
 * wrangler 的 getPlatformProxy 复现同一绑定（读 wrangler.jsonc 与
 * .wrangler/state 本地 D1），挂到 `globalThis.__D1_BINDING__` 供 lib/db 的
 * 惰性解析使用（见 lib/db/index.ts 绑定优先级第 2 条）。
 *
 * 生产写库（远程 D1）请用 `wrangler d1 execute --remote` 或部署后的 Worker，
 * 本 helper 只指向本地库。
 */
import { getPlatformProxy } from "wrangler";

type GlobalWithBinding = typeof globalThis & { __D1_BINDING__?: unknown };

export type D1Handle = { dispose: () => Promise<void> };

/**
 * 注入本地 D1 绑定（幂等：已注入时直接复用，不重复启动 miniflare）。
 *
 * @example
 * const d1 = await connectScriptDb();
 * try {
 *   await doWork();
 * } finally {
 *   await d1.dispose();
 * }
 */
export async function connectScriptDb(): Promise<D1Handle> {
  const g = globalThis as GlobalWithBinding;
  if (g.__D1_BINDING__) {
    return { dispose: async () => {} };
  }
  const proxy = await getPlatformProxy({ configPath: "wrangler.jsonc" });
  g.__D1_BINDING__ = proxy.env.DB;
  return { dispose: () => proxy.dispose() };
}
