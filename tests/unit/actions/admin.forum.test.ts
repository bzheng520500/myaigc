import { eq, inArray, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { auth } from "@/lib/auth";
import {
  createForum,
  deleteForum,
  listForumAdminData,
  setReplyStatus,
  setThreadFlags,
  updateForum,
} from "@/lib/actions/admin";
import { getThreadById, listReplies } from "@/lib/queries/forum";
import { db } from "@/lib/db";
import { forums, replies, threads, users } from "@/lib/db/schema";

/**
 * 管理后台论坛 actions（Phase 2 Task 4）。
 *
 * - 纯逻辑（无库可跑）：slug 正则校验（中文 / 大写 / 过短均在触库前拒绝）
 * - 连库：Neon 未就位（无 DATABASE_URL）时自动跳过；
 *   setThreadFlags 置顶 + 部分更新 + hidden（getThreadById → null）；
 *   setReplyStatus hidden（listReplies 不含）；createForum 合法插入 /
 *   重名拒绝；updateForum 改名（slug 不变）；deleteForum 空板块成功 /
 *   有帖板块（含 hidden 帖）拒绝；非 admin 批量 forbidden；
 *   listForumAdminData 含 hidden 帖
 *
 * mock 说明（与 admin.test.ts 同模式）：
 * - @/lib/auth：vitest 无请求上下文，按用例注入登录态（session.user.role）
 * - next/cache：revalidatePath 只能在 Next runtime 内调用；
 *   cacheLife 被 @/lib/queries/forum 引用，mock 成 no-op（同 queries/forum.test.ts）
 */

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
  cacheLife: () => {},
}));

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(),
}));

const authMock = vi.mocked(auth);
const revalidateMock = vi.mocked(revalidatePath);

/** 注入登录态：database 策略 session.user 含 id（+ role） */
function loginAs(userId: string, role?: string) {
  authMock.mockResolvedValue({ user: { id: userId, role } } as never);
}

/* ---------------------------------------------------------------- */
/* 纯逻辑：createForum slug 正则校验（触库之前返回）                    */
/* ---------------------------------------------------------------- */

describe("createForum slug 正则校验（纯逻辑）", () => {
  beforeEach(() => {
    authMock.mockReset();
  });

  it("中文 slug → 格式错误（触库前返回）", async () => {
    loginAs(crypto.randomUUID(), "admin");
    await expect(
      createForum({ slug: `电影分享-${Date.now()}`, name: "测试板块" }),
    ).resolves.toEqual({
      ok: false,
      error: "slug 只能包含小写字母、数字和连字符，长度 2-32 位",
    });
  });

  it("大写 slug → 格式错误（触库前返回）", async () => {
    loginAs(crypto.randomUUID(), "admin");
    await expect(
      createForum({ slug: "FilmShare", name: "测试板块" }),
    ).resolves.toEqual({
      ok: false,
      error: "slug 只能包含小写字母、数字和连字符，长度 2-32 位",
    });
  });

  it("1 位过短 slug → 格式错误（触库前返回）", async () => {
    loginAs(crypto.randomUUID(), "admin");
    await expect(createForum({ slug: "a", name: "测试板块" })).resolves.toEqual({
      ok: false,
      error: "slug 只能包含小写字母、数字和连字符，长度 2-32 位",
    });
  });
});

/* ---------------------------------------------------------------- */
/* 连库：权限拒绝 + 标志变更 + 板块 CRUD + listForumAdminData          */
/* ---------------------------------------------------------------- */

describe.skipIf(!process.env.DATABASE_URL)("admin 论坛 actions 连库", () => {
  const uniq = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const adminEmail = `task4-admin-${uniq}@test.local`;
  const userEmail = `task4-user-${uniq}@test.local`;
  /** 板块 A：带帖 + 回复（deleteForum 拒绝分支用）；slug 需 ≤ 32 位 */
  const forumASlug = `task4-a-${uniq}`;
  const forumBSlug = `task4-b-${uniq}`;
  const forumCSlug = `task4-c-${uniq}`;
  /** 板块 B：空板块（deleteForum 成功分支用） */

  let adminId: string;
  let normalUserId: string;
  let forumAId: string;
  let threadId: string;
  let replyId: string;

  beforeAll(async () => {
    const [admin] = await db
      .insert(users)
      .values({ name: `任务四管理员-${uniq}`, email: adminEmail, role: "admin" })
      .returning({ id: users.id });
    adminId = admin.id;
    const [normal] = await db
      .insert(users)
      .values({ name: `任务四用户-${uniq}`, email: userEmail, role: "user" })
      .returning({ id: users.id });
    normalUserId = normal.id;

    const [forumA] = await db
      .insert(forums)
      .values({
        slug: forumASlug,
        name: `任务四板块A-${uniq}`,
        description: "探针板块 A",
        sortOrder: 9900,
      })
      .returning({ id: forums.id });
    forumAId = forumA.id;

    await db.insert(forums).values({
      slug: forumBSlug,
      name: `任务四板块B-${uniq}`,
      description: "空板块",
      sortOrder: 9901,
    });

    const [thread] = await db
      .insert(threads)
      .values({
        forumId: forumAId,
        authorId: normalUserId,
        title: `任务四探针帖-${uniq}`,
        contentMd: "# 占位",
        status: "published",
      })
      .returning({ id: threads.id });
    threadId = thread.id;

    // 对齐生产维护路径：threadCount 为应用层冗余计数（schema 无触发器，
    // 发帖 action 会 sql threadCount + 1，见 lib/actions/forum.ts）；
    // 探针绕过 action 直插，须手动补齐，否则下方 listForumAdminData
    // 的 threadCount: 1 断言在连库环境下必失败（误导排查方向）
    await db
      .update(forums)
      .set({ threadCount: sql`${forums.threadCount} + 1` })
      .where(eq(forums.id, forumAId));

    const [reply] = await db
      .insert(replies)
      .values({
        threadId,
        authorId: normalUserId,
        contentMd: "探针回复",
        floorNumber: 1,
        status: "visible",
      })
      .returning({ id: replies.id });
    replyId = reply.id;
  });

  afterAll(async () => {
    // 逆序清理：replies → threads → forums → users（外键依赖）
    await db.delete(replies).where(eq(replies.authorId, normalUserId));
    await db.delete(threads).where(eq(threads.authorId, normalUserId));
    await db
      .delete(forums)
      .where(inArray(forums.slug, [forumASlug, forumBSlug, forumCSlug]));
    await db.delete(users).where(eq(users.id, adminId));
    await db.delete(users).where(eq(users.id, normalUserId));
  });

  beforeEach(() => {
    authMock.mockReset();
    revalidateMock.mockClear();
  });

  it("非 admin 调五个论坛 action → 全部 forbidden", async () => {
    loginAs(normalUserId, "user");
    const randomId = crypto.randomUUID();
    await expect(
      setThreadFlags(randomId, { pinned: true }),
    ).resolves.toEqual({ ok: false, error: "forbidden" });
    await expect(setReplyStatus(randomId, "hidden")).resolves.toEqual({
      ok: false,
      error: "forbidden",
    });
    await expect(
      createForum({ slug: `task4-x-${uniq}`, name: "x" }),
    ).resolves.toEqual({ ok: false, error: "forbidden" });
    await expect(updateForum(randomId, { name: "x" })).resolves.toEqual({
      ok: false,
      error: "forbidden",
    });
    await expect(deleteForum(randomId)).resolves.toEqual({
      ok: false,
      error: "forbidden",
    });
  });

  it("admin 置顶 → isPinned true + revalidate 帖子页 / 板块页 / 论坛首页", async () => {
    loginAs(adminId, "admin");
    await expect(setThreadFlags(threadId, { pinned: true })).resolves.toEqual({
      ok: true,
    });
    const [row] = await db
      .select({ isPinned: threads.isPinned, isLocked: threads.isLocked })
      .from(threads)
      .where(eq(threads.id, threadId));
    expect(row.isPinned).toBe(true);
    expect(row.isLocked).toBe(false); // 只传 pinned，locked 不动
    expect(revalidateMock).toHaveBeenCalledWith(`/forum/${forumASlug}/${threadId}`);
    expect(revalidateMock).toHaveBeenCalledWith(`/forum/${forumASlug}`);
    expect(revalidateMock).toHaveBeenCalledWith("/forum");
  });

  it("部分更新：只传 locked → locked 生效且 pinned 保持", async () => {
    loginAs(adminId, "admin");
    await expect(setThreadFlags(threadId, { locked: true })).resolves.toEqual({
      ok: true,
    });
    const [row] = await db
      .select({ isPinned: threads.isPinned, isLocked: threads.isLocked })
      .from(threads)
      .where(eq(threads.id, threadId));
    expect(row.isLocked).toBe(true);
    expect(row.isPinned).toBe(true); // 上一步置顶不被清掉
  });

  it("status hidden → getThreadById 返回 null（前台不可见）", async () => {
    loginAs(adminId, "admin");
    await expect(setThreadFlags(threadId, { status: "hidden" })).resolves.toEqual({
      ok: true,
    });
    const [row] = await db
      .select({ status: threads.status })
      .from(threads)
      .where(eq(threads.id, threadId));
    expect(row.status).toBe("hidden");
    await expect(getThreadById(threadId)).resolves.toBeNull();
  });

  it("setReplyStatus hidden → listReplies 不含该回复", async () => {
    loginAs(adminId, "admin");
    await expect(setReplyStatus(replyId, "hidden")).resolves.toEqual({
      ok: true,
    });
    const items = await listReplies(threadId);
    expect(items.find((item) => item.id === replyId)).toBeUndefined();
    expect(revalidateMock).toHaveBeenCalledWith(`/forum/${forumASlug}/${threadId}`);
  });

  it("createForum 合法 slug → 插入成功（连库可用即正则放行）", async () => {
    loginAs(adminId, "admin");
    await expect(
      createForum({ slug: forumCSlug, name: `任务四板块C-${uniq}` }),
    ).resolves.toEqual({ ok: true });
    const [row] = await db
      .select({ id: forums.id })
      .from(forums)
      .where(eq(forums.slug, forumCSlug));
    expect(row).toBeDefined();
  });

  it("createForum 重名 slug → 拒绝", async () => {
    loginAs(adminId, "admin");
    await expect(
      createForum({ slug: forumASlug, name: "重名板块" }),
    ).resolves.toEqual({ ok: false, error: "slug 已存在" });
  });

  it("updateForum 改名 → 生效且 slug 不变", async () => {
    loginAs(adminId, "admin");
    const newName = `任务四板块A改名-${uniq}`;
    await expect(
      updateForum(forumAId, { name: newName, description: "改后描述" }),
    ).resolves.toEqual({ ok: true });
    const [row] = await db
      .select({ name: forums.name, slug: forums.slug, description: forums.description })
      .from(forums)
      .where(eq(forums.id, forumAId));
    expect(row.name).toBe(newName);
    expect(row.slug).toBe(forumASlug);
    expect(row.description).toBe("改后描述");
  });

  it("deleteForum 板块内还有帖子（含 hidden）→ 拒绝", async () => {
    loginAs(adminId, "admin");
    await expect(deleteForum(forumAId)).resolves.toEqual({
      ok: false,
      error: "板块内还有帖子，请先处理",
    });
    const [row] = await db
      .select({ id: forums.id })
      .from(forums)
      .where(eq(forums.id, forumAId));
    expect(row).toBeDefined();
  });

  it("deleteForum 空板块 → 成功删除 + revalidate /forum", async () => {
    loginAs(adminId, "admin");
    await expect(
      deleteForum(
        (
          await db
            .select({ id: forums.id })
            .from(forums)
            .where(eq(forums.slug, forumBSlug))
        )[0].id,
      ),
    ).resolves.toEqual({ ok: true });
    const [row] = await db
      .select({ id: forums.id })
      .from(forums)
      .where(eq(forums.slug, forumBSlug));
    expect(row).toBeUndefined();
    expect(revalidateMock).toHaveBeenCalledWith("/forum");
  });

  it("listForumAdminData → forums 含板块行，threads 含 hidden 帖及投影字段", async () => {
    loginAs(adminId, "admin");
    const result = await listForumAdminData();
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const forumRow = result.data.forums.find((row) => row.id === forumAId);
    expect(forumRow).toBeDefined();
    expect(forumRow).toMatchObject({
      slug: forumASlug,
      name: `任务四板块A改名-${uniq}`,
      threadCount: 1,
    });

    // 管理台包含 hidden 帖（前台列表已排除，此处必须可见）
    const threadRow = result.data.threads.find((row) => row.id === threadId);
    expect(threadRow).toBeDefined();
    expect(threadRow).toMatchObject({
      forumSlug: forumASlug,
      status: "hidden",
      isPinned: true,
      isLocked: true,
      authorName: `任务四用户-${uniq}`,
    });
    expect(threadRow?.forumName).toContain("任务四板块A");
  });

  it("非 admin 调 listForumAdminData → forbidden", async () => {
    loginAs(normalUserId, "user");
    await expect(listForumAdminData()).resolves.toEqual({
      ok: false,
      error: "forbidden",
    });
  });
});
