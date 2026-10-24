import { and, eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
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
import {
  createNotification,
  getUnreadCount,
  listNotifications,
  markAllReadForUser,
  markRead,
  NOTIFICATIONS_PAGE_SIZE,
} from "@/lib/notify";

/**
 * 通知域库 lib/notify.ts（Phase 3 Task 2）。
 *
 * Review Focus #2（通知防刷屏去重）：同 actor 同源的未读 like 通知
 * 合并为一行——10 连赞后断言仅 1 条未读、created_at 被顶到最新。
 *
 * lib/notify 不依赖 auth() / next-cache（userId 一律由调用方传入），
 * 无需 mock；连库用例与 interactions.test.ts 同模式，无 DATABASE_URL
 * 时整体 skip。用例间存在数据依赖（先造通知行，再断言列表 / 标读），
 * 与 forum.test.ts 的串行探针风格一致。
 */

describe.skipIf(!process.env.DATABASE_URL)("通知域连库", () => {
  const uniq = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const forumSlug = `p3b-forum-${uniq}`;
  const skillSlug = `p3b-skill-${uniq}`;

  // 探针三用户：A 通知接收者（发帖 / Skill 作者）；B / C 触发者
  let userIdA: string;
  let userIdB: string;
  let userIdC: string;
  let forumId: string;
  let threadId: string;
  let replyId: string;
  let skillId: string;
  let commentId: string;

  beforeAll(async () => {
    const inserted = await db
      .insert(users)
      .values([
        { name: `通知接收A-${uniq}`, email: `p3b-a-${uniq}@test.local` },
        { name: `触发者B-${uniq}`, email: `p3b-b-${uniq}@test.local` },
        { name: `触发者C-${uniq}`, email: `p3b-c-${uniq}@test.local` },
      ])
      .returning({ id: users.id });
    [userIdA, userIdB, userIdC] = inserted.map((u) => u.id);

    const [forum] = await db
      .insert(forums)
      .values({ slug: forumSlug, name: `通知板块-${uniq}`, sortOrder: 900005 })
      .returning({ id: forums.id });
    forumId = forum.id;

    const [thread] = await db
      .insert(threads)
      .values({
        forumId,
        authorId: userIdA,
        title: `通知主帖-${uniq}`,
        contentMd: "# 主帖",
      })
      .returning({ id: threads.id });
    threadId = thread.id;

    const [reply] = await db
      .insert(replies)
      .values({
        threadId,
        authorId: userIdB,
        contentMd: "# 一楼",
        floorNumber: 1,
      })
      .returning({ id: replies.id });
    replyId = reply.id;

    const [skill] = await db
      .insert(skills)
      .values({
        slug: skillSlug,
        name: `通知技能-${uniq}`,
        contentMd: "# 技能正文",
        category: `通知分类-${uniq}`,
        authorId: userIdA,
        source: "user",
      })
      .returning({ id: skills.id });
    skillId = skill.id;

    const [comment] = await db
      .insert(comments)
      .values({
        userId: userIdB,
        targetType: "skill",
        targetId: skillId,
        content: "通知探针评论",
        status: "visible",
      })
      .returning({ id: comments.id });
    commentId = comment.id;
  });

  afterAll(async () => {
    // 清理顺序（外键依赖）：notifications → comments → replies → threads → skills → forums → users
    await db
      .delete(notifications)
      .where(
        inArray(notifications.userId, [userIdA, userIdB, userIdC]),
      );
    await db.delete(comments).where(eq(comments.userId, userIdB));
    await db.delete(replies).where(eq(replies.threadId, threadId));
    await db.delete(threads).where(eq(threads.forumId, forumId));
    await db.delete(skills).where(eq(skills.authorId, userIdA));
    await db.delete(forums).where(eq(forums.id, forumId));
    await db
      .delete(users)
      .where(inArray(users.id, [userIdA, userIdB, userIdC]));
  });

  it("自通知跳过：actorId === userId 时库中无行（不触库直接返回）", async () => {
    await createNotification({
      userId: userIdA,
      actorId: userIdA,
      type: "like",
      sourceType: "thread",
      sourceId: threadId,
    });

    const selfRows = await db
      .select({ id: notifications.id })
      .from(notifications)
      .where(
        and(eq(notifications.userId, userIdA), eq(notifications.actorId, userIdA)),
      );
    expect(selfRows).toHaveLength(0);
  });

  it("thread_reply 插入成功：B 回复 A 的帖子 → A 名下 1 行、字段正确、未读", async () => {
    await createNotification({
      userId: userIdA,
      actorId: userIdB,
      type: "thread_reply",
      sourceType: "thread",
      sourceId: threadId,
    });

    const rows = await db
      .select()
      .from(notifications)
      .where(
        and(
          eq(notifications.userId, userIdA),
          eq(notifications.type, "thread_reply"),
        ),
      );
    expect(rows).toHaveLength(1);
    expect(rows[0].actorId).toBe(userIdB);
    expect(rows[0].sourceType).toBe("thread");
    expect(rows[0].sourceId).toBe(threadId);
    expect(rows[0].readAt).toBeNull();
  });

  it("like 型同源合并（Review Focus #2）：10 连赞仅 1 行未读，created_at 被顶新", async () => {
    // 第一次：无既存未读 → 插入
    await createNotification({
      userId: userIdA,
      actorId: userIdB,
      type: "like",
      sourceType: "thread",
      sourceId: threadId,
    });
    const [first] = await db
      .select({ createdAt: notifications.createdAt })
      .from(notifications)
      .where(
        and(
          eq(notifications.userId, userIdA),
          eq(notifications.type, "like"),
          eq(notifications.actorId, userIdB),
        ),
      );
    expect(first).toBeDefined();

    // 再来 9 次：全部命中未读同源 → update created_at，不插新行
    for (let i = 0; i < 9; i++) {
      await createNotification({
        userId: userIdA,
        actorId: userIdB,
        type: "like",
        sourceType: "thread",
        sourceId: threadId,
      });
    }

    const rows = await db
      .select()
      .from(notifications)
      .where(
        and(
          eq(notifications.userId, userIdA),
          eq(notifications.type, "like"),
          eq(notifications.actorId, userIdB),
          eq(notifications.sourceType, "thread"),
          eq(notifications.sourceId, threadId),
        ),
      );
    expect(rows).toHaveLength(1); // 10 连赞 = 1 条
    expect(rows[0].readAt).toBeNull(); // 仍是未读
    expect(rows[0].createdAt.getTime()).toBeGreaterThan(
      first.createdAt.getTime(),
    ); // 合并时 created_at 顶到最新
  });

  it("like 型不同 actor 不合并：C 同源再赞 → 累计 2 行", async () => {
    await createNotification({
      userId: userIdA,
      actorId: userIdC,
      type: "like",
      sourceType: "thread",
      sourceId: threadId,
    });

    const rows = await db
      .select({ id: notifications.id })
      .from(notifications)
      .where(
        and(
          eq(notifications.userId, userIdA),
          eq(notifications.type, "like"),
          eq(notifications.sourceType, "thread"),
        ),
      );
    expect(rows).toHaveLength(2);
  });

  it("skill_comment 插入成功（sourceType=comment，link 解析备用）", async () => {
    await createNotification({
      userId: userIdA,
      actorId: userIdB,
      type: "skill_comment",
      sourceType: "comment",
      sourceId: commentId,
    });

    const rows = await db
      .select({ id: notifications.id })
      .from(notifications)
      .where(
        and(
          eq(notifications.userId, userIdA),
          eq(notifications.type, "skill_comment"),
        ),
      );
    expect(rows).toHaveLength(1);
  });

  it("reply 源 like 通知插入成功（link 解析经 replies→threads→forums）", async () => {
    await createNotification({
      userId: userIdA,
      actorId: userIdB,
      type: "like",
      sourceType: "reply",
      sourceId: replyId,
    });

    const rows = await db
      .select({ id: notifications.id })
      .from(notifications)
      .where(
        and(
          eq(notifications.userId, userIdA),
          eq(notifications.sourceType, "reply"),
        ),
      );
    expect(rows).toHaveLength(1);
  });

  it("listNotifications：link 解析四类正确 + created_at 倒序 + unread 计数", async () => {
    // B 也收一条（markAllRead 隔离断言备用；源沿用探针帖即可，通知表不校验归属）
    await createNotification({
      userId: userIdB,
      actorId: userIdA,
      type: "like",
      sourceType: "thread",
      sourceId: threadId,
    });

    // A 名下 5 行：thread_reply / like(thread,B) / like(thread,C) / skill_comment / like(reply,B)
    const { items, unread } = await listNotifications(userIdA);
    expect(items).toHaveLength(5);
    expect(unread).toBe(5);

    // created_at 倒序：最后插入的 reply 源 like 排最前
    expect(items[0].sourceType).toBe("reply");
    expect(items[1].type).toBe("skill_comment");

    // link 解析（Review：thread → /forum/{slug}/{id}；comment→skill → /skills/{slug}）
    expect(items[0].link).toBe(`/forum/${forumSlug}/${threadId}`);
    expect(items[1].link).toBe(`/skills/${skillSlug}`);
    expect(items[2].link).toBe(`/forum/${forumSlug}/${threadId}`); // C 的 thread 源 like
    expect(items[3].link).toBe(`/forum/${forumSlug}/${threadId}`); // B 的 thread 源 like（合并行）
    expect(items[4].link).toBe(`/forum/${forumSlug}/${threadId}`); // thread_reply

    // actorName join users 正确（thread_reply 的 actor 是 B）
    expect(items[4].actorName).toBe(`触发者B-${uniq}`);
    expect(items[4].type).toBe("thread_reply");

    // 用户隔离：B 只有自己那 1 条
    const forB = await listNotifications(userIdB);
    expect(forB.items).toHaveLength(1);
    expect(forB.unread).toBe(1);
  });

  it("getUnreadCount 与 listNotifications.unread 一致", async () => {
    await expect(getUnreadCount(userIdA)).resolves.toBe(5);
    await expect(getUnreadCount(userIdB)).resolves.toBe(1);
  });

  it("listNotifications 分页：page=2 → 空 items、unread 不变（总数另行统计）", async () => {
    const { items, unread } = await listNotifications(userIdA, 2);
    expect(items).toHaveLength(0);
    expect(unread).toBe(5);
    expect(NOTIFICATIONS_PAGE_SIZE).toBe(20);
  });

  it("markRead 仅本人生效：B 标 A 的通知 → false 且未读不变；A 标自己的 → true", async () => {
    const { items } = await listNotifications(userIdA);
    const target = items[0]; // reply 源 like

    // B 试图标 A 的通知：不命中（user_id 不匹配）
    await expect(markRead(target.id, userIdB)).resolves.toBe(false);
    await expect(getUnreadCount(userIdA)).resolves.toBe(5);

    // A 标自己的：true → 未读 -1
    await expect(markRead(target.id, userIdA)).resolves.toBe(true);
    await expect(getUnreadCount(userIdA)).resolves.toBe(4);

    // 幂等：已读再标 → false（read_at is null 条件不再命中）
    await expect(markRead(target.id, userIdA)).resolves.toBe(false);
    await expect(getUnreadCount(userIdA)).resolves.toBe(4);

    // 非法 uuid 不触库直接 false
    await expect(markRead("not-a-uuid", userIdA)).resolves.toBe(false);
    // 不存在的 id → false
    await expect(
      markRead("3f1c6d92-8b17-4e2a-9c4d-5a6b7c8d9e0f", userIdA),
    ).resolves.toBe(false);
  });

  it("markAllReadForUser：A 全部已读 → unread=0；B 的通知不受影响", async () => {
    const updated = await markAllReadForUser(userIdA);
    expect(updated).toBe(4); // 上个用例剩 4 条未读

    await expect(getUnreadCount(userIdA)).resolves.toBe(0);
    await expect(getUnreadCount(userIdB)).resolves.toBe(1);

    const { items } = await listNotifications(userIdA);
    expect(items.every((n) => n.readAt !== null)).toBe(true);
  });
});
