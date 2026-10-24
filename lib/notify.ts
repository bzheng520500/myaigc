import { and, count, desc, eq, gte, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  comments,
  forums,
  notifications,
  replies,
  skills,
  threads,
  users,
} from "@/lib/db/schema";

/**
 * 通知域库（Phase 3 Task 2）。
 *
 * 按决策放 lib/notify.ts（通知域内聚），不用 "use cache"——
 * 个人数据禁缓存（cacheComponents 铁律）。
 *
 * - createNotification：通知是旁路逻辑，整体 try/catch 静默
 *   （通知失败不阻塞主流程，调用方无需再包 try/catch）。
 *   like 型防刷屏去重（Review Focus #2）：同 (userId, actorId,
 *   sourceType, sourceId, type='like') 的**未读**行存在 → 只把
 *   created_at 顶到 now（合并为一条，简化 Ruling：未读期间同源合并，
 *   比 24h 窗口更严格）；已读 / 无行 → 插入新行。
 * - listNotifications：分页 20 条 + 未读总数 + link 批量解析
 *   （thread / reply / comment / skill 四类各一次 join 查询）。
 * - markRead / markAllReadForUser：仅本人（user_id 匹配）可标读。
 */

/** 通知类型（schema notifications.type 合法值） */
export type NotificationType =
  | "thread_reply"
  | "reply_reply"
  | "skill_comment"
  | "like";

/** 通知源类型（schema notifications.source_type 合法值） */
export type NotificationSourceType = "thread" | "reply" | "comment" | "skill";

export type CreateNotificationInput = {
  /** 接收者 */
  userId: string;
  /** 触发者（actorId === userId 时自通知跳过） */
  actorId: string;
  type: NotificationType;
  sourceType: NotificationSourceType;
  sourceId: string;
};

/** 通知中心列表行（join users 取 actorName，link 已解析） */
export type NotificationItem = {
  id: string;
  type: NotificationType;
  actorName: string | null;
  sourceType: NotificationSourceType;
  sourceId: string;
  readAt: Date | null;
  createdAt: Date;
  /** 源目标已删等解析失败时为 null（渲染纯文本，不渲染链接） */
  link: string | null;
};

/** 通知中心每页条数 */
export const NOTIFICATIONS_PAGE_SIZE = 20;

/** notifications.id / sourceId 为 uuid 列：非法格式不触库（防 PG invalid input syntax） */
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function createNotification(
  input: CreateNotificationInput,
): Promise<void> {
  // 自通知跳过（自己回复 / 点赞自己的内容不打扰自己）
  if (input.actorId === input.userId) return;
  // 无数据库环境（纯静态构建）：静默返回
  if (!process.env.DATABASE_URL) return;

  try {
    if (input.type === "like") {
      // 防刷屏去重：未读同源合并（见文件头注释），命中即顶新 created_at 返回
      const merged = await db
        .update(notifications)
        .set({ createdAt: sql`now()` })
        .where(
          and(
            eq(notifications.userId, input.userId),
            eq(notifications.actorId, input.actorId),
            eq(notifications.type, "like"),
            eq(notifications.sourceType, input.sourceType),
            eq(notifications.sourceId, input.sourceId),
            isNull(notifications.readAt),
          ),
        )
        .returning({ id: notifications.id });
      if (merged.length > 0) return;
    }

    await db.insert(notifications).values({
      userId: input.userId,
      actorId: input.actorId,
      type: input.type,
      sourceType: input.sourceType,
      sourceId: input.sourceId,
    });
  } catch {
    // 通知是旁路：写失败静默吞掉，不阻塞主流程
  }
}

export async function listNotifications(
  userId: string,
  page?: number,
  opts?: { since?: Date },
): Promise<{ items: NotificationItem[]; unread: number }> {
  if (!process.env.DATABASE_URL) {
    return { items: [], unread: 0 };
  }

  // page 兜底与 lib/queries/forum.ts 的 listThreads 同风格：<1 / NaN 归 1
  const safePage = Math.max(1, Math.floor(page ?? 1)) || 1;
  // since（终审 F3）：只统计 created_at >= since 的通知（每日摘要 24h 窗口
  // 用）；不传时行为不变（全量）。items 与 unread 计数同步过滤，保证
  // 「窗口外有未读」的用户在摘要侧等价于无新通知。
  const sinceCond = opts?.since
    ? gte(notifications.createdAt, opts.since)
    : undefined;

  const [rows, unreadRows] = await Promise.all([
    db
      .select({
        id: notifications.id,
        type: notifications.type,
        actorName: users.name,
        sourceType: notifications.sourceType,
        sourceId: notifications.sourceId,
        readAt: notifications.readAt,
        createdAt: notifications.createdAt,
      })
      .from(notifications)
      .leftJoin(users, eq(notifications.actorId, users.id))
      .where(and(eq(notifications.userId, userId), sinceCond))
      .orderBy(desc(notifications.createdAt))
      .limit(NOTIFICATIONS_PAGE_SIZE)
      .offset((safePage - 1) * NOTIFICATIONS_PAGE_SIZE),
    db
      .select({ value: count() })
      .from(notifications)
      .where(
        and(
          eq(notifications.userId, userId),
          isNull(notifications.readAt),
          sinceCond,
        ),
      ),
  ]);

  // link 解析：按 sourceType 分组，各一次批量 join 查询
  const byType = (type: NotificationSourceType) =>
    rows.filter((r) => r.sourceType === type).map((r) => r.sourceId);

  const threadIds = byType("thread");
  const replyIds = byType("reply");
  const commentIds = byType("comment");
  const skillIds = byType("skill");

  const [threadRows, replyRows, commentRows, skillRows] = await Promise.all([
    threadIds.length > 0
      ? db
          .select({ id: threads.id, forumSlug: forums.slug })
          .from(threads)
          .innerJoin(forums, eq(threads.forumId, forums.id))
          .where(inArray(threads.id, threadIds))
      : Promise.resolve([]),
    replyIds.length > 0
      ? db
          .select({ id: replies.id, threadId: threads.id, forumSlug: forums.slug })
          .from(replies)
          .innerJoin(threads, eq(replies.threadId, threads.id))
          .innerJoin(forums, eq(threads.forumId, forums.id))
          .where(inArray(replies.id, replyIds))
      : Promise.resolve([]),
    // comment 源：join comments → skills 取 skill 详情 slug
    // （本期仅 skill 评论产生通知；tutorial 评论 link 解析不到 → null）
    commentIds.length > 0
      ? db
          .select({ id: comments.id, skillSlug: skills.slug })
          .from(comments)
          .innerJoin(
            skills,
            and(
              eq(comments.targetType, "skill"),
              eq(comments.targetId, skills.id),
            ),
          )
          .where(inArray(comments.id, commentIds))
      : Promise.resolve([]),
    skillIds.length > 0
      ? db
          .select({ id: skills.id, skillSlug: skills.slug })
          .from(skills)
          .where(inArray(skills.id, skillIds))
      : Promise.resolve([]),
  ]);

  const linkMap = new Map<string, string>();
  for (const row of threadRows) {
    linkMap.set(`thread:${row.id}`, `/forum/${row.forumSlug}/${row.id}`);
  }
  for (const row of replyRows) {
    linkMap.set(`reply:${row.id}`, `/forum/${row.forumSlug}/${row.threadId}`);
  }
  for (const row of commentRows) {
    linkMap.set(`comment:${row.id}`, `/skills/${row.skillSlug}`);
  }
  for (const row of skillRows) {
    linkMap.set(`skill:${row.id}`, `/skills/${row.skillSlug}`);
  }

  const items: NotificationItem[] = rows.map((row) => ({
    id: row.id,
    type: row.type as NotificationType,
    actorName: row.actorName,
    sourceType: row.sourceType as NotificationSourceType,
    sourceId: row.sourceId,
    readAt: row.readAt,
    createdAt: row.createdAt,
    link: linkMap.get(`${row.sourceType}:${row.sourceId}`) ?? null,
  }));

  return { items, unread: unreadRows[0]?.value ?? 0 };
}

export async function getUnreadCount(userId: string): Promise<number> {
  if (!process.env.DATABASE_URL) return 0;

  try {
    const [row] = await db
      .select({ value: count() })
      .from(notifications)
      .where(
        and(eq(notifications.userId, userId), isNull(notifications.readAt)),
      );
    return row?.value ?? 0;
  } catch {
    // 计数探测失败按 0（铃铛静默降级，不给 401 之外的 5xx）
    return 0;
  }
}

/**
 * 标单条已读：仅本人的**未读**通知可标（user_id 匹配 + read_at is null）。
 * 已读再标 / 他人标读 / 不存在 → false（幂等语义）。
 */
export async function markRead(id: string, userId: string): Promise<boolean> {
  if (!process.env.DATABASE_URL || !UUID_RE.test(id)) return false;

  const rows = await db
    .update(notifications)
    .set({ readAt: sql`now()` })
    .where(
      and(
        eq(notifications.id, id),
        eq(notifications.userId, userId),
        isNull(notifications.readAt),
      ),
    )
    .returning({ id: notifications.id });
  return rows.length > 0;
}

/** 全部已读：本人所有未读 → read_at=now，返回更新行数 */
export async function markAllReadForUser(userId: string): Promise<number> {
  if (!process.env.DATABASE_URL) return 0;

  const rows = await db
    .update(notifications)
    .set({ readAt: sql`now()` })
    .where(and(eq(notifications.userId, userId), isNull(notifications.readAt)))
    .returning({ id: notifications.id });
  return rows.length;
}
