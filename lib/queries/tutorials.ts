import { asc, eq } from "drizzle-orm";
import { db, isDbAvailable } from "@/lib/db";
import { tutorials, type Tutorial } from "@/lib/db/schema";

/**
 * Tutorial 查询（Task 9）。缓存：无。Cloudflare Workers 不支持
 * cacheComponents/PPR（页面会 hang），页面统一 force-dynamic，
 * 本文件查询每次请求实时读 D1。
 */

/** 列表页消费的教程行（不含 contentMd 全文） */
export type TutorialRow = Pick<
  Tutorial,
  "id" | "slug" | "title" | "summary" | "category" | "sortOrder"
>;

const tutorialColumns = {
  id: tutorials.id,
  slug: tutorials.slug,
  title: tutorials.title,
  summary: tutorials.summary,
  category: tutorials.category,
  sortOrder: tutorials.sortOrder,
};

/** 教程列表：按 sort_order 升序（内置内容的展示顺序） */
export async function listTutorials(): Promise<TutorialRow[]> {

  // 无数据库环境（如纯静态构建）：返回空列表，页面走空态
  if (!isDbAvailable()) {
    return [];
  }

  return db
    .select(tutorialColumns)
    .from(tutorials)
    .orderBy(asc(tutorials.sortOrder));
}

/** 详情页：按 slug 取完整教程（含 contentMd 全文），不存在 → null */
export async function getTutorialBySlug(slug: string): Promise<Tutorial | null> {

  // 无数据库环境（如纯静态构建）：视为不存在
  if (!isDbAvailable()) {
    return null;
  }

  const [row] = await db
    .select()
    .from(tutorials)
    .where(eq(tutorials.slug, slug))
    .limit(1);

  return row ?? null;
}
