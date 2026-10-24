"use client";

import ReactMarkdown from "react-markdown";
import rehypeSanitize from "rehype-sanitize";
import remarkGfm from "remark-gfm";
import { sanitizeSchema } from "@/lib/markdown";

/**
 * Markdown 实时预览（Task 11 上传页编辑器右侧）。
 *
 * MarkdownView（Task 7）是 server 组件（含 TOC 锚点闭包），客户端
 * 不能直接复用；此组件在客户端用同一套 react-markdown + remark-gfm
 * + rehype-sanitize 管线渲染，消毒 schema 直接复用 lib/markdown.ts
 * 的 sanitizeSchema，保证预览与详情页正文同一 XSS 白名单。
 */
export function MarkdownPreview({ content }: { content: string }) {
  return (
    <div
      className="markdown-body min-h-0 overflow-y-auto text-sm"
      aria-label="Markdown 预览"
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[[rehypeSanitize, sanitizeSchema]]}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
