import Link from "next/link";
import type { ReactNode } from "react";
import MarkdownView from "@/components/markdown-view";
import { formatForumTime } from "@/components/thread-row";
import type { ReplyListItem } from "@/lib/queries/forum";

/**
 * 帖子楼层行（帖子详情页，Task 2）。
 *
 * - 楼层号（#N，data-floor-number 供 E2E 断言递增）
 * - 正文经 MarkdownView 白名单消毒渲染（全站 XSS 防线）
 * - hidden 楼层不进入本组件（listReplies 已过滤）
 * - likeSlot（Phase 3）：页面传入楼层点赞按钮插槽，
 *   本组件保持服务端组件零客户端化
 */

export type ReplyItemProps = {
  reply: ReplyListItem;
  /** 点赞按钮插槽（页面渲染 LikeButton 后传入） */
  likeSlot?: ReactNode;
};

export function ReplyItem({ reply, likeSlot }: ReplyItemProps) {
  return (
    <li className="border-t border-border py-5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <div className="flex flex-wrap items-baseline gap-2">
          <Link
            href={`/u/${reply.authorId}`}
            className="font-serif text-sm font-medium transition-colors hover:text-accent-soft-fg"
          >
            {reply.authorName ?? "匿名用户"}
          </Link>
          <time
            dateTime={reply.createdAt.toISOString()}
            className="text-xs text-fg-muted"
          >
            {formatForumTime(reply.createdAt)}
          </time>
        </div>
        <span
          data-floor-number={reply.floorNumber}
          className="text-xs text-fg-muted"
        >
          #{reply.floorNumber}
        </span>
      </div>
      <div className="mt-3">
        <MarkdownView content={reply.contentMd} />
      </div>
      {likeSlot && <div className="mt-3">{likeSlot}</div>}
    </li>
  );
}
