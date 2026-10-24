import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import * as schema from "./schema";

function createDb(databaseUrl: string) {
  return drizzle({ client: neon(databaseUrl), schema });
}

const databaseUrl = process.env.DATABASE_URL;

/**
 * 全站唯一数据库实例（Neon serverless HTTP driver）。
 *
 * neon() 是惰性的：构造阶段不校验连接串，因此 DATABASE_URL 未配置时
 * （如本地 vitest 无 .env）import 不会 crash，不影响测试收集；
 * 首次真正发起查询时才会因无效连接串报错。
 * 生产 / Vercel / drizzle-kit push 必须设置 DATABASE_URL。
 */
export const db = createDb(databaseUrl ?? "");

export { schema };
