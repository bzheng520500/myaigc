import { and, desc, eq, ne } from "drizzle-orm";
import { db } from "@/lib/db";
import { favorites, forums, skills, threads, users, type Skill } from "@/lib/db/schema";
import type { ThreadListItem } from "@/lib/queries/forum";

/**
 * 用户主页查询（Phase 3 Task 3）。
 *
 * 个人数据禁缓存：本文件所有查询都不加 "use cache"（与
 * listNotifications 同策略）——帖子 / 上传 / 收藏列表是请求时
 * 真实状态，且本人视角随登录态变化，缓存反而展示陈旧内容。
 *
 * Review Focus #5（收藏失效项过滤）：收藏 join 目标表时即过滤
 * ——skills 只留 published（removed 视同不存在），threads 只留
 * 非 hidden；失效收藏行不会出现在主页收藏列表。
 */

/** 三列表（帖子 / 上传 / 收藏）每列表固定条数（分页不做，YAGNI） */
export const PROFILE_LIST_LIMIT = 20;

/** users.id 为 uuid 列：非法格式直接视为用户不存在，避免 PG invalid input syntax */
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 主页帖子行：ThreadListItem + forumSlug（ThreadRow 跳转帖详情用） */
export type ProfileThreadRow = ThreadListItem & { forumSlug: string };

/** 主页 / 收藏的技能行（SkillCard 消费的字段） */
export type ProfileSkillRow = Pick<
  Skill,
  "id" | "slug" | "name" | "description" | "category"
>;

/** 资料头五字段（email 供页面回退昵称前缀） */
export type ProfileUser = {
  id: string;
  name: string | null;
  image: string | null;
  email: string;
  createdAt: Date;
};

export type UserProfile = {
  user: ProfileUser;
  /** 本人帖（hidden 排除）createdAt desc */
  threads: ProfileThreadRow[];
  /** 本人上传（status='published'，removed 排除）createdAt desc */
  skills: ProfileSkillRow[];
  /** 收藏（失效项过滤：removed skill / hidden thread 不返回） */
  favorites: { skills: ProfileSkillRow[]; threads: ProfileThreadRow[] };
};

/**
 * 取用户主页数据。无库 / 非法 uuid / 用户不存在 → null（页面 notFound）。
 */
export async function getProfile(userId: string): Promise<UserProfile | null> {
  // 无数据库环境（如纯静态构建）：视为不存在
  if (!process.env.DATABASE_URL || !UUID_RE.test(userId)) {
    return null;
  }

  const [user] = await db
    .select({
      id: users.id,
      name: users.name,
      image: users.image,
      email: users.email,
      createdAt: users.createdAt,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (!user) return null;

  // 本人帖：join forums 取 slug（ThreadRow 帖详情链接），hidden 排除
  const threadColumns = {
    id: threads.id,
    title: threads.title,
    isPinned: threads.isPinned,
    isLocked: threads.isLocked,
    replyCount: threads.replyCount,
    viewCount: threads.viewCount,
    lastReplyAt: threads.lastReplyAt,
    createdAt: threads.createdAt,
    authorId: threads.authorId,
    authorName: users.name,
    forumSlug: forums.slug,
  };

  // 收藏 join threads：hidden 目标不返回（Focus #5，join 条件收口）
  const favoriteThreadJoin = and(
    eq(favorites.targetId, threads.id),
    ne(threads.status, "hidden"),
  );
  // 收藏 join skills：仅 published 目标返回（Focus #5，removed 视同下架）
  const favoriteSkillJoin = and(
    eq(favorites.targetId, skills.id),
    eq(skills.status, "published"),
  );

  const [ownThreads, ownSkills, favoriteSkills, favoriteThreads] =
    await Promise.all([
      db
        .select(threadColumns)
        .from(threads)
        .innerJoin(users, eq(threads.authorId, users.id))
        .innerJoin(forums, eq(threads.forumId, forums.id))
        .where(and(eq(threads.authorId, userId), ne(threads.status, "hidden")))
        .orderBy(desc(threads.createdAt))
        .limit(PROFILE_LIST_LIMIT),
      db
        .select({
          id: skills.id,
          slug: skills.slug,
          name: skills.name,
          description: skills.description,
          category: skills.category,
        })
        .from(skills)
        .where(and(eq(skills.authorId, userId), eq(skills.status, "published")))
        .orderBy(desc(skills.createdAt))
        .limit(PROFILE_LIST_LIMIT),
      db
        .select({
          id: skills.id,
          slug: skills.slug,
          name: skills.name,
          description: skills.description,
          category: skills.category,
        })
        .from(favorites)
        .innerJoin(skills, favoriteSkillJoin)
        .where(
          and(eq(favorites.userId, userId), eq(favorites.targetType, "skill")),
        )
        .orderBy(desc(favorites.createdAt))
        .limit(PROFILE_LIST_LIMIT),
      db
        .select(threadColumns)
        .from(favorites)
        .innerJoin(threads, favoriteThreadJoin)
        .innerJoin(users, eq(threads.authorId, users.id))
        .innerJoin(forums, eq(threads.forumId, forums.id))
        .where(
          and(eq(favorites.userId, userId), eq(favorites.targetType, "thread")),
        )
        .orderBy(desc(favorites.createdAt))
        .limit(PROFILE_LIST_LIMIT),
    ]);

  return {
    user,
    threads: ownThreads,
    skills: ownSkills,
    favorites: { skills: favoriteSkills, threads: favoriteThreads },
  };
}
