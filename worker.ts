/**
 * Cloudflare Workers 入口。
 *
 * OpenNext 生成的 `.open-next/worker.js` 只导出 `fetch`，而 `wrangler.jsonc`
 * 里配置了 Cron Trigger（`0 0 * * *`）。CF 触发 scheduled 事件时若 worker 没有
 * `scheduled()` 导出会直接报错，因此在产物外面包一层：
 * - `fetch` 原样转发给 OpenNext；
 * - `scheduled` 用带 CRON_SECRET 的内部请求打 `/api/cron/digest`。
 *
 * 构建顺序：`opennextjs-cloudflare build` 先产出 `.open-next/worker.js`，
 * 再由 wrangler 以本文件为 main 打包，因此静态 import 在构建期成立；
 * 干净 clone 里 `.open-next` 不存在时 tsc 会报模块缺失，故用 ts-ignore。
 */
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore: `.open-next/worker.js` 由 opennextjs-cloudflare build 生成
import openNextWorker from "./.open-next/worker.js";

type CronEnv = {
  NEXT_PUBLIC_BASE_URL?: string;
  CRON_SECRET?: string;
};

const worker = {
  fetch(request: Request, env: unknown, ctx: unknown) {
    return openNextWorker.fetch(request, env as never, ctx as never);
  },

  async scheduled(
    _event: unknown,
    env: CronEnv,
    ctx: { waitUntil(promise: Promise<unknown>): void },
  ) {
    const baseUrl = env.NEXT_PUBLIC_BASE_URL;
    const secret = env.CRON_SECRET;
    if (!baseUrl || !secret) {
      console.error(
        "[cron] NEXT_PUBLIC_BASE_URL / CRON_SECRET 未配置，跳过每日摘要",
      );
      return;
    }

    ctx.waitUntil(
      fetch(new URL("/api/cron/digest", baseUrl), {
        headers: { Authorization: `Bearer ${secret}` },
      }).then(async (response) => {
        if (!response.ok) {
          console.error(
            `[cron] digest 触发失败：HTTP ${response.status} ${await response.text()}`,
          );
        }
      }),
    );
  },
};

export default worker;
