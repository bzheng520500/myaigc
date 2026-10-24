import { describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";

/**
 * 连库冒烟测试：Neon 未就位（无 DATABASE_URL）时自动跳过，
 * 控制器统一 push 后设置 DATABASE_URL 即可执行。
 */
describe.skipIf(!process.env.DATABASE_URL)("db 连接冒烟", () => {
  it("select 1 连通", async () => {
    const result = await db.execute(sql`select 1 as ok`);
    const rows = result.rows as { ok: number }[];
    expect(rows[0]?.ok).toBe(1);
  });

  it("users 表可查询", async () => {
    await expect(db.execute(sql`select count(*) from "user"`)).resolves.toBeDefined();
  });
});
