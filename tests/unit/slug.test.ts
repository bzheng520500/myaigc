import { like } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { skills } from "@/lib/db/schema";
import { ensureUniqueSlug, slugify } from "@/lib/slug";
import { simulateNoDatabase } from "@/tests/helpers/db";

/**
 * 中文 slug 生成与冲突去重（Task 11，Review Focus #3 slug 冲突）。
 *
 * - slugify：纯逻辑（pinyin-pro 转拼音 + 归一化）
 * - ensureUniqueSlug：无库分支注入「D1 绑定不可用」；连库用例在
 *   设置 D1_LOCAL_TEST=1 时启用（skipIf），slug 用唯一化前缀避免污染真实数据
 */

describe("slugify 纯逻辑", () => {
  it("中文名转拼音：仙侠文Skill → 含 xianxia", () => {
    expect(slugify("仙侠文Skill")).toContain("xianxia");
  });

  it("英文名：Hello World → hello-world", () => {
    expect(slugify("Hello World")).toBe("hello-world");
  });

  it("纯英文数字名保持：AI Film 123 → ai-film-123", () => {
    expect(slugify("AI Film 123")).toBe("ai-film-123");
  });

  it("中文标点/特殊字符压缩为单连字符并去首尾", () => {
    expect(slugify("你好，世界！测试")).toBe("nihao-shijie-ceshi");
    expect(slugify("  --Hello!!! World--  ")).toBe("hello-world");
  });

  it("空串 → 空串（兜底由 ensureUniqueSlug 负责）", () => {
    expect(slugify("")).toBe("");
  });
});

describe("ensureUniqueSlug 无库 / 空串分支", () => {
  it("无库（D1 绑定不可用）→ base 原样返回（不触库）", async () => {
    const restore = simulateNoDatabase();
    try {
      await expect(ensureUniqueSlug("abc")).resolves.toBe("abc");
    } finally {
      restore();
    }
  });

  it("base 为空串 → skill- + 随机后缀", async () => {
    const result = await ensureUniqueSlug("");
    expect(result).toMatch(/^skill-/);
    expect(result.length).toBeGreaterThan("skill-".length);
  });
});

describe.skipIf(!process.env.D1_LOCAL_TEST)("ensureUniqueSlug 连库", () => {
  const uniq = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const baseSlug = `task11-abc-${uniq}`;

  beforeAll(async () => {
    // 预插一条与 base 完全相同的 slug，制造冲突
    await db.insert(skills).values({
      slug: baseSlug,
      name: `冲突占位技能-${uniq}`,
      contentMd: "# 占位",
      category: "测试分类",
    });
  });

  afterAll(async () => {
    // 清理 base 及其派生的 base-XXXX（测试自身不落库，但防御性清理）
    await db.delete(skills).where(like(skills.slug, `${baseSlug}%`));
  });

  it("base 完全冲突 → 返回 base-XXXX 且不等于 base", async () => {
    const result = await ensureUniqueSlug(baseSlug);
    expect(result).not.toBe(baseSlug);
    expect(result.startsWith(`${baseSlug}-`)).toBe(true);
    // 4 位随机后缀
    expect(result).toMatch(new RegExp(`^${baseSlug}-[a-z0-9]{4}$`));
  });

  it("无冲突的 base → 原样返回", async () => {
    const fresh = `task11-fresh-${uniq}`;
    await expect(ensureUniqueSlug(fresh)).resolves.toBe(fresh);
  });
});
