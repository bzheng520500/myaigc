import { and, count, desc, eq, like, ne, or, type SQL } from "drizzle-orm";
import { db, isDbAvailable } from "@/lib/db";
import { skills, users, type Skill } from "@/lib/db/schema";

/**
 * Skill 库列表查询（Task 6）。
 *
 * 缓存：无。Cloudflare Workers 不支持 cacheComponents/PPR（页面会
 * hang），页面统一 force-dynamic，本文件查询每次请求实时读 D1。
 */

/** 每页条数（列表页与 Pagination 共用） */
export const PAGE_SIZE = 20;

/** 列表页消费的技能行（独立定义，比 home.ts 的多 id / viewCount / createdAt） */
export type SkillRow = Pick<
  Skill,
  | "id"
  | "slug"
  | "name"
  | "description"
  | "category"
  | "viewCount"
  | "createdAt"
  | "contentMd"
>;

const skillColumns = {
  id: skills.id,
  slug: skills.slug,
  name: skills.name,
  description: skills.description,
  category: skills.category,
  viewCount: skills.viewCount,
  createdAt: skills.createdAt,
  // 列表页卡片的复制按钮需要全文（与提示词库一致）。34 条 Skill 正文
  // 合计约 42K 字符、单页 20 条约 25K，D1 单次查询可接受。
  contentMd: skills.contentMd,
};

export type ListSkillsOptions = {
  category?: string;
  q?: string;
  page?: number;
  /**
   * 排序（终审 F4）：
   * - "new"（默认）：created_at desc（最新优先）
   * - "hot"：view_count desc，同分按 created_at desc 次序（最热优先）
   */
  sort?: "new" | "hot";
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
 * 组装过滤条件：published + category 精确匹配 + q 对 name/description LIKE。
 * D1（SQLite）无 ILIKE：用 LIKE（ASCII 默认大小写不敏感，中文按字节比较）。
 */
function buildFilters({ category, q }: ListSkillsOptions): SQL | undefined {
  const filters: (SQL | undefined)[] = [eq(skills.status, "published")];
  if (category) {
    filters.push(eq(skills.category, category));
  }
  if (q) {
    const pattern = toLikePattern(q);
    filters.push(or(like(skills.name, pattern), like(skills.description, pattern)));
  }
  return and(...filters);
}

export async function listSkills(
  opts: ListSkillsOptions = {},
): Promise<{ items: SkillRow[]; total: number }> {

  // 无数据库环境（如纯静态构建）：返回空数据，页面不 crash
  if (!isDbAvailable()) {
    return { items: [], total: 0 };
  }

  const where = buildFilters(opts);
  // page 兜底：<1 或 NaN 归 1，越界由 offset 自然截断（items 空、total 不变）
  const page = Math.max(1, Math.floor(opts.page ?? 1)) || 1;
  // 终审 F4：hot = view_count desc + created_at desc 次序；默认 new 不变
  const orderBy =
    opts.sort === "hot"
      ? [desc(skills.viewCount), desc(skills.createdAt)]
      : [desc(skills.createdAt)];

  const [items, totalRows] = await Promise.all([
    db
      .select(skillColumns)
      .from(skills)
      .where(where)
      .orderBy(...orderBy)
      .limit(PAGE_SIZE)
      .offset((page - 1) * PAGE_SIZE),
    db.select({ value: count() }).from(skills).where(where),
  ]);

  return { items, total: totalRows[0]?.value ?? 0 };
}

export async function listCategories(): Promise<string[]> {

  // 无数据库环境（如纯静态构建）：返回空数组，页面不 crash
  if (!isDbAvailable()) {
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

  // 无数据库环境（如纯静态构建）：视为不存在
  if (!isDbAvailable()) {
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
