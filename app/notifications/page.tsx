import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import type { Session } from "next-auth";
import { Heart, MessageCircle, MessageSquare } from "lucide-react";
import { auth } from "@/lib/auth";
import { NotificationLink } from "@/components/notification-bell";
import { formatForumTime } from "@/components/thread-row";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { markAllRead } from "@/lib/actions/notifications";
import {
  listNotifications,
  NOTIFICATIONS_PAGE_SIZE,
  type NotificationType,
} from "@/lib/notify";

/**
 * 通知中心（Phase 3 Task 2，server 页）。
 *
 * - middleware 已拦截 /notifications（302 登录页），页面层 auth() 守卫
 *   是双保险（cacheComponents 下 auth() 读 cookies，必须位于 <Suspense>
 *   边界内的异步子组件，参照 app/forum/new/page.tsx）
 * - 列表数据 listNotifications：个人数据禁缓存（无 "use cache"），
 *   标读 / 全部已读后 form action 提交触发当前路由自动重渲染
 * - 条目点击 NotificationLink（client）：先 markNotificationRead 再
 *   router.push 跳源；link 为 null（源已删）渲染纯文本不可点
 * - 分页：接口无 total（{ items, unread } 契约），用上一页/下一页
 *   简版分页——items 满页即提供下一页，不足一页视为末页
 */

type NotificationsPageProps = {
  searchParams: Promise<{ page?: string | string[] | undefined }>;
};

/** searchParams 值可能是数组，取第一个（与板块页 first() 同模式） */
function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/** 类型 → 动作文案（reply_reply 本期不产生，文案保留） */
const TYPE_TEXT: Record<NotificationType, string> = {
  thread_reply: "回复了你的帖子",
  reply_reply: "回复了你",
  skill_comment: "评论了你的 Skill",
  like: "赞了你的内容",
};

function TypeIcon({ type }: { type: NotificationType }) {
  const cls = "size-4 shrink-0 text-fg-muted";
  if (type === "like") return <Heart className={cls} aria-hidden="true" />;
  if (type === "skill_comment") {
    return <MessageSquare className={cls} aria-hidden="true" />;
  }
  return <MessageCircle className={cls} aria-hidden="true" />;
}

const pagerLinkClass =
  "inline-flex h-8 items-center rounded-full px-3 text-sm text-fg-muted transition-colors hover:bg-accent-soft hover:text-accent-soft-fg";

const pagerDisabledClass =
  "inline-flex h-8 items-center rounded-full px-3 text-sm text-fg-muted/50 cursor-not-allowed";

async function NotificationsContent({
  searchParams,
}: NotificationsPageProps) {
  const sp = await searchParams;
  const page = Math.max(1, Number.parseInt(first(sp.page) ?? "1", 10) || 1);

  let session: Session | null = null;
  try {
    session = await auth();
  } catch {
    session = null;
  }
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) {
    redirect("/login?returnUrl=/notifications");
  }

  const { items, unread } = await listNotifications(userId, page);
  const hasPrev = page > 1;
  // 满页才给下一页（不足一页即末页，无 total 的简版判定）
  const hasNext = items.length === NOTIFICATIONS_PAGE_SIZE;

  return (
    <div className="flex flex-col gap-6 pb-16">
      {/* 未读概览 + 全部已读（form action 提交后 Next 自动重渲染当前路由） */}
      <div className="flex items-center justify-between gap-4 border-b border-border pb-4">
        <p className="text-sm text-fg-muted">
          {unread > 0 ? `${unread} 条未读` : "没有未读通知"}
        </p>
        {unread > 0 && (
          <form action={markAllRead}>
            <button
              type="submit"
              className={buttonVariants({ variant: "outline", size: "sm" })}
            >
              全部已读
            </button>
          </form>
        )}
      </div>

      {/* 通知列表 / 空态 */}
      {items.length > 0 ? (
        <ul aria-label="通知列表" className="flex flex-col">
          {items.map((n) => (
            <li
              key={n.id}
              data-notification-row={n.readAt === null ? "unread" : "read"}
              className="border-b border-border last:border-b-0"
            >
              <NotificationLink id={n.id} link={n.link}>
                <div className="flex min-w-0 items-center gap-2.5 py-3.5">
                  <TypeIcon type={n.type} />
                  <p className="min-w-0 flex-1 truncate text-sm">
                    <span className="font-medium">{n.actorName ?? "某用户"}</span>{" "}
                    {TYPE_TEXT[n.type]}
                  </p>
                  <time
                    dateTime={n.createdAt.toISOString()}
                    className="shrink-0 text-xs text-fg-muted"
                  >
                    {formatForumTime(n.createdAt)}
                  </time>
                  {n.readAt === null && (
                    <span
                      data-unread-dot
                      aria-hidden="true"
                      className="size-2 shrink-0 rounded-full bg-blue-600"
                    />
                  )}
                </div>
              </NotificationLink>
            </li>
          ))}
        </ul>
      ) : (
        <Card className="border border-dashed border-border bg-transparent ring-0">
          <CardContent className="flex w-full items-center justify-center py-10">
            <p className="text-sm text-fg-muted">还没有通知，去论坛逛逛吧</p>
          </CardContent>
        </Card>
      )}

      {/* 简版分页：无 total 契约下的上一页/下一页 */}
      {(hasPrev || hasNext) && (
        <nav aria-label="分页" className="flex items-center justify-center gap-1">
          {hasPrev ? (
            <Link
              href={page > 2 ? `/notifications?page=${page - 1}` : "/notifications"}
              rel="prev"
              className={pagerLinkClass}
            >
              上一页
            </Link>
          ) : (
            <span aria-disabled="true" className={pagerDisabledClass}>
              上一页
            </span>
          )}
          {hasNext ? (
            <Link
              href={`/notifications?page=${page + 1}`}
              rel="next"
              className={pagerLinkClass}
            >
              下一页
            </Link>
          ) : (
            <span aria-disabled="true" className={pagerDisabledClass}>
              下一页
            </span>
          )}
        </nav>
      )}
    </div>
  );
}

/** 与列表大致等高的占位（避免流式注入时布局跳动，与发帖页同模式） */
function NotificationsFallback() {
  return <div className="h-[480px]" aria-hidden="true" />;
}

export default function NotificationsPage(props: NotificationsPageProps) {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col px-4">
      <section className="flex flex-col gap-2 pb-8 pt-12">
        <h1 className="font-serif-display text-4xl">通知中心</h1>
        <p className="leading-relaxed text-fg-muted">
          回复、评论与点赞的动态都在这里。
        </p>
      </section>

      <Suspense fallback={<NotificationsFallback />}>
        <NotificationsContent searchParams={props.searchParams} />
      </Suspense>
    </main>
  );
}
