import { defineConfig } from "@playwright/test";

/**
 * e2e 恒为连库测试：默认开启本地 D1（显式 `D1_LOCAL_TEST=0` 关闭时全部 skip）。
 * 直插库的 spec 通过 tests/e2e/helpers/d1.ts 注入 `getPlatformProxy()` 绑定。
 */
if (process.env.D1_LOCAL_TEST === undefined) process.env.D1_LOCAL_TEST = "1";

export default defineConfig({
  testDir: "tests/e2e",
  /**
   * 串行执行：每个 worker 进程各自起一个 miniflare 实例，并发读写同一本地
   * sqlite 会互相干扰（写入不可见 / 断言看到其他 spec 的探针数据），
   * 与 vitest 连库模式的 fileParallelism: false 同因同解。
   */
  workers: 1,
  use: {
    baseURL: "http://localhost:3000",
  },
  webServer: {
    command: "npm run dev",
    url: "http://localhost:3000",
    // next dev 首次启动要初始化 OpenNext 的 CF 绑定注入，给足时间
    timeout: 180_000,
    reuseExistingServer: !process.env.CI,
  },
});
