import { and, count, desc, eq, gte } from "drizzle-orm";
import { db, isDbAvailable } from "@/lib/db";
import {
  forums,
  prompts,
  skills,
  threads,
  tutorials,
  type Skill,
} from "@/lib/db/schema";

/**
 * 首页数据查询（Task 5）。
 *
 * 缓存：无。Cloudflare Workers 不支持 cacheComponents/PPR（页面会
 * hang），页面统一 force-dynamic，本文件查询每次请求实时读 D1。
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
  hotThreads: HotThreadRow[];
};

/** 首页「论坛热帖」行（join forums 取板块名，Phase 4 Task 1） */
export type HotThreadRow = {
  id: string;
  title: string;
  replyCount: number;
  forumSlug: string;
  forumName: string;
};

/** 热帖窗口：只看近 30 天发帖（新鲜度优先，避免老帖霸榜） */
const HOT_THREAD_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * 首页热帖：published 帖按近 30 天窗口过滤、reply_count 倒序取 limit 条
 * （is_pinned 不参与排序——首页按热度而非运营位）。
 */
export async function getHotThreads(limit = 5): Promise<HotThreadRow[]> {

  // 无数据库环境（如纯静态构建）：返回空列表，页面走空态
  if (!isDbAvailable()) {
    return [];
  }

  // limit 兜底：与 listLatestThreads 同风格，NaN / <1 归默认 5
  const safeLimit = Math.max(1, Math.floor(limit)) || 5;

  return db
    .select({
      id: threads.id,
      title: threads.title,
      replyCount: threads.replyCount,
      forumSlug: forums.slug,
      forumName: forums.name,
    })
    .from(threads)
    .innerJoin(forums, eq(threads.forumId, forums.id))
    .where(
      and(
        eq(threads.status, "published"),
        gte(threads.createdAt, new Date(Date.now() - HOT_THREAD_WINDOW_MS)),
      ),
    )
    .orderBy(desc(threads.replyCount))
    .limit(safeLimit);
}

const skillColumns = {
  slug: skills.slug,
  name: skills.name,
  description: skills.description,
  category: skills.category,
};

export async function getHomeData(): Promise<HomeData> {

  // 无数据库环境（如纯静态构建）：返回空数据，页面不 crash
  if (!isDbAvailable()) {
    return {
      stats: { skills: 0, prompts: 0, tutorials: 0, threads: 0 },
      featured: [],
      latest: [],
      hotThreads: [],
    };
  }

  const [
    skillCountRows,
    promptCountRows,
    tutorialCountRows,
    threadCountRows,
    featured,
    latest,
  ] = await Promise.all([
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

  // D1 单次 invocation 最多 6 个并发连接：热帖查询放到上面 6 路批次之后串行执行
  const hotThreads = await getHotThreads(5);

  return {
    stats: {
      skills: skillCountRows[0]?.value ?? 0,
      prompts: promptCountRows[0]?.value ?? 0,
      tutorials: tutorialCountRows[0]?.value ?? 0,
      threads: threadCountRows[0]?.value ?? 0,
    },
    featured,
    latest,
    hotThreads,
  };
}
