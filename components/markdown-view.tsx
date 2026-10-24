import ReactMarkdown from "react-markdown";
import rehypeSanitize from "rehype-sanitize";
import remarkGfm from "remark-gfm";
import { sanitizeSchema } from "@/lib/markdown";

/**
 * Markdown 安全渲染组件（Task 7）。
 *
 * server component：react-markdown + remark-gfm（表格/删除线/任务列表）
 * + rehype-sanitize（白名单消毒，全站 XSS 防线，schema 见 lib/markdown.ts）。
 * 排版样式由 globals.css 的 .markdown-body 承载（项目未装 typography 插件）。
 */
export default function MarkdownView({ content }: { content: string }) {
  return (
    <div className="markdown-body">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[[rehypeSanitize, sanitizeSchema]]}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
