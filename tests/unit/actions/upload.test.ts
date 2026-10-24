import { eq, like } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { skills, users } from "@/lib/db/schema";
import { uploadSkill } from "@/lib/actions/upload";
import { parseSkillMd } from "@/lib/frontmatter";

/**
 * Skill 上传 server action（Task 11，Review Focus #5 未登录拒绝）。
 *
 * - 纯逻辑（无库可跑）：未登录 / 超 100KB / 坏 frontmatter 三态，
 *   分支顺序保证这三个错误在任何数据库调用之前返回
 * - 连库：Neon 未就位（无 DATABASE_URL）时自动跳过；
 *   成功插入断言 source="user" + category 默认；10 分钟 3 条限流
 *
 * mock 说明（与 comments.test.ts 同模式）：
 * - @/lib/auth：vitest 无请求上下文，按用例注入登录态
 * - next/cache：revalidatePath 只能在 Next runtime 内调用
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

const VALID_MD = [
  "---",
  "name: 上传测试技能",
  "description: 一句话简介",
  "category: 小说创作",
  "---",
  "",
  "## 使用场景",
  "",
  "正文内容",
].join("\n");

/* ---------------------------------------------------------------- */
/* 纯逻辑：触库之前的三个分支（Review Focus #5 + #2 + 体积限制）        */
/* ---------------------------------------------------------------- */

describe("uploadSkill 前置分支（纯逻辑）", () => {
  beforeEach(() => {
    authMock.mockReset();
  });

  it("auth() 抛错（vitest 无请求上下文）→ 兜底按未登录拒绝", async () => {
    authMock.mockImplementation(() => {
      throw new Error("no request context");
    });
    await expect(uploadSkill(VALID_MD, "小说创作")).resolves.toEqual({
      ok: false,
      error: "请先登录后再上传",
    });
  });

  it("auth() 返回 null（无 session）→ 未登录拒绝", async () => {
    authMock.mockResolvedValue(null as never);
    await expect(uploadSkill(VALID_MD, "小说创作")).resolves.toEqual({
      ok: false,
      error: "请先登录后再上传",
    });
  });

  it("raw 超 100KB → 体积错误（优先于 frontmatter 校验）", async () => {
    loginAs(crypto.randomUUID());
    await expect(uploadSkill("x".repeat(100 * 1024 + 1), "小说创作")).resolves.toEqual(
      { ok: false, error: "内容超过 100KB 限制" },
    );
  });

  it("坏 frontmatter → 透传 parseSkillMd 的中文错误", async () => {
    loginAs(crypto.randomUUID());
    const raw = "没有 frontmatter 的正文";
    const parsed = parseSkillMd(raw);
    expect(parsed.ok).toBe(false);
    await expect(uploadSkill(raw, "小说创作")).resolves.toEqual({
      ok: false,
      error: !parsed.ok ? parsed.error : "",
    });
  });

  it("恰好 100KB 但缺 frontmatter → 仍返回 frontmatter 错误（不误报体积）", async () => {
    loginAs(crypto.randomUUID());
    const raw = "x".repeat(100 * 1024);
    const result = await uploadSkill(raw, "其他");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).not.toBe("内容超过 100KB 限制");
    }
  });
});

/* ---------------------------------------------------------------- */
/* mock db：insert 唯一冲突（23505）重试 + 异常兜底                    */
/* ---------------------------------------------------------------- */

describe("uploadSkill insert 冲突重试（mock db）", () => {
  beforeEach(() => {
    authMock.mockReset();
    // 置空 DATABASE_URL：让 ensureUniqueSlug 走不触库分支（原样返回
    // base）。否则设置了 DATABASE_URL 的环境下它会经同一个被 spyOn
    // 的 db.select 调 .limit(1)，而 mock 短链没有 .limit → TypeError
    // （与 slug.test.ts 无库用例同模式）
    vi.stubEnv("DATABASE_URL", "");
  });

  afterEach(() => {
    // 只还原 spyOn 的 db.select / db.insert，不影响模块级 mock
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  /** 限流查询：db.select({n}).from(skills).where(...) → [{ n: 0 }] */
  function mockRateLimitOk() {
    vi.spyOn(db, "select").mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([{ n: 0 }]),
      }),
    } as never);
  }

  /** mock db.insert(skills) 返回链式 .values（按序注入 reject / resolve） */
  function mockInsertValues(values: ReturnType<typeof vi.fn>) {
    vi.spyOn(db, "insert").mockReturnValue({ values } as never);
  }

  function pgError(code: string): Error & { code: string } {
    const error = new Error("database error");
    return Object.assign(error, { code });
  }

  it("首次插入撞唯一约束（23505）→ 重算 slug 重试一次成功", async () => {
    loginAs(crypto.randomUUID());
    mockRateLimitOk();
    const values = vi
      .fn()
      .mockRejectedValueOnce(pgError("23505"))
      .mockResolvedValueOnce(undefined);
    mockInsertValues(values);

    const result = await uploadSkill(VALID_MD, "小说创作");
    expect(result.ok).toBe(true);
    expect(values).toHaveBeenCalledTimes(2);
  });

  it("两次插入都撞唯一约束 → 中文错误，不裸抛", async () => {
    loginAs(crypto.randomUUID());
    mockRateLimitOk();
    const values = vi.fn().mockRejectedValue(pgError("23505"));
    mockInsertValues(values);

    await expect(uploadSkill(VALID_MD, "小说创作")).resolves.toEqual({
      ok: false,
      error: "上传失败，请稍后再试",
    });
    expect(values).toHaveBeenCalledTimes(2);
  });

  it("非唯一冲突的 DB 异常 → 直接中文错误，不重试", async () => {
    loginAs(crypto.randomUUID());
    mockRateLimitOk();
    const values = vi.fn().mockRejectedValue(pgError("42P01"));
    mockInsertValues(values);

    await expect(uploadSkill(VALID_MD, "小说创作")).resolves.toEqual({
      ok: false,
      error: "上传失败，请稍后再试",
    });
    expect(values).toHaveBeenCalledTimes(1);
  });
});

/* ---------------------------------------------------------------- */
/* 连库：成功插入 + category 默认 + 限流                              */
/* ---------------------------------------------------------------- */

describe.skipIf(!process.env.DATABASE_URL)("uploadSkill 连库", () => {
  const uniq = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const authorEmail = `task11-uploader-${uniq}@test.local`;
  const seedSlugPrefix = `task11-seed-${uniq}`;

  let userId: string;

  beforeAll(async () => {
    const [user] = await db
      .insert(users)
      .values({ name: `任务十一上传者-${uniq}`, email: authorEmail })
      .returning({ id: users.id });
    userId = user.id;
  });

  afterAll(async () => {
    // 先删 skills（author_id 外键指向 users），再删 users
    await db.delete(skills).where(eq(skills.authorId, userId));
    await db.delete(skills).where(like(skills.slug, `${seedSlugPrefix}%`));
    await db.delete(users).where(eq(users.id, userId));
  });

  beforeEach(() => {
    authMock.mockReset();
  });

  it("合法上传 → ok:true，库中 source=user / status=published / category 默认其他", async () => {
    loginAs(userId);
    // category 传空串 → 默认 "其他"
    const result = await uploadSkill(VALID_MD, "");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.slug).toBeTruthy();

    const [row] = await db
      .select()
      .from(skills)
      .where(eq(skills.slug, result.slug));
    expect(row).toBeDefined();
    expect(row.source).toBe("user");
    expect(row.status).toBe("published");
    expect(row.authorId).toBe(userId);
    expect(row.name).toBe("上传测试技能");
    expect(row.description).toBe("一句话简介");
    expect(row.category).toBe("其他");
    expect(row.contentMd).toBe(VALID_MD); // 原文入库
  });

  it("10 分钟内已传 3 条 → 第 4 条被限流拒绝", async () => {
    // 上一用例已成功 1 条，再补 2 条凑满 3 条窗口配额
    await db.insert(skills).values([
      {
        slug: `${seedSlugPrefix}-1`,
        name: `限流占位一-${uniq}`,
        contentMd: "# 占位",
        category: "测试分类",
        authorId: userId,
        source: "user",
      },
      {
        slug: `${seedSlugPrefix}-2`,
        name: `限流占位二-${uniq}`,
        contentMd: "# 占位",
        category: "测试分类",
        authorId: userId,
        source: "user",
      },
    ]);

    loginAs(userId);
    await expect(uploadSkill(VALID_MD, "小说创作")).resolves.toEqual({
      ok: false,
      error: "上传太频繁，请稍后再试",
    });
  });
});
