import type { NextConfig } from "next";
import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";

/**
 * 本地开发时把 wrangler.jsonc 的绑定（D1 / KV）注入 `next dev`，
 * 使 getCloudflareContext().env.DB 在 dev 下可用；生产构建由
 * OpenNext 的 worker 提供同一套绑定。非 dev 环境此调用为 no-op。
 */
initOpenNextCloudflareForDev();

/**
 * 不启用 cacheComponents / partialPrefetching（PPR）。
 *
 * Next 的 Cache Components 渲染调度依赖 setTimeout 推进，workerd 的实现让该
 * 调度永不 resolve：任何页面请求都会被运行时判定为 hung（本地 wrangler dev
 * 实测 `/login` 466ms 即返回 500 "code had hung"）。因此关闭该特性，全部页面
 * 由各自 page.tsx 声明 force-dynamic，数据每次请求实时读取 D1。
 */
const nextConfig: NextConfig = {
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
