import type { Metadata } from "next";
import type { Session } from "next-auth";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { auth } from "@/lib/auth";
import { FavoriteButton } from "@/components/favorite-button";
import { LikeButton } from "@/components/like-button";
import MarkdownView from "@/components/markdown-view";
import { ReplyItem } from "@/components/reply-item";
import { ReplyForm } from "@/components/reply-form";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { formatForumTime } from "@/components/thread-row";
import { getThreadById, listReplies } from "@/lib/queries/forum";

/**
 * 帖子详情页（Task 2）：帖子头 + Markdown 正文 + 楼层列表 + 回复表单
 * （Task 3 挂载 ReplyForm）。
 *
 * - ISR 60s：由 getThreadById / listReplies 的 "use cache" + cacheLife 承载
 * - hidden 帖或不存在 → notFound()（404，Review Focus #5）
 * - 作者名 span 不加链：Phase 3 用户主页路由上线后再挂 /u/[id]
 * - cacheComponents 下 await params / auth() 都必须在 <Suspense> 内
 *   （generateMetadata 中的 await params 不受此限，与 skills/[slug] 同模式）
 * - auth() 读 session 判登录态，以 isLoggedIn 传给 client 的 ReplyForm
 *   （client 组件无法直接调 auth()，参照 CommentSection 模式）
 */

type ThreadPageProps = {
  params: Promise<{ slug: string; threadId: string }>;
};

export async function generateMetadata({
  params,
}: ThreadPageProps): Promise<Metadata> {
  const { threadId } = await params;
  const row = await getThreadById(threadId);
  return { title: row ? row.thread.title : "帖子不存在" };
}

export default function ThreadPage(props: ThreadPageProps) {
  return (
    <Suspense fallback={<main className="mx-auto w-full max-w-3xl flex-1" aria-busy="true" />}>
      <ThreadPageContent {...props} />
    </Suspense>
  );
}

async function ThreadPageContent({ params }: ThreadPageProps) {
  const { threadId } = await params;
  const row = await getThreadById(threadId);
  if (!row) notFound();

  const { thread, authorName } = row;
  const replies = await listReplies(threadId);

  let session: Session | null = null;
  try {
    session = await auth();
  } catch {
    session = null;
  }
  const isLoggedIn = Boolean(
    (session?.user as { id?: string } | undefined)?.id,
  );

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col px-4">
      {/* 帖子头 */}
      <header className="flex flex-col gap-4 pb-8 pt-12">
        <h1 className="font-serif-display text-4xl">{thread.title}</h1>

        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-fg-muted">
          {thread.isPinned && <Badge variant="secondary">置顶</Badge>}
          {thread.isLocked && <Badge variant="outline">已锁定</Badge>}
          {/* Phase 3 用户主页路由上线后再挂链接（暂为纯文本，避免死链） */}
          <span>{authorName ?? "匿名用户"}</span>
          <span aria-hidden="true">·</span>
          <time dateTime={thread.createdAt.toISOString()}>
            发布于 {formatForumTime(thread.createdAt)}
          </time>
          <span aria-hidden="true">·</span>
          <span>{thread.viewCount} 次浏览</span>
          {/* Phase 3 点赞/收藏：client 组件挂载后自取个性化状态 */}
          <LikeButton
            targetType="thread"
            targetId={thread.id}
            initialCount={thread.likeCount}
          />
          <FavoriteButton targetType="thread" targetId={thread.id} />
        </div>
      </header>

      {/* 帖子正文：MarkdownView 内部经 rehype-sanitize 消毒 */}
      <article className="pb-12">
        <MarkdownView content={thread.contentMd} />
      </article>

      {/* 楼层列表（hidden 楼层已在 listReplies 过滤，不渲染） */}
      <section aria-label="回复楼层" className="pb-12">
        {replies.length > 0 ? (
          <ol className="flex flex-col">
            {replies.map((reply) => (
              <ReplyItem
                key={reply.id}
                reply={reply}
                likeSlot={
                  <LikeButton
                    targetType="reply"
                    targetId={reply.id}
                    initialCount={reply.likeCount}
                  />
                }
              />
            ))}
          </ol>
        ) : (
          <p className="border-t border-border pt-6 text-sm text-fg-muted">
            还没有回复，来抢沙发吧。
          </p>
        )}
      </section>

      {/* 回复区：锁定帖显示提示卡，否则渲染回复表单（Task 3） */}
      {thread.isLocked ? (
        <Card className="mb-16 border border-dashed border-border bg-transparent ring-0">
          <CardContent className="flex w-full items-center justify-center py-8">
            <p className="text-sm text-fg-muted">帖子已锁定，无法回复</p>
          </CardContent>
        </Card>
      ) : (
        <section aria-label="回复区" className="pb-16">
          <ReplyForm
            threadId={thread.id}
            locked={thread.isLocked}
            isLoggedIn={isLoggedIn}
          />
        </section>
      )}
    </main>
  );
}
