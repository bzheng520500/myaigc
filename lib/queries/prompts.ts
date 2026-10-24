import { and, asc, count, eq, ilike, or, type SQL } from "drizzle-orm";
import { cacheLife } from "next/cache";
import { REVALIDATE_CONTENT } from "@/lib/constants";
import { db } from "@/lib/db";
import { prompts, type Prompt } from "@/lib/db/schema";

/**
 * 运镜提示词库列表查询（Task 8）。
 *
 * 缓存策略与 lib/queries/skills.ts 一致：next.config.ts 开启 cacheComponents，
 * ISR 语义由函数级 "use cache" + cacheLife 承载——revalidate = 300s。
 * 页面的 category / q / page 筛选会改变入参，"use cache" 按参数分别缓存。
 */

/** 每页条数（列表页与 Pagination 共用） */
export const PAGE_SIZE = 20;

/** 卡片消费的提示词行（不含 createdAt / sortOrder） */
export type PromptRow = Pick<
  Prompt,
  | "id"
  | "name"
  | "category"
  | "promptEn"
  | "promptZh"
  | "notes"
  | "imageUrl"
  | "copyCount"
  | "sourceDoc"
>;

const promptColumns = {
  id: prompts.id,
  name: prompts.name,
  category: prompts.category,
  promptEn: prompts.promptEn,
  promptZh: prompts.promptZh,
  notes: prompts.notes,
  imageUrl: prompts.imageUrl,
  copyCount: prompts.copyCount,
  sourceDoc: prompts.sourceDoc,
};

export type ListPromptsOptions = {
  category?: string;
  q?: string;
  page?: number;
};

/** 组装过滤条件：category 精确匹配 + q 对 name/promptZh ILIKE（中文搜索为主） */
function buildFilters({ category, q }: ListPromptsOptions): SQL | undefined {
  const filters: (SQL | undefined)[] = [];
  if (category) {
    filters.push(eq(prompts.category, category));
  }
  if (q) {
    const pattern = `%${q}%`;
    filters.push(
      or(ilike(prompts.name, pattern), ilike(prompts.promptZh, pattern)),
    );
  }
  return and(...filters);
}

export async function listPrompts(
  opts: ListPromptsOptions = {},
): Promise<{ items: PromptRow[]; total: number }> {
  "use cache";
  cacheLife({ stale: 300, revalidate: REVALIDATE_CONTENT, expire: 3600 });

  // 无数据库环境（如纯静态构建）：返回空数据，页面不 crash
  if (!process.env.DATABASE_URL) {
    return { items: [], total: 0 };
  }

  const where = buildFilters(opts);
  // page 兜底：<1 或 NaN 归 1，越界由 offset 自然截断（items 空、total 不变）
  const page = Math.max(1, Math.floor(opts.page ?? 1)) || 1;

  const [items, totalRows] = await Promise.all([
    db
      .select(promptColumns)
      .from(prompts)
      .where(where)
      .orderBy(asc(prompts.sortOrder), asc(prompts.sourceDoc))
      .limit(PAGE_SIZE)
      .offset((page - 1) * PAGE_SIZE),
    db.select({ value: count() }).from(prompts).where(where),
  ]);

  return { items, total: totalRows[0]?.value ?? 0 };
}

export async function listPromptCategories(): Promise<string[]> {
  "use cache";
  cacheLife({ stale: 300, revalidate: REVALIDATE_CONTENT, expire: 3600 });

  // 无数据库环境（如纯静态构建）：返回空数组，页面不 crash
  if (!process.env.DATABASE_URL) {
    return [];
  }

  const rows = await db
    .selectDistinct({ category: prompts.category })
    .from(prompts)
    .orderBy(prompts.category);

  return rows.map((row) => row.category);
}
