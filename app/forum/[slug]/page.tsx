import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { Pagination } from "@/components/pagination";
import { ThreadRow } from "@/components/thread-row";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  getForumBySlug,
  listThreads,
  THREADS_PAGE_SIZE,
  type ListThreadsOptions,
} from "@/lib/queries/forum";

/**
 * 板块页（Task 2）：板块头 + 排序 Tab + 帖子列表 + 分页。
 *
 * - URL 参数：?sort=last_reply|created（默认 last_reply）+ ?page=
 * - ISR 60s：由 getForumBySlug / listThreads 的 "use cache" + cacheLife 承载
 * - cacheComponents 下 await params / searchParams 必须在 <Suspense> 内
 *   （default export 为 sync 壳，与 app/skills/page.tsx 同模式）
 */

type ForumSlugPageProps = {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

/** searchParams 值可能是数组，取第一个 */
function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/** 解析排序参数：仅 created 合法，其余（含缺省）归 last_reply */
function parseSort(raw: string | undefined): ListThreadsOptions["sort"] {
  return raw === "created" ? "created" : "last_reply";
}

const tabLinkClass =
  "rounded-full px-3 py-1.5 text-sm text-fg-muted transition-colors hover:bg-accent-soft hover:text-accent-soft-fg";

const tabLinkActiveClass =
  "rounded-full bg-accent-soft px-3 py-1.5 text-sm font-medium text-accent-soft-fg";

/** 排序 Tab 链接：默认 last_reply 不带 sort 参数，切排序回第 1 页 */
function sortHref(slug: string, sort: ListThreadsOptions["sort"]): string {
  return sort === "created" ? `/forum/${slug}?sort=created` : `/forum/${slug}`;
}

export default function ForumSlugPage(props: ForumSlugPageProps) {
  return (
    <Suspense fallback={<main className="mx-auto w-full max-w-6xl flex-1" aria-busy="true" />}>
      <ForumSlugContent {...props} />
    </Suspense>
  );
}

async function ForumSlugContent({ params, searchParams }: ForumSlugPageProps) {
  const { slug } = await params;
  const sp = await searchParams;
  const sort = parseSort(first(sp.sort));
  const page = Math.max(1, Number.parseInt(first(sp.page) ?? "1", 10) || 1);

  const [forum, { items, total }] = await Promise.all([
    getForumBySlug(slug),
    listThreads(slug, { sort, page }),
  ]);

  // 板块不存在（与「板块存在但无帖」区分开）
  if (!forum) notFound();

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col px-4">
      {/* 板块头 */}
      <section className="flex flex-col gap-4 pb-8 pt-12">
        <div>
          <h1 className="font-serif-display text-4xl">{forum.name}</h1>
          {forum.description && (
            <p className="mt-2 leading-relaxed text-fg-muted">
              {forum.description}
            </p>
          )}
        </div>

        {/* 排序切换（链接式 Tab） */}
        <nav aria-label="帖子排序" className="flex flex-wrap items-center gap-1">
          <Link
            href={sortHref(slug, "last_reply")}
            aria-current={sort === "last_reply" ? "true" : undefined}
            className={sort === "last_reply" ? tabLinkActiveClass : tabLinkClass}
          >
            最后回复
          </Link>
          <Link
            href={sortHref(slug, "created")}
            aria-current={sort === "created" ? "true" : undefined}
            className={sort === "created" ? tabLinkActiveClass : tabLinkClass}
          >
            最新发布
          </Link>
        </nav>
      </section>

      {/* 帖子列表 / 空板块 */}
      <section aria-label="帖子列表" className="pb-10">
        {items.length > 0 ? (
          <ul className="flex flex-col">
            {items.map((thread) => (
              // 只补 forumSlug 供行内链接，不传 forumName（同板块无需重复板块名）
              <ThreadRow key={thread.id} thread={{ ...thread, forumSlug: slug }} />
            ))}
          </ul>
        ) : (
          <Card className="border border-dashed border-border bg-transparent ring-0">
            <CardContent className="flex w-full flex-col items-center gap-3 py-12">
              <p className="text-sm text-fg-muted">还没有帖子，来发第一帖</p>
              <Link
                href={`/forum/new?forum=${encodeURIComponent(slug)}`}
                className={buttonVariants({ variant: "default" })}
              >
                发布帖子
              </Link>
            </CardContent>
          </Card>
        )}
      </section>

      {/* 底部分页：保留非默认 sort，page 由组件管理 */}
      <div className="pb-16">
        <Pagination
          page={page}
          total={total}
          pageSize={THREADS_PAGE_SIZE}
          basePath={`/forum/${slug}`}
          searchParams={{ sort: sort === "created" ? "created" : undefined }}
        />
      </div>
    </main>
  );
}
