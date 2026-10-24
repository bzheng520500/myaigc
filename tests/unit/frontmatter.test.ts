import { describe, expect, it } from "vitest";
import { parseSkillMd, SKILL_TEMPLATE } from "@/lib/frontmatter";

/**
 * 用户上传 .md 的 frontmatter 校验（Task 11，Review Focus #2 坏 frontmatter）。
 *
 * 纯逻辑：gray-matter 解析 + name/description 必填非空。
 * 错误文案必须是可直接展示的中文（页面行内提示直接用）。
 */

const VALID_MD = [
  "---",
  "name: 仙侠开篇技能",
  "description: 一句话简介",
  "category: 小说创作",
  "---",
  "",
  "## 使用场景",
  "",
  "正文内容",
].join("\n");

describe("parseSkillMd 合法输入", () => {
  it("提取 name / description / body（正文 trim）", () => {
    expect(parseSkillMd(VALID_MD)).toEqual({
      ok: true,
      name: "仙侠开篇技能",
      description: "一句话简介",
      body: "## 使用场景\n\n正文内容",
    });
  });

  it("name / description 前后空白被去除", () => {
    const raw = VALID_MD.replace(
      "name: 仙侠开篇技能",
      "name:  仙侠开篇技能  ",
    );
    const result = parseSkillMd(raw);
    expect(result).toEqual({
      ok: true,
      name: "仙侠开篇技能",
      description: "一句话简介",
      body: "## 使用场景\n\n正文内容",
    });
  });
});

describe("parseSkillMd 坏 frontmatter（Review Focus #2）", () => {
  it("缺 description → 中文 error", () => {
    const raw = "---\nname: 技能名\n---\n正文";
    const result = parseSkillMd(raw);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/description|简介/);
      expect(result.error).toMatch(/[\u4e00-\u9fa5]/);
    }
  });

  it("YAML 损坏（name: [未闭合）→ 中文 error，不抛异常", () => {
    const raw = "---\nname: [未闭合\n---\n正文";
    let result: ReturnType<typeof parseSkillMd>;
    expect(() => {
      result = parseSkillMd(raw);
    }).not.toThrow();
    expect(result!.ok).toBe(false);
    if (!result!.ok) {
      expect(result!.error).toMatch(/[\u4e00-\u9fa5]/);
    }
  });

  it("无 frontmatter → 中文 error", () => {
    const result = parseSkillMd("只有正文，没有任何 frontmatter");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/frontmatter|---/);
      expect(result.error).toMatch(/[\u4e00-\u9fa5]/);
    }
  });

  it("name 空串 → 中文 error", () => {
    const raw = '---\nname: ""\ndescription: 简介\n---\n正文';
    const result = parseSkillMd(raw);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/name|名称/);
    }
  });

  it("name 非字符串（YAML 数字）→ error", () => {
    const raw = "---\nname: 123\ndescription: 简介\n---\n正文";
    const result = parseSkillMd(raw);
    expect(result.ok).toBe(false);
  });
});

describe("SKILL_TEMPLATE", () => {
  it("模板自身能通过 parseSkillMd 校验（页面预填可直接提交）", () => {
    const result = parseSkillMd(SKILL_TEMPLATE);
    expect(result.ok).toBe(true);
  });

  it("模板含 name / description / category 三键与正文示例", () => {
    expect(SKILL_TEMPLATE).toContain("name:");
    expect(SKILL_TEMPLATE).toContain("description:");
    expect(SKILL_TEMPLATE).toContain("category:");
    expect(SKILL_TEMPLATE.startsWith("---")).toBe(true);
  });
});
