import { eq, inArray, sql, type SQLWrapper } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { forums, replies, threads, users } from "@/lib/db/schema";
import { createReply, createThread, notifyReplied } from "@/lib/actions/forum";

/**
 * 发帖 / 回复 server actions（Phase 2 Task 1，Review Focus #1 并发楼层、
 * Review Focus #2 锁定帖二次校验）。
 *
 * - 纯逻辑（无库可跑）：未登录 / 长度校验 / 非法 threadId，全部在触库前返回
 * - 连库：createThread 合法插入 + 限流；createReply 楼层连续、
 *   Promise.all 并发楼层不重、锁定 / hidden 拒绝、限流
 *
 * mock（与 upload.test.ts 同模式）：@/lib/auth 注入登录态；
 * next/cache 的 revalidatePath 只能在 Next runtime 内调用。
 */

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(),
}));

const authMock = vi.mocked(auth);

/** 注入已登录用户（database 策略 session.user 含 id；auth 是多重载类型用 never cast） */
function loginAs(userId: string) {
  authMock.mockResolvedValue({ user: { id: userId } } as never);
}

/** 合法 uuid（不存在的随机 id，用于纯逻辑分支探测） */
const RANDOM_UUID = "0b2b0e35-0a44-4a5e-a3af-6d3349cd00f1";

/* ---------------------------------------------------------------- */
/* 纯逻辑：触库之前的分支                                              */
/* ---------------------------------------------------------------- */

describe("createThread / createReply 前置分支（纯逻辑）", () => {
  beforeEach(() => {
    authMock.mockReset();
  });

  it("createThread：auth() 抛错（vitest 无请求上下文）→ 按未登录拒绝", async () => {
    authMock.mockImplementation(() => {
      throw new Error("no request context");
    });
    await expect(
      createThread({ forumSlug: "creation", title: "标题", contentMd: "正文" }),
    ).resolves.toEqual({ ok: false, error: "请先登录后再发帖" });
  });

  it("createThread：auth() 返回 null → 未登录拒绝", async () => {
    authMock.mockResolvedValue(null as never);
    await expect(
      createThread({ forumSlug: "creation", title: "标题", contentMd: "正文" }),
    ).resolves.toEqual({ ok: false, error: "请先登录后再发帖" });
  });

  it("createThread：标题空白 → 标题错误（触库前返回）", async () => {
    loginAs(RANDOM_UUID);
    await expect(
      createThread({ forumSlug: "creation", title: "   ", contentMd: "正文" }),
    ).resolves.toEqual({ ok: false, error: "标题不能为空" });
  });

  it("createThread：标题超过 100 字 → 标题错误", async () => {
    loginAs(RANDOM_UUID);
    await expect(
      createThread({ forumSlug: "creation", title: "长".repeat(101), contentMd: "正文" }),
    ).resolves.toEqual({ ok: false, error: "标题不能超过 100 字" });
  });

  it("createThread：正文空白 → 正文错误", async () => {
    loginAs(RANDOM_UUID);
    await expect(
      createThread({ forumSlug: "creation", title: "标题", contentMd: "  \n " }),
    ).resolves.toEqual({ ok: false, error: "正文不能为空" });
  });

  it("createThread：正文超过 50KB → 正文错误", async () => {
    loginAs(RANDOM_UUID);
    await expect(
      createThread({
        forumSlug: "creation",
        title: "标题",
        contentMd: "x".repeat(50 * 1024 + 1),
      }),
    ).resolves.toEqual({ ok: false, error: "正文超过 50KB 限制" });
  });

  it("createReply：未登录拒绝", async () => {
    authMock.mockResolvedValue(null as never);
    await expect(createReply(RANDOM_UUID, "内容")).resolves.toEqual({
      ok: false,
      error: "请先登录后再回复",
    });
  });

  it("createReply：正文空白 → 错误", async () => {
    loginAs(RANDOM_UUID);
    await expect(createReply(RANDOM_UUID, "  ")).resolves.toEqual({
      ok: false,
      error: "回复内容不能为空",
    });
  });

  it("createReply：正文超过 10KB → 错误", async () => {
    loginAs(RANDOM_UUID);
    await expect(createReply(RANDOM_UUID, "x".repeat(10 * 1024 + 1))).resolves.toEqual({
      ok: false,
      error: "回复内容超过 10KB 限制",
    });
  });

  it("createReply：threadId 非法 uuid → 帖子不存在（不触发 PG 类型错误）", async () => {
    loginAs(RANDOM_UUID);
    await expect(createReply("not-a-uuid", "内容")).resolves.toEqual({
      ok: false,
      error: "帖子不存在或已隐藏",
    });
  });

  it("notifyReplied：Phase 3 前空实现，调用不抛错", async () => {
    await expect(
      notifyReplied(RANDOM_UUID, RANDOM_UUID, RANDOM_UUID, RANDOM_UUID),
    ).resolves.toBeUndefined();
  });
});

/* ---------------------------------------------------------------- */
/* 连库：createThread 插入/限流；createReply 楼层/并发/锁定/限流        */
/* ---------------------------------------------------------------- */

describe.skipIf(!process.env.DATABASE_URL)("createThread / createReply 连库", () => {
  const uniq = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const forumSlug = `p2a-forum-${uniq}`;

  // 七个探针用户：A 探针帖作者；B 发帖；C/D 楼层连续；E/F 并发回复；
  // G TOCTOU 用例（各用例不复用同一用户串行回复，避免撞限流窗口）
  let forumId: string;
  let userIds: string[];
  let threadId: string;
  let hiddenThreadId: string;
  let lockedThreadId: string;
  let authorId: string;
  let replierC: string;
  let replierD: string;
  let concurrentE: string;
  let concurrentF: string;
  let uploaderB: string;
  let toctouG: string;

  beforeAll(async () => {
    const inserted = await db
      .insert(users)
      .values([
        { name: `论坛作者A-${uniq}`, email: `p2a-a-${uniq}@test.local` },
        { name: `发帖者B-${uniq}`, email: `p2a-b-${uniq}@test.local` },
        { name: `回复者C-${uniq}`, email: `p2a-c-${uniq}@test.local` },
        { name: `回复者D-${uniq}`, email: `p2a-d-${uniq}@test.local` },
        { name: `并发者E-${uniq}`, email: `p2a-e-${uniq}@test.local` },
        { name: `并发者F-${uniq}`, email: `p2a-f-${uniq}@test.local` },
        { name: `TOCTOU者G-${uniq}`, email: `p2a-g-${uniq}@test.local` },
      ])
      .returning({ id: users.id });
    userIds = inserted.map((u) => u.id);
    [authorId, uploaderB, replierC, replierD, concurrentE, concurrentF, toctouG] =
      userIds;

    const [forum] = await db
      .insert(forums)
      .values({ slug: forumSlug, name: `连库板块-${uniq}`, sortOrder: 900003 })
      .returning({ id: forums.id });
    forumId = forum.id;

    const [main, hidden, locked] = await db
      .insert(threads)
      .values([
        {
          forumId,
          authorId,
          title: `连库主帖-${uniq}`,
          contentMd: "# 主帖",
        },
        {
          forumId,
          authorId,
          title: `连库隐藏帖-${uniq}`,
          contentMd: "# 隐藏",
          status: "hidden",
        },
        {
          forumId,
          authorId,
          title: `连库锁定帖-${uniq}`,
          contentMd: "# 锁定",
          isLocked: true,
        },
      ])
      .returning({ id: threads.id });
    threadId = main.id;
    hiddenThreadId = hidden.id;
    lockedThreadId = locked.id;
  });

  afterAll(async () => {
    // 清理顺序：replies → threads → forums → users（外键依赖）
    const forumThreads = await db
      .select({ id: threads.id })
      .from(threads)
      .where(eq(threads.forumId, forumId));
    const ids = forumThreads.map((t) => t.id);
    if (ids.length > 0) {
      await db.delete(replies).where(inArray(replies.threadId, ids));
    }
    await db.delete(threads).where(eq(threads.forumId, forumId));
    await db.delete(forums).where(eq(forums.id, forumId));
    await db.delete(users).where(inArray(users.id, userIds));
  });

  beforeEach(() => {
    authMock.mockReset();
  });

  it("createThread 合法输入 → ok:true + status=published + 板块 threadCount+1", async () => {
    loginAs(uploaderB);
    const result = await createThread({
      forumSlug,
      title: `合法发帖标题-${uniq}`,
      contentMd: "# 合法正文",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.id).toBeTruthy();

    const [row] = await db.select().from(threads).where(eq(threads.id, result.id));
    expect(row.status).toBe("published");
    expect(row.authorId).toBe(uploaderB);
    expect(row.forumId).toBe(forumId);
    // lastReplyAt 发帖时即写入（板块页排序依据）
    expect(row.lastReplyAt).toEqual(row.createdAt);

    const [forum] = await db.select().from(forums).where(eq(forums.id, forumId));
    expect(forum.threadCount).toBe(1);
  });

  it("createThread：5 分钟内已发 1 帖 → 限流拒绝", async () => {
    loginAs(uploaderB);
    await expect(
      createThread({ forumSlug, title: "第二帖标题", contentMd: "正文" }),
    ).resolves.toEqual({ ok: false, error: "发帖太频繁，请 5 分钟后再试" });
  });

  it("createThread：板块不存在（登录且校验通过后触库探测）", async () => {
    loginAs(uploaderB); // uploaderB 已被限流，但板块校验先于限流
    await expect(
      createThread({ forumSlug: "no-such-forum", title: "标题", contentMd: "正文" }),
    ).resolves.toEqual({ ok: false, error: "板块不存在" });
  });

  it("createReply 两次（不同用户）→ 楼层连续 1、2，threads.replyCount 同步", async () => {
    loginAs(replierC);
    const first = await createReply(threadId, `一楼内容-${uniq}`);
    expect(first).toEqual({ ok: true, floor: 1 });

    loginAs(replierD);
    const second = await createReply(threadId, `二楼内容-${uniq}`);
    expect(second).toEqual({ ok: true, floor: 2 });

    const [row] = await db.select().from(threads).where(eq(threads.id, threadId));
    expect(row.replyCount).toBe(2);

    const [forum] = await db.select().from(forums).where(eq(forums.id, forumId));
    expect(forum.replyCount).toBe(2);
  });

  it("createReply 并发两回复 → 楼层 3、4 不重（Review Focus #1）", async () => {
    // loginAs 的 mockResolvedValue 在调用瞬间固化返回值：
    // first 发起后再切 F，两个并发请求拿到不同登录态
    loginAs(concurrentE);
    const first = createReply(threadId, `并发甲-${uniq}`);
    loginAs(concurrentF);
    const second = createReply(threadId, `并发乙-${uniq}`);

    const [r1, r2] = await Promise.all([first, second]);
    expect(r1.ok).toBe(true);
    expect(r2.ok).toBe(true);
    if (!r1.ok || !r2.ok) return;
    expect([r1.floor, r2.floor].sort((a, b) => a - b)).toEqual([3, 4]);
  });

  it("createReply 锁定帖 → 「帖子已锁定，无法回复」（Review Focus #2）", async () => {
    loginAs(replierC); // C 窗口内已有回复，但锁定校验先于限流
    await expect(createReply(lockedThreadId, "试图回复锁定帖")).resolves.toEqual({
      ok: false,
      error: "帖子已锁定，无法回复",
    });
  });

  it("createReply hidden 帖 → 「帖子不存在或已隐藏」", async () => {
    loginAs(replierD);
    await expect(createReply(hiddenThreadId, "试图回复隐藏帖")).resolves.toEqual({
      ok: false,
      error: "帖子不存在或已隐藏",
    });
  });

  it("createReply：30 秒内已有回复 → 限流拒绝", async () => {
    loginAs(replierC); // 前面楼层连续用例中 C 已回复过 1 条
    await expect(createReply(threadId, "再回一条")).resolves.toEqual({
      ok: false,
      error: "回复太频繁，请稍后再试",
    });
  });

  it("createReply TOCTOU：预检通过后 CTE 执行前被锁定 → 拒绝且计数零漂移", async () => {
    // 直击空 bumped 路径（fix round 1 Critical）：PG 对 data-modifying
    // CTE「总是执行至完成、空结果不回滚」，forum_bumped 若不关联 bumped
    // 会在 bumped 空时把 forums.reply_count 单方面 +1。
    // 钩子：spyOn db.execute，在 CTE 真正执行前把探针帖锁定
    // （预检 db.select 不经 execute，预检时帖子尚未锁定 → 通过）
    const [victim] = await db
      .insert(threads)
      .values({
        forumId,
        authorId,
        title: `TOCTOU 帖-${uniq}`,
        contentMd: "# TOCTOU",
      })
      .returning({ id: threads.id });

    const [beforeForum] = await db
      .select({ replyCount: forums.replyCount })
      .from(forums)
      .where(eq(forums.id, forumId));

    const realExecute = db.execute.bind(db);
    const spy = vi.spyOn(db, "execute").mockImplementation(
      // 类型纠缠（PgRaw 是 thenable 非 Promise）：整体 cast，运行时仅透传
      (async (query: string | SQLWrapper) => {
        await realExecute(
          sql`update threads set is_locked = true where id = ${victim.id}`,
        );
        return realExecute(query);
      }) as never,
    );

    try {
      loginAs(toctouG);
      await expect(createReply(victim.id, "TOCTOU 回复")).resolves.toEqual({
        ok: false,
        error: "帖子已锁定，无法回复",
      });

      // forums.reply_count 与 threads.reply_count 均无漂移，无 reply 落库
      const [afterForum] = await db
        .select({ replyCount: forums.replyCount })
        .from(forums)
        .where(eq(forums.id, forumId));
      expect(afterForum.replyCount).toBe(beforeForum.replyCount);

      const [afterThread] = await db
        .select({ replyCount: threads.replyCount })
        .from(threads)
        .where(eq(threads.id, victim.id));
      expect(afterThread.replyCount).toBe(0);

      const insertedReplies = await db
        .select({ id: replies.id })
        .from(replies)
        .where(eq(replies.threadId, victim.id));
      expect(insertedReplies).toEqual([]);
    } finally {
      spy.mockRestore();
    }
  });
});
