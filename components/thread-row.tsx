import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import type { ThreadListItem } from "@/lib/queries/forum";

/**
 * 帖子列表行（论坛首页「最新动态」与板块页共用，Task 2）。
 *
 * - 标题单行截断（truncate + min-w-0）：100 字长标题不破版（Review Focus #4）
 * - 置顶 / 锁定用 Badge 标记；元信息行含板块名链接（首页传入时才渲染）
 * - 时间：1 天内中文相对时间，超出用绝对日期（2026年10月24日）
 */

/** 论坛通用时间显示（ReplyItem 复用）：1 天内相对，超出绝对日期 */
const zhDate = new Intl.DateTimeFormat("zh-CN", {
  year: "numeric",
  month: "long",
  day: "numeric",
});

export function formatForumTime(date: Date, now: Date = new Date()): string {
  const diffSec = Math.floor((now.getTime() - date.getTime()) / 1000);
  if (diffSec < 60) return "刚刚";
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)} 分钟前`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)} 小时前`;
  return zhDate.format(date);
}

export type ThreadRowProps = {
  thread: ThreadListItem & { forumSlug?: string; forumName?: string };
};

export function ThreadRow({ thread }: ThreadRowProps) {
  const { forumSlug, forumName } = thread;

  return (
    <li className="border-t border-border py-4 first:border-t-0 first:pt-0">
      <div className="flex min-w-0 items-baseline gap-2">
        {thread.isPinned && (
          <Badge variant="secondary">置顶</Badge>
        )}
        {thread.isLocked && (
          <Badge variant="outline">已锁定</Badge>
        )}
        <Link
          href={`/forum/${forumSlug ?? ""}/${thread.id}`}
          data-thread-title
          className="min-w-0 flex-1 truncate font-medium underline-offset-4 hover:underline"
        >
          {thread.title}
        </Link>
      </div>
      <p className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-fg-muted">
        {forumName && forumSlug && (
          <>
            <Link
              href={`/forum/${forumSlug}`}
              className="transition-colors hover:text-accent-soft-fg"
            >
              {forumName}
            </Link>
            <span aria-hidden="true">·</span>
          </>
        )}
        <span>{thread.authorName ?? "匿名用户"}</span>
        <span aria-hidden="true">·</span>
        <span>{thread.replyCount} 回复</span>
        <span aria-hidden="true">·</span>
        <span>{thread.viewCount} 浏览</span>
        <span aria-hidden="true">·</span>
        <time dateTime={thread.lastReplyAt.toISOString()}>
          最后回复 {formatForumTime(thread.lastReplyAt)}
        </time>
      </p>
    </li>
  );
}
