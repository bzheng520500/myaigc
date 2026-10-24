"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { LikeButton } from "@/components/like-button";
import { createComment } from "@/lib/actions/comments";
import type { CommentItem, CommentTargetType } from "@/lib/actions/comments-core";

/**
 * 评论区（Task 10）。
 *
 * - 列表：作者名（衬线小字）+ 中文相对时间 + 纯文本内容
 *   （whitespace-pre-wrap 保持换行，不做 Markdown）
 * - 表单：登录后显示；未登录替换为「登录后参与评论」
 *   （returnUrl 带回当前路径）
 * - 提交：调 createComment server action；失败显示行内中文错误
 *   （layout 未挂 Toaster，与 CopyButton 同理不用 toast）；
 *   成功后 optimistic 插入列表头部（作者名由服务端页传入）
 * - submitting 态禁用防重复提交
 */

export type CommentSectionProps = {
  targetType: CommentTargetType;
  targetId: string;
  initialComments: CommentItem[];
  /** 服务端页传入：null/undefined 视为未登录（name 为空时页面回退邮箱前缀） */
  currentUserName?: string | null;
};

/** 错误码 → 中文文案 */
const ERROR_MESSAGES = {
  unauthorized: "请先登录",
  too_long: "评论不能超过 2000 字",
  rate_limited: "评论太频繁，请稍后再试",
  not_found: "内容不存在",
  empty: "评论不能为空",
  server_error: "操作失败，请稍后再试", // 终审 F7：写库异常兜底
} as const;

/** 相对时间（简单实现）：<60s 刚刚 → 分钟 → 小时 → 天 */
function formatRelativeTime(date: Date, now: Date = new Date()): string {
  const diffSec = Math.max(
    0,
    Math.floor((now.getTime() - date.getTime()) / 1000),
  );
  if (diffSec < 60) return "刚刚";
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)} 分钟前`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)} 小时前`;
  return `${Math.floor(diffSec / 86400)} 天前`;
}

export function CommentSection({
  targetType,
  targetId,
  initialComments,
  currentUserName,
}: CommentSectionProps) {
  const pathname = usePathname();
  const [items, setItems] = useState<CommentItem[]>(initialComments);
  const [content, setContent] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const isLoggedIn = currentUserName != null;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;

    const trimmed = content.trim();
    if (!trimmed) {
      setError(ERROR_MESSAGES.empty);
      return;
    }

    setError(null);
    setSubmitting(true);
    try {
      const result = await createComment({ targetType, targetId, content: trimmed });
      if (result.ok) {
        // optimistic：最新评论插到列表头部（与 created_at desc 一致）
        // authorId 空串：client 不知道自己的 user id，渲染时降级纯文本
        setItems((prev) => [
          {
            id: crypto.randomUUID(),
            content: trimmed,
            createdAt: new Date(),
            authorId: "",
            authorName: currentUserName ?? null,
            authorImage: null,
            likeCount: 0,
          },
          ...prev,
        ]);
        setContent("");
      } else {
        setError(ERROR_MESSAGES[result.error]);
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section aria-label="评论区" className="flex flex-col gap-6">
      <h2 className="font-serif-display text-2xl">评论
        <span className="ml-2 align-middle text-sm font-normal text-fg-muted">
          {items.length > 0 ? `${items.length} 条` : ""}
        </span>
      </h2>

      {/* 评论表单 / 登录引导 */}
      {isLoggedIn ? (
        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="写下你的评论…"
            rows={4}
            maxLength={2000}
            disabled={submitting}
            aria-label="评论内容"
            className="w-full resize-y rounded-lg border border-border bg-background px-3 py-2 text-sm leading-relaxed outline-none transition-colors placeholder:text-fg-muted focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50"
          />
          {error && (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          )}
          <div className="flex justify-end">
            <Button type="submit" size="sm" disabled={submitting}>
              {submitting ? "发布中…" : "发布评论"}
            </Button>
          </div>
        </form>
      ) : (
        <Link
          href={`/login?returnUrl=${encodeURIComponent(pathname)}`}
          className="self-start rounded-full border border-border px-4 py-2 text-sm text-fg-muted transition-colors hover:bg-accent-soft hover:text-accent-soft-fg"
        >
          登录后参与评论
        </Link>
      )}

      {/* 评论列表：纯文本渲染，保持换行 */}
      {items.length === 0 ? (
        <p className="text-sm text-fg-muted">还没有评论，来抢沙发吧。</p>
      ) : (
        <ul className="flex flex-col gap-5">
          {items.map((comment) => (
            <li key={comment.id} className="flex flex-col gap-1.5 border-t border-border pt-4">
              <div className="flex items-baseline gap-2">
                {comment.authorId ? (
                  <Link
                    href={`/u/${comment.authorId}`}
                    className="font-serif text-sm font-medium transition-colors hover:text-accent-soft-fg"
                  >
                    {comment.authorName ?? "匿名用户"}
                  </Link>
                ) : (
                  <span className="font-serif text-sm font-medium">
                    {comment.authorName ?? "匿名用户"}
                  </span>
                )}
                {/* SSR 与 hydration 时刻不同可能差一档，抑制水合告警 */}
                <time
                  dateTime={comment.createdAt.toISOString()}
                  className="text-xs text-fg-muted"
                  suppressHydrationWarning
                >
                  {formatRelativeTime(comment.createdAt)}
                </time>
              </div>
              <p className="text-sm leading-relaxed whitespace-pre-wrap">
                {comment.content}
              </p>
              {/* Phase 3 评论点赞：client 组件直接内嵌（本组件已是 client） */}
              <div>
                <LikeButton
                  targetType="comment"
                  targetId={comment.id}
                  initialCount={comment.likeCount}
                />
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
