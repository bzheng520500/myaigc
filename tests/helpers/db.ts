/**
 * 单测数据库环境控制（Cloudflare D1 架构）。
 *
 * 生产代码用 `isDbAvailable()` 判断是否可触库，因此「无库短路」用例必须
 * 通过 `setDbForTesting(null)`（并清掉 `globalThis.__D1_BINDING__`）来
 * 模拟，而不是 stub 环境变量（迁移后旧的连接串变量已不参与判断）。
 *
 * 用法：
 * ```ts
 * it("无库时返回空数组", async () => {
 *   const restore = simulateNoDatabase();
 *   try {
 *     await expect(listX()).resolves.toEqual([]);
 *   } finally {
 *     restore();
 *   }
 * });
 * ```
 */
import { setDbForTesting } from "@/lib/db";

type GlobalWithBinding = typeof globalThis & { __D1_BINDING__?: unknown };

/**
 * 进入「无库」环境：清除测试注入实例与 globalThis 原始绑定。
 *
 * @returns 恢复函数：还原进入前的原始绑定（Phase E 若用 setup 全局注入
 *          `__D1_BINDING__`，同文件后续连库用例可继续使用）。
 */
export function simulateNoDatabase(): () => void {
  const g = globalThis as GlobalWithBinding;
  const hadBinding = "__D1_BINDING__" in g;
  const savedBinding = g.__D1_BINDING__;

  setDbForTesting(null);
  delete g.__D1_BINDING__;

  return () => {
    setDbForTesting(null);
    if (hadBinding) g.__D1_BINDING__ = savedBinding;
  };
}
