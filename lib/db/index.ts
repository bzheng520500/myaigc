import { getCloudflareContext } from "@opennextjs/cloudflare";
import {
  drizzle,
  type AnyD1Database,
  type DrizzleD1Database,
} from "drizzle-orm/d1";
import * as schema from "./schema";

/**
 * 数据层入口（Cloudflare D1 + drizzle-orm/d1）。
 *
 * 绑定来源（按优先级）：
 * 1. `setDbForTesting(instance)` 注入的 drizzle 实例（vitest 用，可基于
 *    本地 D1 / better-sqlite3）；
 * 2. `globalThis.__D1_BINDING__`（测试 setup 用 `getPlatformProxy()` 取得的
 *    原始 D1 绑定，见 D1 迁移计划 B2）；
 * 3. `getCloudflareContext().env.DB`（生产 Worker / `next dev` 的 wrangler
 *    绑定，见 wrangler.jsonc 的 `d1_databases[0].binding`）。
 *
 * 重要：`getCloudflareContext()` 绝不能在模块顶层调用——生产 Worker 的模块
 * 初始化阶段没有请求作用域（AsyncLocalStorage 无 store），会直接抛错。
 * 因此这里全部惰性化：只在首次真正使用 `db` / 调用 `getDb()` 时解析绑定，
 * 成功后缓存为模块级单例。
 *
 * `db.transaction()` 在 D1 上不可用（D1 仅支持 `db.batch()`），需要原子性的
 * 多语句写入请使用 batch，不要调用 transaction。
 */
export type Db = DrizzleD1Database<typeof schema>;

/** D1 绑定类型（drizzle 的 AnyD1Database，兼容未安装 Workers 全局类型的环境） */
type D1Binding = AnyD1Database;

/** getDb 无法解析绑定时的统一错误信息（可 grep） */
const UNAVAILABLE_MESSAGE =
  '[db] D1 binding "DB" unavailable. Run via wrangler/opennext, or inject a test database.';

/** 测试注入的 drizzle 实例（setDbForTesting），优先级最高 */
let testDb: Db | null = null;

/** 由真实绑定创建的模块级单例 */
let instance: Db | undefined;

/**
 * 解析原始 D1 绑定。失败时抛出信息明确的错误（原始异常挂在 cause 上便于排查）。
 */
function resolveBinding(): D1Binding {
  // 1) vitest setup 注入的原始绑定（getPlatformProxy → globalThis.__D1_BINDING__）
  const injectedBinding = (globalThis as { __D1_BINDING__?: D1Binding })
    .__D1_BINDING__;
  if (injectedBinding) return injectedBinding;

  // 2) Workers / next dev：惰性读取 Cloudflare context
  let contextError: unknown;
  try {
    const env = getCloudflareContext().env as CloudflareEnv & {
      DB?: D1Binding;
    };
    if (env.DB) return env.DB;
  } catch (error) {
    contextError = error;
  }

  throw new Error(
    UNAVAILABLE_MESSAGE,
    contextError === undefined ? undefined : { cause: contextError },
  );
}

/**
 * 获取全站唯一数据库实例（首次调用时解析绑定并缓存）。
 *
 * 无可用绑定（构建期静态生成、裸 Node 脚本、未注入测试库）时抛出
 * `[db] D1 binding "DB" unavailable. ...`；需要「有库才跑」的守卫请用
 * `isDbAvailable()`，不要直接 try/catch。
 */
export function getDb(): Db {
  if (testDb) return testDb;
  if (!instance) instance = drizzle(resolveBinding(), { schema });
  return instance;
}

/**
 * 不抛错地判断当前是否可用数据库。
 *
 * 替代旧的 `if (!process.env.DATABASE_URL)` 守卫：D1 绑定存在（或已注入
 * 测试库）→ true；构建期/无绑定 → false。
 */
export function isDbAvailable(): boolean {
  try {
    getDb();
    return true;
  } catch {
    return false;
  }
}

/**
 * vitest 专用：注入基于本地 D1 / better-sqlite3 的 drizzle 实例。
 *
 * 参数类型刻意放宽为 `object`：D1 与 better-sqlite3 / libsql 的 drizzle
 * 实例类型互不兼容，但共享同一套 SQLite 查询构建器 API，注入后由 `db`
 * Proxy 运行时原样转发（`db` 的静态类型仍按 D1 实例暴露）。
 *
 * 传 `null` 清除注入并同时丢弃真实绑定缓存（每个测试文件建议
 * `afterAll(() => setDbForTesting(null))`，避免跨用例串味）。
 *
 * @example
 * import Database from "better-sqlite3";
 * import { drizzle } from "drizzle-orm/better-sqlite3";
 * import { setDbForTesting } from "@/lib/db";
 * import * as schema from "@/lib/db/schema";
 * setDbForTesting(drizzle(new Database(":memory:"), { schema }));
 */
export function setDbForTesting(next: object | null): void {
  testDb = next as Db | null;
  instance = undefined;
}

/**
 * 全站唯一数据库入口，零改动兼容既有的 `db.select()...` 调用点。
 *
 * Proxy 把任意属性访问转发到 `getDb()`；方法必须 bind 到真实 drizzle 实例，
 * 否则内部 `this.session`／`this.dialect` 丢失会报错（drizzle 方法依赖实例状态）。
 * 非函数属性（如 `$client`、`query`）原样返回。
 */
export const db: Db = new Proxy({} as Db, {
  get(_target, prop) {
    const target = getDb() as unknown as Record<PropertyKey, unknown>;
    const value = Reflect.get(target, prop, target);
    return typeof value === "function" ? value.bind(target) : value;
  },
});

export { schema };
