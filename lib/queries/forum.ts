import { and, asc, count, desc, eq, ne } from "drizzle-orm";
import { cacheLife } from "next/cache";
import { REVALIDATE_FORUM } from "@/lib/constants";
import { db } from "@/lib/db";
import { forums, replies, threads, users, type Forum, type Thread } from "@/lib/db/schema";

/**
 * 论坛查询（Phase 2 Task 1）。
 *
 * 缓存策略与 lib/queries/skills.ts 一致（cacheComponents 已开启）：
 * ISR 语义由函数级 "use cache" + cacheLife 承载——revalidate = 60s
 * （论坛互动密集，比内容页 300s 更短）；sort / page 筛选改变入参，
 * "use cache" 按参数分别缓存。
 *
 * 全部查询函数在无 DATABASE_URL 时短路返回空数据（纯静态构建不 crash）。
 */

/** 板块页每页帖数（列表页与分页组件共用） */
export const THREADS_PAGE_SIZE = 20;

/** 回复列表上限（单帖楼层不分页，YAGNI 上限兜底） */
const REPLIES_LIMIT = 500;

/** 论坛首页板块卡片消费的行 */
export type ForumRow = Pick<
  Forum,
  "id" | "slug" | "name" | "description" | "sortOrder" | "threadCount" | "replyCount"
>;

/** 板块页帖子列表行（join users 取作者名） */
export type ThreadListItem = {
  id: string;
  title: string;
  isPinned: boolean;
  isLocked: boolean;
  replyCount: number;
  viewCount: number;
  lastReplyAt: Date;
  createdAt: Date;
  authorId: string;
  authorName: string | null;
};

/** 帖子详情页楼层行（只含 visible；likeCount 供楼层点赞按钮初值，Phase 3） */
export type ReplyListItem = {
  id: string;
  floorNumber: number;
  contentMd: string;
  createdAt: Date;
  authorId: string;
  authorName: string | null;
  status: string;
  likeCount: number;
};

/** threads.id 为 uuid 列：非法格式直接视为不存在，避免 PG 抛 invalid input syntax */
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 板块列表：sort_order 升序 */
export async function listForums(): Promise<ForumRow[]> {
  "use cache";
  cacheLife({ stale: 60, revalidate: REVALIDATE_FORUM, expire: 3600 });

  // 无数据库环境（如纯静态构建）：返回空列表，页面走空态
  if (!process.env.DATABASE_URL) {
    return [];
  }

  return db
    .select({
      id: forums.id,
      slug: forums.slug,
      name: forums.name,
      description: forums.description,
      sortOrder: forums.sortOrder,
      threadCount: forums.threadCount,
      replyCount: forums.replyCount,
    })
    .from(forums)
    .orderBy(asc(forums.sortOrder));
}

export type ListThreadsOptions = {
  sort: "last_reply" | "created";
  page?: number;
};

/** 板块页帖子列表：置顶优先（is_pinned desc）+ 组内排序，hidden 排除 */
export async function listThreads(
  forumSlug: string,
  opts: ListThreadsOptions,
): Promise<{ items: ThreadListItem[]; total: number }> {
  "use cache";
  cacheLife({ stale: 60, revalidate: REVALIDATE_FORUM, expire: 3600 });

  // 无数据库环境（如纯静态构建）：返回空数据
  if (!process.env.DATABASE_URL) {
    return { items: [], total: 0 };
  }

  const where = and(eq(forums.slug, forumSlug), ne(threads.status, "hidden"));
  const withinGroup =
    opts.sort === "created" ? desc(threads.createdAt) : desc(threads.lastReplyAt);
  // page 兜底：<1 或 NaN 归 1，越界由 offset 自然截断（items 空、total 不变）
  const page = Math.max(1, Math.floor(opts.page ?? 1)) || 1;

  const [items, totalRows] = await Promise.all([
    db
      .select({
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
      })
      .from(threads)
      .innerJoin(users, eq(threads.authorId, users.id))
      .innerJoin(forums, eq(threads.forumId, forums.id))
      .where(where)
      .orderBy(desc(threads.isPinned), withinGroup)
      .limit(THREADS_PAGE_SIZE)
      .offset((page - 1) * THREADS_PAGE_SIZE),
    db
      .select({ value: count() })
      .from(threads)
      .innerJoin(forums, eq(threads.forumId, forums.id))
      .where(where),
  ]);

  return { items, total: totalRows[0]?.value ?? 0 };
}

/** 帖子详情：整行 + 作者名 + 所属板块 slug（hidden 或不存在 → null） */
export async function getThreadById(
  id: string,
): Promise<{ thread: Thread; authorName: string | null; forumSlug: string } | null> {
  "use cache";
  cacheLife({ stale: 60, revalidate: REVALIDATE_FORUM, expire: 3600 });

  // 无数据库环境（如纯静态构建）：视为不存在
  if (!process.env.DATABASE_URL || !UUID_RE.test(id)) {
    return null;
  }

  const [row] = await db
    .select({ thread: threads, authorName: users.name, forumSlug: forums.slug })
    .from(threads)
    .innerJoin(users, eq(threads.authorId, users.id))
    .innerJoin(forums, eq(threads.forumId, forums.id))
    .where(and(eq(threads.id, id), ne(threads.status, "hidden")))
    .limit(1);

  if (!row) return null;
  return { thread: row.thread, authorName: row.authorName, forumSlug: row.forumSlug };
}

/** 论坛首页「最新动态」行：帖子行 + 所属板块（跨板块跳转链接消费） */
export type LatestThreadItem = ThreadListItem & {
  forumSlug: string;
  forumName: string;
};

/** 全站最新帖（论坛首页）：last_reply_at 倒序、hidden 排除（Task 2 追加） */
export async function listLatestThreads(
  limit: number,
): Promise<LatestThreadItem[]> {
  "use cache";
  cacheLife({ stale: 60, revalidate: REVALIDATE_FORUM, expire: 3600 });

  // 无数据库环境（如纯静态构建）：返回空列表
  if (!process.env.DATABASE_URL) {
    return [];
  }

  // limit 兜底与 listThreads 的 page 同风格：NaN / <1 归 10
  const safeLimit = Math.max(1, Math.floor(limit)) || 10;

  return db
    .select({
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
      forumName: forums.name,
    })
    .from(threads)
    .innerJoin(users, eq(threads.authorId, users.id))
    .innerJoin(forums, eq(threads.forumId, forums.id))
    .where(ne(threads.status, "hidden"))
    .orderBy(desc(threads.lastReplyAt))
    .limit(safeLimit);
}

/** 板块单查（板块页 notFound 判定用，Task 2 追加） */
export async function getForumBySlug(slug: string): Promise<ForumRow | null> {
  "use cache";
  cacheLife({ stale: 60, revalidate: REVALIDATE_FORUM, expire: 3600 });

  // 无数据库环境（如纯静态构建）：视为不存在
  if (!process.env.DATABASE_URL) {
    return null;
  }

  const [row] = await db
    .select({
      id: forums.id,
      slug: forums.slug,
      name: forums.name,
      description: forums.description,
      sortOrder: forums.sortOrder,
      threadCount: forums.threadCount,
      replyCount: forums.replyCount,
    })
    .from(forums)
    .where(eq(forums.slug, slug))
    .limit(1);

  return row ?? null;
}

/** 帖子楼层列表：floor_number 升序，只返回 visible */
export async function listReplies(threadId: string): Promise<ReplyListItem[]> {
  "use cache";
  cacheLife({ stale: 60, revalidate: REVALIDATE_FORUM, expire: 3600 });

  // 无数据库环境（如纯静态构建）：返回空列表
  if (!process.env.DATABASE_URL || !UUID_RE.test(threadId)) {
    return [];
  }

  return db
    .select({
      id: replies.id,
      floorNumber: replies.floorNumber,
      contentMd: replies.contentMd,
      createdAt: replies.createdAt,
      authorId: replies.authorId,
      authorName: users.name,
      status: replies.status,
      likeCount: replies.likeCount,
    })
    .from(replies)
    .innerJoin(users, eq(replies.authorId, users.id))
    .where(and(eq(replies.threadId, threadId), eq(replies.status, "visible")))
    .orderBy(asc(replies.floorNumber))
    .limit(REPLIES_LIMIT);
}
