/**
 * vitest 全局 setup：本地 D1 绑定注入。
 *
 * `D1_LOCAL_TEST=1` 时用 wrangler 的 `getPlatformProxy()` 读取 wrangler.jsonc
 * 的 D1 绑定（指向 `.wrangler/state` 下的本地 sqlite），挂到
 * `globalThis.__D1_BINDING__`，供 `lib/db` 的惰性解析直接使用
 * （见 `lib/db/index.ts` 绑定来源第 2 条）。
 *
 * 未设置该变量时不启动 miniflare：纯单测零额外开销，连库 describe 由各自
 * `skipIf(!process.env.D1_LOCAL_TEST)` 跳过。
 */
import { afterAll } from "vitest";

type GlobalWithBinding = typeof globalThis & { __D1_BINDING__?: unknown };

if (process.env.D1_LOCAL_TEST) {
  const { getPlatformProxy } = await import("wrangler");
  const proxy = await getPlatformProxy({ configPath: "wrangler.jsonc" });
  const g = globalThis as GlobalWithBinding;
  g.__D1_BINDING__ = proxy.env.DB;

  afterAll(async () => {
    delete g.__D1_BINDING__;
    await proxy.dispose();
  });
}
