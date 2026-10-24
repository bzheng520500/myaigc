import { and, count, desc, eq, ilike, ne, or, type SQL } from "drizzle-orm";
import { cacheLife } from "next/cache";
import { REVALIDATE_CONTENT } from "@/lib/constants";
import { db } from "@/lib/db";
import { skills, users, type Skill } from "@/lib/db/schema";

/**
 * Skill 库列表查询（Task 6）。
 *
 * 缓存策略与 lib/queries/home.ts 一致：next.config.ts 开启 cacheComponents，
 * ISR 语义由函数级 "use cache" + cacheLife 承载——revalidate = 300s。
 * 页面的 category / q / page 筛选会改变入参，"use cache" 按参数分别缓存。
 */

/** 每页条数（列表页与 Pagination 共用） */
export const PAGE_SIZE = 20;

/** 列表页消费的技能行（独立定义，比 home.ts 的多 id / viewCount / createdAt） */
export type SkillRow = Pick<
  Skill,
  "id" | "slug" | "name" | "description" | "category" | "viewCount" | "createdAt"
>;

const skillColumns = {
  id: skills.id,
  slug: skills.slug,
  name: skills.name,
  description: skills.description,
  category: skills.category,
  viewCount: skills.viewCount,
  createdAt: skills.createdAt,
};

export type ListSkillsOptions = {
  category?: string;
  q?: string;
  page?: number;
};

/** 组装过滤条件：published + category 精确匹配 + q 对 name/description ILIKE */
function buildFilters({ category, q }: ListSkillsOptions): SQL | undefined {
  const filters: (SQL | undefined)[] = [eq(skills.status, "published")];
  if (category) {
    filters.push(eq(skills.category, category));
  }
  if (q) {
    const pattern = `%${q}%`;
    filters.push(or(ilike(skills.name, pattern), ilike(skills.description, pattern)));
  }
  return and(...filters);
}

export async function listSkills(
  opts: ListSkillsOptions = {},
): Promise<{ items: SkillRow[]; total: number }> {
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
      .select(skillColumns)
      .from(skills)
      .where(where)
      .orderBy(desc(skills.createdAt))
      .limit(PAGE_SIZE)
      .offset((page - 1) * PAGE_SIZE),
    db.select({ value: count() }).from(skills).where(where),
  ]);

  return { items, total: totalRows[0]?.value ?? 0 };
}

export async function listCategories(): Promise<string[]> {
  "use cache";
  cacheLife({ stale: 300, revalidate: REVALIDATE_CONTENT, expire: 3600 });

  // 无数据库环境（如纯静态构建）：返回空数组，页面不 crash
  if (!process.env.DATABASE_URL) {
    return [];
  }

  const rows = await db
    .selectDistinct({ category: skills.category })
    .from(skills)
    .where(eq(skills.status, "published"))
    .orderBy(skills.category);

  return rows.map((row) => row.category);
}

/** 详情页消费的完整行（Task 7）：全部列 + 作者（内置内容无作者 → null） */
export type SkillFullRow = Skill & {
  author: { name: string | null; email: string } | null;
};

/**
 * 按 slug 取 Skill 详情（Task 7）。
 *
 * status='removed' 或不存在 → null；缓存策略与 listSkills 一致（300s ISR）。
 */
export async function getSkillBySlug(slug: string): Promise<SkillFullRow | null> {
  "use cache";
  cacheLife({ stale: 300, revalidate: REVALIDATE_CONTENT, expire: 3600 });

  // 无数据库环境（如纯静态构建）：视为不存在
  if (!process.env.DATABASE_URL) {
    return null;
  }

  const [row] = await db
    .select({ skill: skills, authorName: users.name, authorEmail: users.email })
    .from(skills)
    .leftJoin(users, eq(skills.authorId, users.id))
    .where(and(eq(skills.slug, slug), ne(skills.status, "removed")))
    .limit(1);

  if (!row) return null;

  return {
    ...row.skill,
    author:
      row.skill.authorId && row.authorEmail
        ? { name: row.authorName, email: row.authorEmail }
        : null,
  };
}
