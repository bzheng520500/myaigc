import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import MarkdownView from "@/components/markdown-view";

/**
 * Markdown 渲染 XSS 防护（Task 7 核心验收，Review Focus #1）。
 *
 * MarkdownView 必须经 rehype-sanitize 白名单消毒：
 * script 标签、事件属性（onerror 等）、javascript: 协议全部剥离，
 * 同时 GFM 表格 / 代码块 / 行内代码等正常能力不受影响。
 *
 * vitest include 仅收 .ts：用 createElement 替代 JSX。
 */

function render(content: string): string {
  return renderToStaticMarkup(createElement(MarkdownView, { content }));
}

describe("MarkdownView sanitize（XSS 防护）", () => {
  it("script 注入被移除，正文保留", () => {
    // script 与正文分段：CommonMark 里 <script> 是 raw HTML 块，与正文
    // 同块时整块丢弃；分段才能同时验证「块被移除」与「正文不受牵连」
    const html = render("<script>alert(1)</script>\n\n正文");
    expect(html).not.toContain("<script");
    expect(html).toContain("正文");
  });

  it("img onerror 被移除", () => {
    const html = render("<img src=x onerror=alert(1)>");
    expect(html).not.toContain("onerror");
  });

  it("a 链接 javascript: 协议被移除", () => {
    const html = render("[点我](javascript:alert(1))");
    expect(html).not.toContain("javascript:");
  });

  it("GFM 表格正常渲染", () => {
    const html = render("| a | b |\n|---|---|\n| 1 | 2 |");
    expect(html).toContain("<table");
    expect(html).toContain("<th");
  });

  it("行内代码与代码块渲染（language-* className 透传）", () => {
    const html = render("行内 `code` 与代码块：\n\n```js\nconsole.log(1)\n```\n");
    expect(html).toContain("<pre>");
    expect(html).toContain("<code>code</code>");
    // className 透传：代码高亮与样式挂钩的前提
    expect(html).toContain("language-js");
  });
});
