import { isValidElement, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import rehypeSanitize from "rehype-sanitize";
import remarkGfm from "remark-gfm";
import { sanitizeSchema } from "@/lib/markdown";
import { createHeadingIdDeduper } from "@/lib/toc";

/**
 * Markdown 安全渲染组件（Task 7；Task 9 增加标题锚点）。
 *
 * server component：react-markdown + remark-gfm（表格/删除线/任务列表）
 * + rehype-sanitize（白名单消毒，全站 XSS 防线，schema 见 lib/markdown.ts）。
 * 排版样式由 globals.css 的 .markdown-body 承载（项目未装 typography 插件）。
 *
 * 标题锚点（Task 9）：h2/h3 注入 id 供教程页目录跳转。id 由
 * lib/toc.ts 的 createHeadingIdDeduper 生成——与 extractToc 共用同一
 * slug 规则与去重逻辑；server 渲染按文档顺序同步调用覆写组件，
 * 闭包计数器与 extractToc 的遍历顺序一致，锚点两侧严格对齐。
 */

/** 从 React children 递归提取纯文本（与 mdast toString 对行内格式的剥除一致） */
function childrenText(node: ReactNode): string {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(childrenText).join("");
  if (isValidElement<{ children?: ReactNode }>(node)) {
    return childrenText(node.props.children);
  }
  return "";
}

export default function MarkdownView({ content }: { content: string }) {
  // 每次渲染新建去重器：闭包状态随本次 AST 遍历按文档顺序累积
  const nextHeadingId = createHeadingIdDeduper();

  return (
    <div className="markdown-body">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[[rehypeSanitize, sanitizeSchema]]}
        components={{
          h2: ({ children }) => (
            <h2 id={nextHeadingId(childrenText(children))}>{children}</h2>
          ),
          h3: ({ children }) => (
            <h3 id={nextHeadingId(childrenText(children))}>{children}</h3>
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
