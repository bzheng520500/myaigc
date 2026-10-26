import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/unit/**/*.test.ts"],
    // D1_LOCAL_TEST=1 时注入本地 D1 绑定，其余情况为空操作
    setupFiles: ["tests/setup/d1.ts"],
    // 连库测试串行：每个测试文件各起一个 miniflare 实例，并发读写同一
    // 本地 sqlite 会互相干扰（写入不可见 / 断言看到其他文件的探针数据）。
    // 纯单测（无 D1_LOCAL_TEST）保持默认并行。
    fileParallelism: !process.env.D1_LOCAL_TEST,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
});
