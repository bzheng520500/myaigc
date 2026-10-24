import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { auth } from "@/lib/auth";
import {
  listAdminData,
  setCommentStatus,
  setSkillStatus,
} from "@/lib/actions/admin";
import { requireAdmin } from "@/lib/actions/admin-core";
import { db } from "@/lib/db";
import { comments, skills, tutorials, users } from "@/lib/db/schema";

/**
 * 管理后台 server actions（Task 12）。
 *
 * - 纯逻辑（无库可跑）：requireAdmin 三态（null session / user / admin）；
 *   action 前置分支（auth 抛错 / 无 session / 非 admin → forbidden；
 *   非 UUID id → invalid）——分支顺序保证这些错误在任何数据库调用之前返回
 * - 连库：Neon 未就位（无 DATABASE_URL）时自动跳过；
 *   非 admin 调用 → forbidden 且库未变；admin 调用 → 状态变更；
 *   listAdminData → 行投影与 80 字截断
 *
 * mock 说明（与 upload.test.ts 同模式）：
 * - @/lib/auth：vitest 无请求上下文，按用例注入登录态（session.user.role）
 * - next/cache：revalidatePath 只能在 Next runtime 内调用
 */

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(),
}));

const authMock = vi.mocked(auth);
const revalidateMock = vi.mocked(revalidatePath);

/** 注入登录态：database 策略 session.user 含 id（+ role，Task 12 session callback 注入） */
function loginAs(userId: string, role?: string) {
  authMock.mockResolvedValue({ user: { id: userId, role } } as never);
}

/* ---------------------------------------------------------------- */
/* 纯逻辑：requireAdmin 三态                                          */
/* ---------------------------------------------------------------- */

describe("requireAdmin 纯逻辑三态", () => {
  it("null session → false", () => {
    expect(requireAdmin(null)).toBe(false);
  });

  it("role=user → false", () => {
    expect(
      requireAdmin({ user: { id: "u1", role: "user" } } as never),
    ).toBe(false);
  });

  it("role=admin → true", () => {
    expect(
      requireAdmin({ user: { id: "u1", role: "admin" } } as never),
    ).toBe(true);
  });
});

/* ---------------------------------------------------------------- */
/* 纯逻辑：action 前置分支（触库之前返回）                             */
/* ---------------------------------------------------------------- */

describe("admin actions 前置分支（纯逻辑）", () => {
  beforeEach(() => {
    authMock.mockReset();
  });

  it("auth() 抛错（vitest 无请求上下文）→ 兜底 forbidden", async () => {
    authMock.mockImplementation(() => {
      throw new Error("no request context");
    });
    await expect(setSkillStatus(crypto.randomUUID(), "removed")).resolves.toEqual(
      { ok: false, error: "forbidden" },
    );
    await expect(setCommentStatus(crypto.randomUUID(), "hidden")).resolves.toEqual(
      { ok: false, error: "forbidden" },
    );
  });

  it("auth() 返回 null（无 session）→ forbidden", async () => {
    authMock.mockResolvedValue(null as never);
    await expect(setSkillStatus(crypto.randomUUID(), "removed")).resolves.toEqual(
      { ok: false, error: "forbidden" },
    );
    await expect(listAdminData()).resolves.toEqual({
      ok: false,
      error: "forbidden",
    });
  });

  it("普通用户（role=user）→ forbidden", async () => {
    loginAs(crypto.randomUUID(), "user");
    await expect(setSkillStatus(crypto.randomUUID(), "removed")).resolves.toEqual(
      { ok: false, error: "forbidden" },
    );
    await expect(setCommentStatus(crypto.randomUUID(), "hidden")).resolves.toEqual(
      { ok: false, error: "forbidden" },
    );
    await expect(listAdminData()).resolves.toEqual({
      ok: false,
      error: "forbidden",
    });
  });

  it("admin 但 id 非 UUID → invalid（在触库之前返回）", async () => {
    loginAs(crypto.randomUUID(), "admin");
    await expect(setSkillStatus("not-a-uuid", "removed")).resolves.toEqual({
      ok: false,
      error: "invalid",
    });
    await expect(setCommentStatus("not-a-uuid", "hidden")).resolves.toEqual({
      ok: false,
      error: "invalid",
    });
  });
});

/* ---------------------------------------------------------------- */
/* 连库：权限拒绝 + 状态变更 + listAdminData 投影                      */
/* ---------------------------------------------------------------- */

describe.skipIf(!process.env.DATABASE_URL)("admin actions 连库", () => {
  const uniq = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const adminEmail = `task12-admin-${uniq}@test.local`;
  const userEmail = `task12-user-${uniq}@test.local`;
  const skillSlug = `task12-skill-${uniq}`;
  const tutorialSlug = `task12-tutorial-${uniq}`;
  /** 超过 80 字的评论内容（验证截断） */
  const longContent = "长".repeat(100);

  let adminId: string;
  let normalUserId: string;
  let skillId: string;
  let tutorialId: string;
  let skillCommentId: string;
  let tutorialCommentId: string;

  beforeAll(async () => {
    const [admin] = await db
      .insert(users)
      .values({ name: `任务十二管理员-${uniq}`, email: adminEmail, role: "admin" })
      .returning({ id: users.id });
    adminId = admin.id;
    const [normal] = await db
      .insert(users)
      .values({ name: `任务十二用户-${uniq}`, email: userEmail, role: "user" })
      .returning({ id: users.id });
    normalUserId = normal.id;

    const [skill] = await db
      .insert(skills)
      .values({
        slug: skillSlug,
        name: `管理后台测试技能-${uniq}`,
        contentMd: "# 占位",
        category: "测试分类",
        authorId: normalUserId,
        source: "user",
        status: "published",
      })
      .returning({ id: skills.id });
    skillId = skill.id;

    const [tutorial] = await db
      .insert(tutorials)
      .values({
        slug: tutorialSlug,
        title: `管理后台测试教程-${uniq}`,
        contentMd: "# 占位",
      })
      .returning({ id: tutorials.id });
    tutorialId = tutorial.id;

    const inserted = await db
      .insert(comments)
      .values([
        {
          userId: normalUserId,
          targetType: "skill",
          targetId: skillId,
          content: longContent,
          status: "visible",
        },
        {
          userId: normalUserId,
          targetType: "tutorial",
          targetId: tutorialId,
          content: "教程下的短评论",
          status: "visible",
        },
      ])
      .returning({ id: comments.id });
    skillCommentId = inserted[0].id;
    tutorialCommentId = inserted[1].id;
  });

  afterAll(async () => {
    // 先删引用 users 的行（comments.user_id / skills.author_id 外键），再删 users
    await db.delete(comments).where(eq(comments.userId, normalUserId));
    await db.delete(skills).where(eq(skills.id, skillId));
    await db.delete(tutorials).where(eq(tutorials.id, tutorialId));
    await db.delete(users).where(eq(users.id, adminId));
    await db.delete(users).where(eq(users.id, normalUserId));
  });

  beforeEach(() => {
    authMock.mockReset();
    revalidateMock.mockClear();
  });

  it("非 admin 调 setSkillStatus → forbidden 且库未变", async () => {
    loginAs(normalUserId, "user");
    await expect(setSkillStatus(skillId, "removed")).resolves.toEqual({
      ok: false,
      error: "forbidden",
    });
    const [row] = await db
      .select({ status: skills.status })
      .from(skills)
      .where(eq(skills.id, skillId));
    expect(row.status).toBe("published");
  });

  it("admin 调 setSkillStatus → removed，再恢复 published（回查 slug revalidate）", async () => {
    loginAs(adminId, "admin");

    await expect(setSkillStatus(skillId, "removed")).resolves.toEqual({
      ok: true,
    });
    let [row] = await db
      .select({ status: skills.status })
      .from(skills)
      .where(eq(skills.id, skillId));
    expect(row.status).toBe("removed");
    expect(revalidateMock).toHaveBeenCalledWith(`/skills/${skillSlug}`);
    expect(revalidateMock).toHaveBeenCalledWith("/skills");
    expect(revalidateMock).toHaveBeenCalledWith("/");

    await expect(setSkillStatus(skillId, "published")).resolves.toEqual({
      ok: true,
    });
    [row] = await db
      .select({ status: skills.status })
      .from(skills)
      .where(eq(skills.id, skillId));
    expect(row.status).toBe("published");
  });

  it("admin 调 setSkillStatus 不存在的 UUID → not_found", async () => {
    loginAs(adminId, "admin");
    await expect(setSkillStatus(crypto.randomUUID(), "removed")).resolves.toEqual({
      ok: false,
      error: "not_found",
    });
  });

  it("非 admin 调 setCommentStatus → forbidden 且库未变", async () => {
    loginAs(normalUserId, "user");
    await expect(setCommentStatus(skillCommentId, "hidden")).resolves.toEqual({
      ok: false,
      error: "forbidden",
    });
    const [row] = await db
      .select({ status: comments.status })
      .from(comments)
      .where(eq(comments.id, skillCommentId));
    expect(row.status).toBe("visible");
  });

  it("admin 调 setCommentStatus → hidden（skill 评论回查 slug revalidate），再恢复", async () => {
    loginAs(adminId, "admin");

    await expect(setCommentStatus(skillCommentId, "hidden")).resolves.toEqual({
      ok: true,
    });
    let [row] = await db
      .select({ status: comments.status })
      .from(comments)
      .where(eq(comments.id, skillCommentId));
    expect(row.status).toBe("hidden");
    expect(revalidateMock).toHaveBeenCalledWith(`/skills/${skillSlug}`);

    await expect(setCommentStatus(skillCommentId, "visible")).resolves.toEqual({
      ok: true,
    });
    [row] = await db
      .select({ status: comments.status })
      .from(comments)
      .where(eq(comments.id, skillCommentId));
    expect(row.status).toBe("visible");
  });

  it("admin 隐藏 tutorial 评论 → revalidate /tutorials/${slug}", async () => {
    loginAs(adminId, "admin");
    try {
      await expect(
        setCommentStatus(tutorialCommentId, "hidden"),
      ).resolves.toEqual({ ok: true });
      expect(revalidateMock).toHaveBeenCalledWith(`/tutorials/${tutorialSlug}`);
    } finally {
      // 恢复 visible，不影响其他用例
      await setCommentStatus(tutorialCommentId, "visible");
    }
  });

  it("listAdminData（admin）→ 含造数 skill 行与 80 字截断的评论行", async () => {
    loginAs(adminId, "admin");
    const result = await listAdminData();
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const skillRow = result.data.skills.find((row) => row.id === skillId);
    expect(skillRow).toBeDefined();
    expect(skillRow).toMatchObject({
      slug: skillSlug,
      category: "测试分类",
      source: "user",
      status: "published",
    });
    expect(skillRow?.createdAt).toBeInstanceOf(Date);

    const commentRow = result.data.comments.find(
      (row) => row.id === skillCommentId,
    );
    expect(commentRow).toBeDefined();
    // 100 字截断为 80 字 + 省略号
    expect(commentRow?.content).toBe("长".repeat(80) + "…");
    expect(commentRow?.targetType).toBe("skill");
    expect(commentRow?.authorName).toBe(`任务十二用户-${uniq}`);
  });
});
