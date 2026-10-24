import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { skills, users } from "@/lib/db/schema";
import { getSkillBySlug } from "@/lib/queries/skills";

/**
 * Skill 详情查询 getSkillBySlug（Task 7）
 *
 * - 纯逻辑：无 DATABASE_URL 兜底返回 null
 * - 连库：Neon 未就位时自动跳过，控制器 push 后设置 DATABASE_URL 即可执行
 *
 * cacheLife 在 Next cache scope 之外会 throw，mock 成 no-op（同 T6）。
 */
vi.mock("next/cache", () => ({
  cacheLife: () => {},
}));

/* ---------------------------------------------------------------- */
/* 纯逻辑：无 DATABASE_URL 兜底                                        */
/* ---------------------------------------------------------------- */

describe("无 DATABASE_URL 兜底", () => {
  it("getSkillBySlug 返回 null", async () => {
    vi.stubEnv("DATABASE_URL", "");
    try {
      await expect(getSkillBySlug("any-slug")).resolves.toBeNull();
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

/* ---------------------------------------------------------------- */
/* 连库：1 位作者 + 1 published（带作者/frontmatter）+ 1 removed        */
/* ---------------------------------------------------------------- */

describe.skipIf(!process.env.DATABASE_URL)("getSkillBySlug 连库查询", () => {
  const uniq = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const slugPublished = `task7-published-${uniq}`;
  const slugRemoved = `task7-removed-${uniq}`;
  const authorEmail = `task7-author-${uniq}@test.local`;

  let authorId: string;

  beforeAll(async () => {
    const [author] = await db
      .insert(users)
      .values({ name: `任务七作者-${uniq}`, email: authorEmail })
      .returning({ id: users.id });
    authorId = author.id;

    await db.insert(skills).values([
      {
        slug: slugPublished,
        name: `详情页测试技能-${uniq}`,
        description: `任务七测试数据 ${uniq}`,
        contentMd: `---\nname: frontmatter 名\ndescription: frontmatter 简介\n---\n\n# 正文标题`,
        category: `详情测试分类-${uniq}`,
        tags: ["运镜", "测试"],
        authorId,
        source: "user",
        status: "published",
      },
      {
        slug: slugRemoved,
        name: `已下架技能-${uniq}`,
        contentMd: "# 已下架",
        category: `详情测试分类-${uniq}`,
        status: "removed",
      },
    ]);
  });

  afterAll(async () => {
    // skills.authorId 引用 users：先删 skills 再删作者
    await db
      .delete(skills)
      .where(inArray(skills.slug, [slugPublished, slugRemoved]));
    await db.delete(users).where(eq(users.id, authorId));
  });

  it("published 命中：返回全部列 + 作者 join 信息", async () => {
    const row = await getSkillBySlug(slugPublished);
    expect(row).not.toBeNull();
    expect(row!.name).toBe(`详情页测试技能-${uniq}`);
    expect(row!.slug).toBe(slugPublished);
    expect(row!.contentMd).toContain("# 正文标题");
    expect(row!.tags).toEqual(["运镜", "测试"]);
    expect(row!.source).toBe("user");
    expect(row!.viewCount).toBe(0);
    expect(row!.copyCount).toBe(0);
    expect(row!.createdAt).toBeInstanceOf(Date);
    expect(row!.updatedAt).toBeInstanceOf(Date);
    expect(row!.author).toEqual({
      name: `任务七作者-${uniq}`,
      email: authorEmail,
    });
  });

  it("removed → null", async () => {
    await expect(getSkillBySlug(slugRemoved)).resolves.toBeNull();
  });

  it("不存在的 slug → null", async () => {
    await expect(getSkillBySlug(`no-such-${uniq}`)).resolves.toBeNull();
  });
});
