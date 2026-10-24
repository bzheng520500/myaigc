import { asc, eq } from "drizzle-orm";
import { cacheLife } from "next/cache";
import { REVALIDATE_CONTENT } from "@/lib/constants";
import { db } from "@/lib/db";
import { tutorials, type Tutorial } from "@/lib/db/schema";

/**
 * Tutorial 查询（Task 9）。缓存策略与 lib/queries/skills.ts 一致：
 * next.config.ts 开启 cacheComponents，ISR 语义由函数级 "use cache"
 * + cacheLife 承载（revalidate = 300s）。
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
  "use cache";
  cacheLife({ stale: 300, revalidate: REVALIDATE_CONTENT, expire: 3600 });

  // 无数据库环境（如纯静态构建）：返回空列表，页面走空态
  if (!process.env.DATABASE_URL) {
    return [];
  }

  return db
    .select(tutorialColumns)
    .from(tutorials)
    .orderBy(asc(tutorials.sortOrder));
}

/** 详情页：按 slug 取完整教程（含 contentMd 全文），不存在 → null */
export async function getTutorialBySlug(slug: string): Promise<Tutorial | null> {
  "use cache";
  cacheLife({ stale: 300, revalidate: REVALIDATE_CONTENT, expire: 3600 });

  // 无数据库环境（如纯静态构建）：视为不存在
  if (!process.env.DATABASE_URL) {
    return null;
  }

  const [row] = await db
    .select()
    .from(tutorials)
    .where(eq(tutorials.slug, slug))
    .limit(1);

  return row ?? null;
}
