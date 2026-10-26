import { and, asc, count, eq, like, or, type SQL } from "drizzle-orm";
import { db, isDbAvailable } from "@/lib/db";
import { prompts, type Prompt } from "@/lib/db/schema";

/**
 * 运镜提示词库列表查询（Task 8）。
 *
 * 缓存：无。Cloudflare Workers 不支持 cacheComponents/PPR（页面会
 * hang），页面统一 force-dynamic，本文件查询每次请求实时读 D1。
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

/**
 * D1 对 LIKE 模式有 50 字节硬上限（含两侧通配符）：关键词按码点截到 12 个
 * 字符（UTF-8 单字符最多 4 字节 → 48 字节 + 2 个 % = 50），防止超长搜索词
 * 让查询直接报错。
 */
function toLikePattern(term: string): string {
  return `%${Array.from(term).slice(0, 12).join("")}%`;
}

/**
 * 组装过滤条件：category 精确匹配 + q 对 name/promptZh LIKE（中文搜索为主）。
 * D1（SQLite）无 ILIKE：用 LIKE（ASCII 默认大小写不敏感，中文按字节比较）。
 */
function buildFilters({ category, q }: ListPromptsOptions): SQL | undefined {
  const filters: (SQL | undefined)[] = [];
  if (category) {
    filters.push(eq(prompts.category, category));
  }
  if (q) {
    const pattern = toLikePattern(q);
    filters.push(
      or(like(prompts.name, pattern), like(prompts.promptZh, pattern)),
    );
  }
  return and(...filters);
}

export async function listPrompts(
  opts: ListPromptsOptions = {},
): Promise<{ items: PromptRow[]; total: number }> {

  // 无数据库环境（如纯静态构建）：返回空数据，页面不 crash
  if (!isDbAvailable()) {
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

  // 无数据库环境（如纯静态构建）：返回空数组，页面不 crash
  if (!isDbAvailable()) {
    return [];
  }

  const rows = await db
    .selectDistinct({ category: prompts.category })
    .from(prompts)
    .orderBy(prompts.category);

  return rows.map((row) => row.category);
}
