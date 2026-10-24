import { count, desc, eq } from "drizzle-orm";
import { cacheLife } from "next/cache";
import { REVALIDATE_CONTENT } from "@/lib/constants";
import { db } from "@/lib/db";
import {
  prompts,
  skills,
  threads,
  tutorials,
  type Skill,
} from "@/lib/db/schema";

/**
 * 首页数据查询（Task 5）。
 *
 * 缓存策略：next.config.ts 开启 cacheComponents（Next.js 16 已移除
 * `export const revalidate` 段配置），ISR 语义由函数级 "use cache" +
 * cacheLife 承载——revalidate = REVALIDATE_CONTENT（300s）。
 */

/** 首页四格统计 */
export type HomeStats = {
  skills: number;
  prompts: number;
  tutorials: number;
  threads: number;
};

/** SkillCard 及列表消费的技能行（Skill 类型子集） */
export type SkillRow = Pick<Skill, "slug" | "name" | "description" | "category">;

export type HomeData = {
  stats: HomeStats;
  featured: SkillRow[];
  latest: SkillRow[];
};

const skillColumns = {
  slug: skills.slug,
  name: skills.name,
  description: skills.description,
  category: skills.category,
};

export async function getHomeData(): Promise<HomeData> {
  "use cache";
  cacheLife({ stale: 300, revalidate: REVALIDATE_CONTENT, expire: 3600 });

  // 无数据库环境（如纯静态构建）：返回空数据，页面不 crash
  if (!process.env.DATABASE_URL) {
    return {
      stats: { skills: 0, prompts: 0, tutorials: 0, threads: 0 },
      featured: [],
      latest: [],
    };
  }

  const [skillCountRows, promptCountRows, tutorialCountRows, threadCountRows, featured, latest] =
    await Promise.all([
      db
        .select({ value: count() })
        .from(skills)
        .where(eq(skills.status, "published")),
      db.select({ value: count() }).from(prompts),
      db.select({ value: count() }).from(tutorials),
      db
        .select({ value: count() })
        .from(threads)
        .where(eq(threads.status, "published")),
      db
        .select(skillColumns)
        .from(skills)
        .where(eq(skills.status, "published"))
        .orderBy(desc(skills.viewCount))
        .limit(6),
      db
        .select(skillColumns)
        .from(skills)
        .where(eq(skills.status, "published"))
        .orderBy(desc(skills.createdAt))
        .limit(8),
    ]);

  return {
    stats: {
      skills: skillCountRows[0]?.value ?? 0,
      prompts: promptCountRows[0]?.value ?? 0,
      tutorials: tutorialCountRows[0]?.value ?? 0,
      threads: threadCountRows[0]?.value ?? 0,
    },
    featured,
    latest,
  };
}
