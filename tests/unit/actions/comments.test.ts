import { eq, inArray } from "drizzle-orm";
import { beforeAll, afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { comments, skills, tutorials, users } from "@/lib/db/schema";
import {
  createComment,
  listComments,
} from "@/lib/actions/comments";
import { validateCommentContent } from "@/lib/actions/comments-core";

/**
 * 评论 server actions（Task 10）
 *
 * - 纯逻辑：content 校验三态；auth() 无请求上下文 / 无 session 时
 *   action 内部 try/catch 兜底返回 unauthorized（不触库）
 * - 连库（本地 D1）：`npm run db:migrate:local` 后设 `D1_LOCAL_TEST=1`
 *   即可执行
 *
 * mock 说明：
 * - @/lib/auth：vitest 无 Next 请求上下文，auth() 由测试按需注入
 *   登录态（throw / null / 已登录三形态分别对应真实环境行为）
 * - next/cache：revalidatePath 只能在 Next runtime 内调用，
 *   mock 后避免连库成功路径在 vitest 中炸掉
 *
 * 文件拆分：同步纯函数 validateCommentContent 不能从 "use server" 文件
 * 导出（Next 只允许 async 导出），按 brief 预案放 comments-core.ts。
 */
vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(),
}));

const authMock = vi.mocked(auth);

/** 注入已登录用户（运行时 database 策略 session.user 含 id；auth 是多重载类型，用 never cast） */
function loginAs(userId: string) {
  authMock.mockResolvedValue({ user: { id: userId } } as never);
}

/* ---------------------------------------------------------------- */
/* 纯逻辑：content 校验三态（无库可跑）                                  */
/* ---------------------------------------------------------------- */

describe("validateCommentContent 纯逻辑", () => {
  it("空串 / 纯空白 → empty", () => {
    expect(validateCommentContent("")).toBe("empty");
    expect(validateCommentContent("   \n\t  ")).toBe("empty");
  });

  it("恰好 2000 字 → 合法（null）", () => {
    expect(validateCommentContent("评".repeat(2000))).toBeNull();
  });

  it("2001 字 → too_long", () => {
    expect(validateCommentContent("评".repeat(2001))).toBe("too_long");
  });

  it("普通文本 → 合法（null）", () => {
    expect(validateCommentContent(" 很好的运镜技巧！ ")).toBeNull();
  });
});

/* ---------------------------------------------------------------- */
/* 纯逻辑：createComment 前置分支（触库前返回，无库可跑）                  */
/* ---------------------------------------------------------------- */

describe("createComment 前置分支（纯逻辑）", () => {
  beforeEach(() => {
    authMock.mockReset();
  });

  it("auth() 抛错（vitest 无请求上下文）→ 兜底按未登录 unauthorized", async () => {
    authMock.mockImplementation(() => {
      throw new Error("no request context");
    });
    await expect(
      createComment({ targetType: "skill", targetId: crypto.randomUUID(), content: "hi" }),
    ).resolves.toEqual({ ok: false, error: "unauthorized" });
  });

  it("auth() 返回 null（无 session）→ unauthorized", async () => {
    authMock.mockResolvedValue(null as never);
    await expect(
      createComment({ targetType: "skill", targetId: crypto.randomUUID(), content: "hi" }),
    ).resolves.toEqual({ ok: false, error: "unauthorized" });
  });

  it("已登录但 content 为空白 → empty（限流查询之前返回）", async () => {
    loginAs(crypto.randomUUID());
    await expect(
      createComment({ targetType: "skill", targetId: crypto.randomUUID(), content: "  \n " }),
    ).resolves.toEqual({ ok: false, error: "empty" });
  });

  it("已登录但 content 超 2000 字 → too_long", async () => {
    loginAs(crypto.randomUUID());
    await expect(
      createComment({
        targetType: "tutorial",
        targetId: crypto.randomUUID(),
        content: "长".repeat(2001),
      }),
    ).resolves.toEqual({ ok: false, error: "too_long" });
  });
});

/* ---------------------------------------------------------------- */
/* 连库：插入 / 限流 / 目标校验 / listComments                          */
/* ---------------------------------------------------------------- */

describe.skipIf(!process.env.D1_LOCAL_TEST)("createComment / listComments 连库", () => {
  const uniq = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const authorEmail = `task10-commenter-${uniq}@test.local`;
  const secondEmail = `task10-second-${uniq}@test.local`;
  const skillSlug = `task10-skill-${uniq}`;
  const removedSkillSlug = `task10-removed-${uniq}`;
  const tutorialSlug = `task10-tutorial-${uniq}`;

  let userId: string;
  let secondUserId: string;
  let skillId: string;
  let tutorialId: string;

  beforeAll(async () => {
    const [user] = await db
      .insert(users)
      .values({ name: `任务十评论者-${uniq}`, email: authorEmail })
      .returning({ id: users.id });
    userId = user.id;
    const [second] = await db
      .insert(users)
      .values({ email: secondEmail })
      .returning({ id: users.id });
    secondUserId = second.id;

    const [skill] = await db
      .insert(skills)
      .values([
        {
          slug: skillSlug,
          name: `评论测试技能-${uniq}`,
          contentMd: "# 正文",
          category: `评论测试分类-${uniq}`,
          status: "published",
        },
        {
          slug: removedSkillSlug,
          name: `已下架技能-${uniq}`,
          contentMd: "# 已下架",
          category: `评论测试分类-${uniq}`,
          status: "removed",
        },
      ])
      .returning({ id: skills.id });
    skillId = skill.id;

    const [tutorial] = await db
      .insert(tutorials)
      .values({
        slug: tutorialSlug,
        title: `评论测试教程-${uniq}`,
        contentMd: "# 教程正文",
      })
      .returning({ id: tutorials.id });
    tutorialId = tutorial.id;
  });

  afterAll(async () => {
    // comments.user_id 外键无 cascade：先删子表，再删内容表与 users
    await db
      .delete(comments)
      .where(inArray(comments.userId, [userId, secondUserId]));
    await db
      .delete(skills)
      .where(inArray(skills.slug, [skillSlug, removedSkillSlug]));
    await db.delete(tutorials).where(eq(tutorials.slug, tutorialSlug));
    await db
      .delete(users)
      .where(inArray(users.id, [userId, secondUserId]));
  });

  beforeEach(() => {
    authMock.mockReset();
  });

  it("登录 + 合法 skill 评论 → ok:true，库中 visible，listComments 可见", async () => {
    loginAs(userId);
    const result = await createComment({
      targetType: "skill",
      targetId: skillId,
      content: "  讲得很清楚，感谢分享！  ",
    });
    expect(result).toEqual({ ok: true });

    const [row] = await db
      .select()
      .from(comments)
      .where(eq(comments.userId, userId));
    expect(row).toBeDefined();
    expect(row.content).toBe("讲得很清楚，感谢分享！"); // trim 后入库
    expect(row.status).toBe("visible");
    expect(row.targetType).toBe("skill");
    expect(row.targetId).toBe(skillId);
  });

  it("60s 内再发一条 → rate_limited", async () => {
    // 上一条评论刚插入，同一 user 仍在 60s 窗口内
    loginAs(userId);
    await expect(
      createComment({ targetType: "skill", targetId: skillId, content: "第二条" }),
    ).resolves.toEqual({ ok: false, error: "rate_limited" });
  });

  it("登录 + 合法 tutorial 评论 → ok:true（换用户避开限流窗口）", async () => {
    loginAs(secondUserId);
    const result = await createComment({
      targetType: "tutorial",
      targetId: tutorialId,
      content: "教程很有帮助",
    });
    expect(result).toEqual({ ok: true });
  });

  it("不存在的 targetId → not_found", async () => {
    // 新用户避开限流窗口
    const [fresh] = await db
      .insert(users)
      .values({ email: `task10-fresh-${uniq}@test.local` })
      .returning({ id: users.id });
    loginAs(fresh.id);
    try {
      await expect(
        createComment({
          targetType: "skill",
          targetId: crypto.randomUUID(),
          content: "目标不存在",
        }),
      ).resolves.toEqual({ ok: false, error: "not_found" });
      await expect(
        createComment({
          targetType: "tutorial",
          targetId: crypto.randomUUID(),
          content: "目标不存在",
        }),
      ).resolves.toEqual({ ok: false, error: "not_found" });
    } finally {
      await db.delete(users).where(eq(users.id, fresh.id));
    }
  });

  it("removed skill → not_found（仅 published 可评论）", async () => {
    const [fresh] = await db
      .insert(users)
      .values({ email: `task10-removed-${uniq}@test.local` })
      .returning({ id: users.id });
    loginAs(fresh.id);
    const [removed] = await db
      .select({ id: skills.id })
      .from(skills)
      .where(eq(skills.slug, removedSkillSlug));
    try {
      await expect(
        createComment({ targetType: "skill", targetId: removed.id, content: "已下架" }),
      ).resolves.toEqual({ ok: false, error: "not_found" });
    } finally {
      await db.delete(users).where(eq(users.id, fresh.id));
    }
  });

  it("listComments：visible 过滤 + created_at desc + join 作者名", async () => {
    const [seedUser] = await db
      .insert(users)
      .values({ name: `任务十列表作者-${uniq}`, email: `task10-list-${uniq}@test.local` })
      .returning({ id: users.id });
    try {
      await db.insert(comments).values([
        {
          userId: seedUser.id,
          targetType: "skill",
          targetId: skillId,
          content: "较早的可见评论",
          createdAt: new Date(Date.now() - 60_000),
        },
        {
          userId: seedUser.id,
          targetType: "skill",
          targetId: skillId,
          content: "较晚的可见评论",
        },
        {
          userId: seedUser.id,
          targetType: "skill",
          targetId: skillId,
          content: "被隐藏的评论",
          status: "hidden",
        },
        {
          userId: seedUser.id,
          targetType: "tutorial",
          targetId: tutorialId,
          content: "别的目标，不应出现",
        },
      ]);

      const items = await listComments("skill", skillId);
      expect(items.length).toBeGreaterThanOrEqual(2);
      // 该 skill 下全部可见评论按时间倒序，作者名 join 正确
      const mine = items.filter((c) => c.content.includes("可见评论"));
      expect(mine).toHaveLength(2);
      expect(mine[0].content).toBe("较晚的可见评论");
      expect(mine[1].content).toBe("较早的可见评论");
      expect(mine[0].authorName).toBe(`任务十列表作者-${uniq}`);
      expect(mine[0].createdAt).toBeInstanceOf(Date);
      expect(items.some((c) => c.content === "被隐藏的评论")).toBe(false);
      expect(items.some((c) => c.content === "别的目标，不应出现")).toBe(false);
    } finally {
      await db.delete(comments).where(eq(comments.userId, seedUser.id));
      await db.delete(users).where(eq(users.id, seedUser.id));
    }
  });
});
