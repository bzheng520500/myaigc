import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as getInteractionsRoute } from "@/app/api/me/interactions/route";
import { GET as getNotificationsCountRoute } from "@/app/api/me/notifications-count/route";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import {
  comments,
  favorites,
  forums,
  likes,
  replies,
  skills,
  threads,
  users,
} from "@/lib/db/schema";
import {
  getMyInteractions,
  toggleFavorite,
  toggleLike,
} from "@/lib/actions/interactions";

/**
 * 点赞 / 收藏 server actions + 个性化状态 API（Phase 3 Task 1）。
 *
 * Review Focus：
 * - #1 并发点赞竞态：Promise.all 双击同目标，唯一约束保证只有一方 +1
 * - #3 未登录 401：/api/me/* 两路由未登录返回 401 {error:"unauthorized"}
 *
 * - 纯逻辑（无库可跑）：未登录 / 非法 targetType / 非法 UUID，全部在触库前返回
 * - 连库：toggleLike 往返与幂等、并发双击终态、四类目标计数联动、
 *   toggleFavorite 往返、getMyInteractions 命中/空/截断
 *
 * mock（与 upload.test.ts / forum.test.ts 同模式）：@/lib/auth 注入登录态。
 * interactions.ts 不调 revalidatePath（计数展示由 action 响应驱动），无需 mock next/cache。
 */

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(),
}));

const authMock = vi.mocked(auth);

/** 注入已登录用户（database 策略 session.user 含 id；auth 是多重载类型用 never cast） */
function loginAs(userId: string) {
  authMock.mockResolvedValue({ user: { id: userId } } as never);
}

/** 合法 uuid（不存在的随机 id，用于纯逻辑分支探测） */
const RANDOM_UUID = "3f1c6d92-8b17-4e2a-9c4d-5a6b7c8d9e0f";

/** API 路由探测用 Request（route handler 标准签名 Request → NextResponse） */
function apiRequest(path: string): Request {
  return new Request(`http://localhost${path}`);
}

/* ---------------------------------------------------------------- */
/* 纯逻辑：触库之前的分支                                              */
/* ---------------------------------------------------------------- */

describe("toggleLike / toggleFavorite / getMyInteractions 前置分支（纯逻辑）", () => {
  beforeEach(() => {
    authMock.mockReset();
  });

  it("toggleLike：auth() 抛错（vitest 无请求上下文）→ 兜底按未登录拒绝", async () => {
    authMock.mockImplementation(() => {
      throw new Error("no request context");
    });
    await expect(toggleLike("thread", RANDOM_UUID)).resolves.toEqual({
      ok: false,
      error: "unauthorized",
    });
  });

  it("toggleLike：auth() 返回 null（无 session）→ 未登录拒绝", async () => {
    authMock.mockResolvedValue(null as never);
    await expect(toggleLike("thread", RANDOM_UUID)).resolves.toEqual({
      ok: false,
      error: "unauthorized",
    });
  });

  it("toggleFavorite：未登录拒绝", async () => {
    authMock.mockResolvedValue(null as never);
    await expect(toggleFavorite("skill", RANDOM_UUID)).resolves.toEqual({
      ok: false,
      error: "unauthorized",
    });
  });

  it("getMyInteractions：未登录返回两个空数组（不报错，供客户端挂载拉取）", async () => {
    authMock.mockResolvedValue(null as never);
    await expect(getMyInteractions([`thread:${RANDOM_UUID}`])).resolves.toEqual({
      liked: [],
      favorited: [],
    });
  });

  it("toggleLike：targetType 枚举外（如 post）→ invalid（触库前）", async () => {
    loginAs(RANDOM_UUID);
    await expect(toggleLike("post" as never, RANDOM_UUID)).resolves.toEqual({
      ok: false,
      error: "invalid",
    });
  });

  it("toggleLike：非法 UUID → invalid（触库前，避免 PG 类型错误）", async () => {
    loginAs(RANDOM_UUID);
    await expect(toggleLike("thread", "not-a-uuid")).resolves.toEqual({
      ok: false,
      error: "invalid",
    });
  });

  it("toggleFavorite：targetType 枚举外（reply/comment 不是收藏目标）→ invalid", async () => {
    loginAs(RANDOM_UUID);
    await expect(toggleFavorite("comment" as never, RANDOM_UUID)).resolves.toEqual({
      ok: false,
      error: "invalid",
    });
    await expect(toggleFavorite("reply" as never, RANDOM_UUID)).resolves.toEqual({
      ok: false,
      error: "invalid",
    });
  });
});

/* ---------------------------------------------------------------- */
/* API 路由：未登录 401（Review Focus #3）                            */
/* ---------------------------------------------------------------- */

describe("/api/me/* 路由（纯逻辑：401 分支与占位响应）", () => {
  beforeEach(() => {
    authMock.mockReset();
  });

  it("GET /api/me/interactions：未登录 → 401 {error:'unauthorized'}", async () => {
    authMock.mockResolvedValue(null as never);
    const res = await getInteractionsRoute(
      apiRequest(`/api/me/interactions?targets=thread:${RANDOM_UUID}`),
    );
    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toEqual({ error: "unauthorized" });
  });

  it("GET /api/me/notifications-count：未登录 → 401", async () => {
    authMock.mockResolvedValue(null as never);
    const res = await getNotificationsCountRoute();
    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toEqual({ error: "unauthorized" });
  });

  it("GET /api/me/notifications-count：已登录 → 200 {unread:0}（T2 前占位，不触库）", async () => {
    loginAs(RANDOM_UUID);
    const res = await getNotificationsCountRoute();
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ unread: 0 });
  });
});

/* ---------------------------------------------------------------- */
/* 连库：往返 / 并发竞态 / 计数联动 / 命中查询                          */
/* ---------------------------------------------------------------- */

describe.skipIf(!process.env.D1_LOCAL_TEST)("点赞收藏连库", () => {
  const uniq = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  let userId: string;
  let forumId: string;
  let threadId: string;
  let replyId: string;
  let skillId: string;
  let commentId: string;

  beforeAll(async () => {
    const [user] = await db
      .insert(users)
      .values({ name: `互动测试者-${uniq}`, email: `p3a-liker-${uniq}@test.local` })
      .returning({ id: users.id });
    userId = user.id;

    const [forum] = await db
      .insert(forums)
      .values({ slug: `p3a-forum-${uniq}`, name: `互动板块-${uniq}`, sortOrder: 900004 })
      .returning({ id: forums.id });
    forumId = forum.id;

    const [thread] = await db
      .insert(threads)
      .values({
        forumId,
        authorId: userId,
        title: `互动主帖-${uniq}`,
        contentMd: "# 主帖",
      })
      .returning({ id: threads.id });
    threadId = thread.id;

    const [reply] = await db
      .insert(replies)
      .values({
        threadId,
        authorId: userId,
        contentMd: "# 一楼",
        floorNumber: 1,
      })
      .returning({ id: replies.id });
    replyId = reply.id;

    const [skill] = await db
      .insert(skills)
      .values({
        slug: `p3a-skill-${uniq}`,
        name: `互动技能-${uniq}`,
        contentMd: "# 技能正文",
        category: "测试分类",
        authorId: userId,
        source: "user",
      })
      .returning({ id: skills.id });
    skillId = skill.id;

    const [comment] = await db
      .insert(comments)
      .values({
        userId,
        targetType: "skill",
        targetId: skillId,
        content: "互动测试评论",
        status: "visible",
      })
      .returning({ id: comments.id });
    commentId = comment.id;
  });

  afterAll(async () => {
    // 清理顺序（外键依赖）：likes → favorites → comments → replies → threads → skills → forums → users
    await db.delete(likes).where(eq(likes.userId, userId));
    await db.delete(favorites).where(eq(favorites.userId, userId));
    await db.delete(comments).where(eq(comments.userId, userId));
    await db.delete(replies).where(eq(replies.threadId, threadId));
    await db.delete(threads).where(eq(threads.forumId, forumId));
    await db.delete(skills).where(eq(skills.authorId, userId));
    await db.delete(forums).where(eq(forums.id, forumId));
    await db.delete(users).where(eq(users.id, userId));
  });

  beforeEach(() => {
    authMock.mockReset();
  });

  it("toggleLike 帖子往返：+1 → -1 → count 随动，liked 翻转", async () => {
    loginAs(userId);

    const first = await toggleLike("thread", threadId);
    expect(first).toEqual({ ok: true, liked: true, count: 1 });

    const second = await toggleLike("thread", threadId);
    expect(second).toEqual({ ok: true, liked: false, count: 0 });
  });

  it("toggleLike 无行时为点赞：计数绝不漂移为负（无状态开关）", async () => {
    loginAs(userId);
    // 上一用例终态为未赞（无行）→ 本次是点赞而非扣分
    const result = await toggleLike("thread", threadId);
    expect(result).toEqual({ ok: true, liked: true, count: 1 });

    // 收尾：取消，回到未赞（后续用例以「无行 + count 0」为前置）
    await expect(toggleLike("thread", threadId)).resolves.toEqual({
      ok: true,
      liked: false,
      count: 0,
    });

    const [row] = await db
      .select({ likeCount: threads.likeCount })
      .from(threads)
      .where(eq(threads.id, threadId));
    expect(row.likeCount).toBe(0);
  });

  it("并发双击（Promise.all 同目标）：唯一约束保证只有一方 +1（Review Focus #1）", async () => {
    loginAs(userId);

    // 前置：目标无 like 行、计数 0（不依赖前序用例的收尾）
    await db.delete(likes).where(
      and(
        eq(likes.userId, userId),
        eq(likes.targetType, "thread"),
        eq(likes.targetId, threadId),
      ),
    );
    await db
      .update(threads)
      .set({ likeCount: 0 })
      .where(eq(threads.id, threadId));

    const [a, b] = await Promise.all([
      toggleLike("thread", threadId),
      toggleLike("thread", threadId),
    ]);
    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);
    if (!a.ok || !b.ok) return;

    // 恰好一方 insert 成功（唯一约束防线：绝不出现两行 likes / 双 +1），
    // 另一方必然走删除分支。insert 与计数 update 是分步语句
    // （D1 无交互式事务），并发下 ±1 的执行顺序可能交错
    // （瞬时 count 可为 0/-1/1），故不断言单次响应的瞬时计数，
    // 只断言「只有一方 +1」与终态净零。
    const winners = [a, b].filter((r) => r.liked);
    expect(winners).toHaveLength(1);
    const winner = winners[0];
    const loser = winner === a ? b : a;
    expect(winner.count).toBeLessThanOrEqual(1); // 绝不双 +1（若两方都 +1 则为 2）
    expect(loser.liked).toBe(false);

    // 终态：likes 无残留行、like_count 净变化 0（+1 与 -1 各恰一次，绝不 +2）
    const likeRows = await db
      .select({ id: likes.id })
      .from(likes)
      .where(
        and(
          eq(likes.userId, userId),
          eq(likes.targetType, "thread"),
          eq(likes.targetId, threadId),
        ),
      );
    expect(likeRows).toHaveLength(0);

    const [row] = await db
      .select({ likeCount: threads.likeCount })
      .from(threads)
      .where(eq(threads.id, threadId));
    expect(row.likeCount).toBe(0);
  });

  it("toggleLike 四类目标计数联动：reply / comment / skill 各自表 like_count +1 后归零", async () => {
    loginAs(userId);

    for (const [type, id, table] of [
      ["reply", replyId, replies],
      ["comment", commentId, comments],
      ["skill", skillId, skills],
    ] as const) {
      const on = await toggleLike(type, id);
      expect(on).toEqual({ ok: true, liked: true, count: 1 });

      const [row] = await db
        .select({ likeCount: table.likeCount })
        .from(table)
        .where(eq(table.id, id));
      expect(row.likeCount).toBe(1);

      const off = await toggleLike(type, id);
      expect(off).toEqual({ ok: true, liked: false, count: 0 });
    }
  });

  it("toggleFavorite 往返：skill / thread 各自 favorited 翻转", async () => {
    loginAs(userId);

    await expect(toggleFavorite("skill", skillId)).resolves.toEqual({
      ok: true,
      favorited: true,
    });
    await expect(toggleFavorite("thread", threadId)).resolves.toEqual({
      ok: true,
      favorited: true,
    });

    // toggle 是无状态开关：第 3 次是取消，第 4 次必然重新收藏（不是幂等）
    await expect(toggleFavorite("skill", skillId)).resolves.toEqual({
      ok: true,
      favorited: false,
    });
    await expect(toggleFavorite("skill", skillId)).resolves.toEqual({
      ok: true,
      favorited: true,
    });
    // 收尾：全部取消，后续用例以「无收藏行」为前置
    await expect(toggleFavorite("skill", skillId)).resolves.toEqual({
      ok: true,
      favorited: false,
    });
    await expect(toggleFavorite("thread", threadId)).resolves.toEqual({
      ok: true,
      favorited: false,
    });
  });

  it("getMyInteractions：命中已赞/已藏 + 非法项跳过", async () => {
    loginAs(userId);
    // 造状态：赞 thread + reply，藏 skill（上一用例收藏已全部取消）
    await toggleLike("thread", threadId);
    await toggleLike("reply", replyId);
    await toggleFavorite("skill", skillId);

    const result = await getMyInteractions([
      `thread:${threadId}`,
      `reply:${replyId}`,
      `comment:${commentId}`, // 未赞 → 不在结果
      `skill:${skillId}`, // 已藏 → favorited
      "bogus", // 无冒号 → 跳过
      "forum:" + RANDOM_UUID, // 类型不在枚举 → 跳过
      `thread:not-a-uuid`, // 非法 uuid → 跳过
      "", // 空串 → 跳过
    ]);
    expect(result.liked.sort()).toEqual([replyId, threadId].sort());
    expect(result.favorited).toEqual([skillId]);
  });

  it("getMyInteractions：已登录但无任何互动 → 两个空数组", async () => {
    loginAs(crypto.randomUUID()); // 无任何互动的全新用户
    const result = await getMyInteractions([`thread:${threadId}`]);
    expect(result).toEqual({ liked: [], favorited: [] });
  });

  it("getMyInteractions：超过 100 项截断（第 101 项被忽略）", async () => {
    loginAs(userId);
    const targets = Array.from(
      { length: 100 },
      () => `skill:${crypto.randomUUID()}`, // 100 个合法但不存在的占位项
    );
    targets.push(`thread:${threadId}`); // 第 101 项：真实已赞目标，应被截断忽略

    const result = await getMyInteractions(targets);
    expect(result.liked).toEqual([]);
  });

  it("GET /api/me/interactions：已登录 → 200 且按 targets 返回状态", async () => {
    loginAs(userId); // 上一用例遗留：thread 已赞、skill 已藏
    const res = await getInteractionsRoute(
      apiRequest(
        `/api/me/interactions?targets=${encodeURIComponent(`thread:${threadId},skill:${skillId}`)}`,
      ),
    );
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      liked: [threadId],
      favorited: [skillId],
    });
  });
});
