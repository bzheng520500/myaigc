import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import type { PlatformProxy } from "wrangler";
import { db, getDb, isDbAvailable, schema, setDbForTesting } from "@/lib/db";
import { simulateNoDatabase } from "@/tests/helpers/db";

/**
 * db 连接冒烟（Cloudflare D1 架构）。
 *
 * 1. 无库分支（任何环境都跑）：`setDbForTesting(null)` 后 `isDbAvailable()`
 *    必须为 false，`getDb()` 抛 `[db] D1 binding "DB" unavailable`；
 * 2. 本地 D1 连库分支（默认 skip）：先 `npm run db:migrate:local`，再设
 *    `D1_LOCAL_TEST=1` 运行（Windows Git Bash：`D1_LOCAL_TEST=1 npx vitest run
 *    tests/unit/db/connection.test.ts`）。用 wrangler 的 `getPlatformProxy()`
 *    读取 wrangler.jsonc 的 `env.DB`，注入 drizzle 实例后执行 `select 1`。
 *    拿不到 proxy（wrangler 未就绪 / 配置错误）时用例 skip 而非 fail。
 */

/* ---------------------------------------------------------------- */
/* 无库分支：守卫契约（不抛错地判断 + 触库时信息明确的错误）             */
/* ---------------------------------------------------------------- */

describe("db 连接守卫（无库分支）", () => {
  // 即使 Phase E 的 setup 全局注入了 __D1_BINDING__，这里也模拟「无绑定」
  const restoreDatabase = simulateNoDatabase();

  afterAll(() => {
    restoreDatabase();
  });

  it("setDbForTesting(null) 后 isDbAvailable() 为 false", () => {
    expect(isDbAvailable()).toBe(false);
  });

  it("getDb() 抛出 D1 绑定缺失错误（可 grep 的明文提示）", () => {
    expect(() => getDb()).toThrow(/\[db\] D1 binding "DB" unavailable/);
  });
});

/* ---------------------------------------------------------------- */
/* 本地 D1 连库分支（D1_LOCAL_TEST=1 才启用）                          */
/* ---------------------------------------------------------------- */

/** wrangler.jsonc 里 d1_databases[0].binding = "DB" */
type LocalD1Env = { DB: Parameters<typeof drizzle>[0] };

describe.skipIf(!process.env.D1_LOCAL_TEST)(
  "D1 本地连库冒烟（D1_LOCAL_TEST=1，需先 db:migrate:local）",
  () => {
    let proxy: PlatformProxy<LocalD1Env> | undefined;

    beforeAll(async () => {
      try {
        const { getPlatformProxy } = await import("wrangler");
        const localProxy = await getPlatformProxy<LocalD1Env>({
          configPath: "wrangler.jsonc",
        });
        setDbForTesting(drizzle(localProxy.env.DB, { schema }));
        proxy = localProxy;
      } catch (error) {
        // 拿不到本地 D1 代理：清空注入并让各用例 skip（不 fail）
        setDbForTesting(null);
        console.warn(
          "[connection.test] 无法获取本地 D1 绑定，连库用例跳过：",
          error,
        );
      }
    });

    afterAll(async () => {
      setDbForTesting(null);
      await proxy?.dispose();
    });

    it("select 1 连通（db.get 返回 { ok: 1 }）", async (ctx) => {
      if (!isDbAvailable()) ctx.skip();
      const row = await db.get(sql`select 1 as ok`);
      expect(row).toEqual({ ok: 1 });
    });

    it('"user" 表可查询（迁移已应用）', async (ctx) => {
      if (!isDbAvailable()) ctx.skip();
      const rows = await db.all<{ n: number }>(
        sql`select count(*) as n from "user"`,
      );
      expect(rows).toHaveLength(1);
    });
  },
);
