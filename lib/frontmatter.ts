import matter from "gray-matter";

/**
 * 用户上传 .md 的 frontmatter 校验（Task 11，Review Focus #2 坏 frontmatter）。
 *
 * parseSkillMd 把「文件开头 YAML 是否合法、name/description 是否非空」
 * 全部收敛为 { ok, error } 结果：error 是可直接展示的中文文案，
 * 上传 action（lib/actions/upload.ts）原样透传给页面行内提示，
 * 不向用户暴露 js-yaml 的英文堆栈。
 */

export type ParsedSkillMd =
  | { ok: true; name: string; description: string; body: string }
  | { ok: false; error: string };

/** 上传页预填模板（frontmatter 三键 + 正文示例；自身必须能通过 parseSkillMd） */
export const SKILL_TEMPLATE = [
  "---",
  "name: 我的技能名称",
  "description: 一句话介绍这个 Skill 的用途与适用场景",
  "category: 小说创作",
  "---",
  "",
  "## 使用场景",
  "",
  "说明这个 Skill 适合的创作阶段与输入要求。",
  "",
  "## 提示词",
  "",
  "在下面粘贴可复用的提示词正文。",
  "",
  "## 使用心得",
  "",
  "补充使用技巧、注意事项或效果调优建议。",
  "",
].join("\n");

/** frontmatter 字段取值：仅接受字符串，其余类型（数字/数组等）按缺失处理 */
function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function parseSkillMd(raw: string): ParsedSkillMd {
  let parsed: ReturnType<typeof matter>;
  try {
    parsed = matter(raw);
  } catch {
    return {
      ok: false,
      error: "frontmatter 解析失败：文件开头的 YAML 格式有误，请检查 --- 包裹的部分",
    };
  }

  const data = parsed.data ?? {};
  if (Object.keys(data).length === 0) {
    return {
      ok: false,
      error: "缺少 frontmatter：请在文件开头用 --- 包裹 name 与 description",
    };
  }

  const name = stringValue(data.name);
  const description = stringValue(data.description);

  if (!name) {
    return {
      ok: false,
      error: "frontmatter 缺少有效的 name（技能名称不能为空）",
    };
  }
  if (!description) {
    return {
      ok: false,
      error: "frontmatter 缺少有效的 description（技能简介不能为空）",
    };
  }

  return { ok: true, name, description, body: parsed.content.trim() };
}
