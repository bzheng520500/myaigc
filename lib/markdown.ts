import matter from "gray-matter";
import { defaultSchema } from "rehype-sanitize";

/**
 * Markdown 渲染配置（Task 7）。
 *
 * 1. sanitizeSchema：rehype-sanitize 默认 schema（GitHub 风格白名单）基础上
 *    全局放行 className——remark-gfm 产出的 language-* / task-list-item /
 *    contains-task-list 等类名得以保留，供 .markdown-body 样式挂钩；
 *    script、onerror、javascript: 协议等一律按默认白名单剥离。
 * 2. stripFrontmatter：gray-matter 解析剥离 frontmatter，正文单独返回，
 *    页面元信息（name/description）可消费解析结果做兜底。
 */

const baseAttributes = defaultSchema.attributes ?? {};

/** 全站 Markdown 消毒 schema（MarkdownView / 评论区 T10 共用） */
export const sanitizeSchema = {
  ...defaultSchema,
  attributes: {
    ...baseAttributes,
    "*": [...(baseAttributes["*"] ?? []), "className"],
  },
};

export type ParsedMarkdown = {
  frontmatter: Record<string, unknown>;
  content: string;
};

/** 剥离 frontmatter：`---\nname: x\n---\n\n正文` → { frontmatter, content } */
export function stripFrontmatter(md: string): ParsedMarkdown {
  const parsed = matter(md);
  return { frontmatter: parsed.data, content: parsed.content.trimStart() };
}
