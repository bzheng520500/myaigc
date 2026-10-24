import { toString } from "mdast-util-to-string";
import { unified } from "unified";
import remarkParse from "remark-parse";
import { visit } from "unist-util-visit";

/**
 * 教程目录提取与标题锚点（Task 9）。
 *
 * 锚点一致性约束：extractToc 生成的 id 必须与 MarkdownView 渲染
 * h2/h3 时注入的 id 完全一致——两侧共用本文件的 slugifyHeading +
 * createHeadingIdDeduper，且都以「标题纯文本」（mdast toString /
 * React children 递归取文本，行内加粗等修饰剥除后结果相同）为输入，
 * 按文档顺序分配，天然对齐。
 *
 * 解析用 react-markdown 依赖链里的 unified 生态（remark-parse），
 * 与页面渲染走同一套 CommonMark 词法，代码围栏天然不会误判。
 */

export type TocItem = {
  depth: 2 | 3;
  text: string;
  id: string;
};

/** 标题文本 → 锚点 id：小写、空格转连字符、去特殊字符（中文保留） */
export function slugifyHeading(text: string): string {
  return text
    .trim()
    .toLowerCase()
    // 保留所有 Unicode 字母（含汉字）、数字、空格与连字符，其余（含中英文标点）删除
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * 同名标题去重器：按调用顺序对重复的基础 id 追加 -2 / -3 …
 * extractToc（全文档一次性遍历）与 MarkdownView（渲染时按文档顺序
 * 调用 h2/h3 覆写）各自持有一个实例，调用顺序一致 → 分配一致。
 */
export function createHeadingIdDeduper(): (text: string) => string {
  const seen = new Map<string, number>();
  return (text: string) => {
    const base = slugifyHeading(text);
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    return n === 1 ? base : `${base}-${n}`;
  };
}

/** 从 Markdown 提取 h2/h3 目录（depth 2/3），代码块内的行不误判 */
export function extractToc(md: string): TocItem[] {
  const tree = unified().use(remarkParse).parse(md);
  const nextId = createHeadingIdDeduper();
  const items: TocItem[] = [];

  visit(tree, "heading", (node) => {
    if (node.depth !== 2 && node.depth !== 3) return;
    const text = toString(node);
    items.push({ depth: node.depth, text, id: nextId(text) });
  });

  return items;
}
