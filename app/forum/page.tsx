import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ThreadRow } from "@/components/thread-row";
import { listForums, listLatestThreads } from "@/lib/queries/forum";

export const dynamic = "force-dynamic";

/**
 * 论坛首页（Task 2）：板块卡片网格 + 全站最新帖。
 *
 * - listForums / listLatestThreads 直接查 D1（每次请求实时）
 * - 无动态参数（params / searchParams），页面组件直接 async
 *   （与 app/page.tsx 同模式，无 Suspense 壳要求）
 */

/** 首页「最新动态」条数 */
const LATEST_THREADS_LIMIT = 10;

export default async function ForumHomePage() {
  const [forums, latest] = await Promise.all([
    listForums(),
    listLatestThreads(LATEST_THREADS_LIMIT),
  ]);

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col px-4">
      {/* 页头 */}
      <section className="pb-8 pt-12">
        <h1 className="font-serif-display text-4xl">论坛</h1>
        <p className="mt-2 text-fg-muted">与创作者们交流心得、分享作品</p>
      </section>

      {/* 板块卡片网格 */}
      <section aria-label="讨论板块" className="pb-12">
        {forums.length > 0 ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {forums.map((forum) => (
              <Card key={forum.id} className="group relative gap-2 transition-shadow hover:shadow-card-hover">
                <CardHeader>
                  <CardTitle className="font-serif-display text-base leading-snug">
                    {forum.name}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="line-clamp-2 min-h-10 text-sm leading-relaxed text-fg-muted">
                    {forum.description ?? "暂无简介"}
                  </p>
                  <p className="mt-3 text-xs text-fg-muted">
                    {forum.threadCount} 帖 · {forum.replyCount} 回复
                  </p>
                </CardContent>
                <Link
                  href={`/forum/${forum.slug}`}
                  aria-label={`进入${forum.name}`}
                  className="absolute inset-0 rounded-xl"
                >
                  <span className="sr-only">{forum.name}</span>
                </Link>
              </Card>
            ))}
          </div>
        ) : (
          <Card className="border border-dashed border-border bg-transparent ring-0">
            <CardHeader>
              <CardTitle className="text-base text-fg-muted">
                板块即将上线
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm leading-relaxed text-fg-muted">
                社区讨论板块正在筹备中，敬请期待。
              </p>
            </CardContent>
          </Card>
        )}
      </section>

      {/* 全站最新帖 */}
      <section aria-label="最新动态" className="pb-16">
        <h2 className="mb-4 font-serif-display text-2xl">最新动态</h2>
        {latest.length > 0 ? (
          <ul className="flex flex-col">
            {latest.map((thread) => (
              <ThreadRow key={thread.id} thread={thread} />
            ))}
          </ul>
        ) : (
          <Card className="border border-dashed border-border bg-transparent ring-0">
            <CardContent className="flex w-full items-center justify-center py-8">
              <p className="text-sm text-fg-muted">还没有帖子，来发第一帖</p>
            </CardContent>
          </Card>
        )}
      </section>
    </main>
  );
}
