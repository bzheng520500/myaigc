import { defineCloudflareConfig } from "@opennextjs/cloudflare";
import kvIncrementalCache from "@opennextjs/cloudflare/overrides/incremental-cache/kv-incremental-cache";

/**
 * OpenNext Cloudflare 适配器配置。
 *
 * 增量缓存（ISR / "use cache" 的运行时缓存）落在 Workers KV：
 * R2 需在 Cloudflare Dashboard 单独开通，KV 免费额度即可支撑当前流量。
 * 将来开通 R2 后只需把 kvIncrementalCache 换成 r2IncrementalCache，
 * 并在 wrangler.jsonc 加 NEXT_INC_CACHE_R2_BUCKET binding。
 */
export default defineCloudflareConfig({
  incrementalCache: kvIncrementalCache,
});
