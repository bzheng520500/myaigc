import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { inArray } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { skills } from "@/lib/db/schema";
import { slugify } from "@/lib/slug";
import {
  formatStats,
  importSkillsFromDir,
  parseSkillFile,
  type ImportStats,
} from "@/scripts/import-skills";

/**
 * 内容导入脚本 import-skills（Task 13b）。
 *
 * - 纯逻辑：parseSkillFile 的宽松解析分支（与上传语义不同：导入对
 *   缺 frontmatter 的文件是「跳过」而非报错）与 formatStats 统计输出
 * - 连库：skipIf 无 DATABASE_URL；用 fixtures 目录（3 个 md）驱动
 *   importSkillsFromDir，验证幂等（第二遍全 update、条数不变、
 *   内容覆盖）与确定性 slug（被 user 内容占用时落 <base>-builtin）
 */

const fixturesDir = fileURLToPath(new URL("./fixtures", import.meta.url));

/* ------------------------------ 纯逻辑 ------------------------------ */

describe("parseSkillFile 宽松解析", () => {
  it("合法 frontmatter → ok，contentMd 为原文件全文", () => {
    const raw = readFileSync(join(fixturesDir, "01-legal-a.md"), "utf8");
    const parsed = parseSkillFile(raw, "01-legal-a.md");
    expect(parsed).toEqual({
      ok: true,
      name: "导入测试技能甲",
      description: "连库幂等导入测试 fixture A（自动化测试专用，勿删）",
      contentMd: raw,
    });
  });

  it("缺 frontmatter → ok:false（跳过，不是报错）", () => {
    const parsed = parseSkillFile("# 只有正文\n\n没有 frontmatter。", "x.md");
    expect(parsed.ok).toBe(false);
  });

  it("frontmatter 缺 name → 回退文件名去扩展；缺 description → 空串", () => {
    const parsed = parseSkillFile(
      "---\ncategory: 随便\n---\n\n正文。",
      "雪花写作法.md",
    );
    expect(parsed).toEqual({
      ok: true,
      name: "雪花写作法",
      description: "",
      contentMd: "---\ncategory: 随便\n---\n\n正文。",
    });
  });

  it("description 超 500 字 → 截断为 500 字", () => {
    const long = "长".repeat(600);
    const parsed = parseSkillFile(
      `---\nname: 某技能\ndescription: ${long}\n---\n\n正文。`,
      "a.md",
    );
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.description).toHaveLength(500);
      expect(parsed.description).toBe("长".repeat(500));
    }
  });

  it("frontmatter 有 name 与 description（trim 后有效）→ 不回退", () => {
    const parsed = parseSkillFile(
      '---\nname: "  悬疑小说Skill  "\ndescription: 简介\n---\n\n正文。',
      "other.md",
    );
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.name).toBe("悬疑小说Skill");
  });
});

describe("formatStats 统计输出", () => {
  it("成功（新增/更新）、跳过、失败分列", () => {
    const line = formatStats({
      inserted: 2,
      updated: 1,
      skipped: 3,
      failed: 4,
    } satisfies ImportStats);
    expect(line).toContain("新增 2");
    expect(line).toContain("更新 1");
    expect(line).toContain("跳过 3");
    expect(line).toContain("失败 4");
  });
});

/* ------------------------------ 连库 ------------------------------ */

const slugA = slugify("导入测试技能甲");
const slugB = slugify("导入测试技能乙");
/** fixtures 涉及的全部 slug 族（含 user 冲突兜底后缀） */
const allSlugs = [slugA, slugB, `${slugA}-builtin`, `${slugB}-builtin`];

describe.skipIf(!process.env.DATABASE_URL)("importSkillsFromDir 连库（fixtures 幂等）", () => {
  beforeEach(async () => {
    // 每个用例从干净状态开始：清掉 fixtures slug 族的历史残留
    await db.delete(skills).where(inArray(skills.slug, allSlugs));
  });

  it("第一遍 2 条 insert + 1 条 skipped；第二遍全 update 且内容覆盖（幂等）", async () => {
    const first = await importSkillsFromDir(fixturesDir);
    expect(first).toEqual<ImportStats>({
      inserted: 2,
      updated: 0,
      skipped: 1,
      failed: 0,
    });

    let rows = await db.select().from(skills).where(inArray(skills.slug, allSlugs));
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.source === "builtin")).toBe(true);
    expect(rows.every((r) => r.category === "小说创作")).toBe(true);

    // 篡改第二条（fixture B 对应行），验证第二遍 update 会用 fixture 全文覆盖
    const dirtyName = "脏数据-应被导入覆盖";
    await db
      .update(skills)
      .set({ contentMd: "# 脏内容", name: dirtyName })
      .where(inArray(skills.slug, [slugB]));

    const second = await importSkillsFromDir(fixturesDir);
    expect(second).toEqual<ImportStats>({
      inserted: 0,
      updated: 2,
      skipped: 1,
      failed: 0,
    });

    // 条数不变；第二条内容被 fixture 03 全文还原
    rows = await db.select().from(skills).where(inArray(skills.slug, allSlugs));
    expect(rows).toHaveLength(2);
    const rowB = rows.find((r) => r.slug === slugB);
    expect(rowB?.name).toBe("导入测试技能乙");
    expect(rowB?.contentMd).toBe(
      readFileSync(join(fixturesDir, "03-legal-b.md"), "utf8"),
    );
  });

  it("slug 被用户内容占用 → 落到 <base>-builtin 且不动用户行", async () => {
    // 预插一条 source='user' 的行占住 slugB
    await db.insert(skills).values({
      slug: slugB,
      name: "用户上传占位",
      contentMd: "# 用户内容",
      category: "用户分类",
      source: "user",
    });

    const stats = await importSkillsFromDir(fixturesDir);
    // 甲：干净 insert；乙：slugB 被占 → slugB-builtin insert；缺 frontmatter：skip
    expect(stats).toEqual<ImportStats>({
      inserted: 2,
      updated: 0,
      skipped: 1,
      failed: 0,
    });

    const rows = await db.select().from(skills).where(inArray(skills.slug, allSlugs));
    expect(rows).toHaveLength(3);

    const userRow = rows.find((r) => r.slug === slugB);
    expect(userRow?.source).toBe("user");
    expect(userRow?.name).toBe("用户上传占位");

    const builtinRow = rows.find((r) => r.slug === `${slugB}-builtin`);
    expect(builtinRow?.source).toBe("builtin");
    expect(builtinRow?.name).toBe("导入测试技能乙");
  });
});
