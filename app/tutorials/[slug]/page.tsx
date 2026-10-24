import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { CommentSection } from "@/components/comment-section";
import MarkdownView from "@/components/markdown-view";
import { Badge } from "@/components/ui/badge";
import { listComments } from "@/lib/actions/comments";
import { auth } from "@/lib/auth";
import { getTutorialBySlug } from "@/lib/queries/tutorials";
import { extractToc } from "@/lib/toc";

/**
 * 教程详情页（Task 9）。
 *
 * - ISR 300s：由 getTutorialBySlug 的 "use cache" + cacheLife 承载
 *   （cacheComponents 模式，项目无 export const revalidate）
 * - 布局：max-w-6xl，lg 双栏（左 sticky 目录 w-64 + 右内容 max-w-3xl）；
 *   移动端目录折叠为原生 details（无 JS）置于内容上方
 * - 锚点一致性：目录 id 由 extractToc 生成，MarkdownView 渲染 h2/h3
 *   注入同一规则（lib/toc.ts 共用 slugifyHeading + 去重）的 id
 */

type TutorialDetailPageProps = {
  params: Promise<{ slug: string }>;
};

/**
 * 评论区服务端壳（Task 10）：auth() 与评论预取是请求个性化数据，
 * 必须留在 "use cache" 函数之外——挂在 Suspense 内的异步子组件里
 * （cacheComponents 下读 cookies 的调用需在 Suspense 边界内，参照 site-header）。
 */
async function TutorialCommentArea({ tutorialId }: { tutorialId: string }) {
  let session = null;
  try {
    session = await auth();
  } catch {
    session = null;
  }

  // name 可空（魔法链接用户）：回退邮箱前缀，保证组件「currentUserName 非 null ⟺ 已登录」
  const currentUserName =
    session?.user?.name ??
    (session?.user?.email
      ? session.user.email.split("@")[0] || null
      : null);

  const comments = await listComments("tutorial", tutorialId);

  return (
    <CommentSection
      targetType="tutorial"
      targetId={tutorialId}
      initialComments={comments}
      currentUserName={currentUserName}
    />
  );
}

/** 与评论区大致等高的占位（避免流式注入时布局跳动） */
function CommentAreaFallback() {
  return <div className="h-48" aria-hidden="true" />;
}

export async function generateMetadata({
  params,
}: TutorialDetailPageProps): Promise<Metadata> {
  const { slug } = await params;
  const tutorial = await getTutorialBySlug(slug);
  if (!tutorial) {
    return { title: "教程不存在" };
  }
  return { title: tutorial.title, description: tutorial.summary ?? undefined };
}

export default function TutorialDetailPage(props: TutorialDetailPageProps) {
  // cacheComponents 下 await params 必须在 <Suspense> 内（Task 14 fix）
  return (
    <Suspense fallback={<main className="mx-auto w-full max-w-6xl flex-1" aria-busy="true" />}>
      <TutorialDetailContent {...props} />
    </Suspense>
  );
}

async function TutorialDetailContent({
  params,
}: TutorialDetailPageProps) {
  const { slug } = await params;
  const tutorial = await getTutorialBySlug(slug);
  if (!tutorial) notFound();

  const toc = extractToc(tutorial.contentMd);
  const tocLinks = toc.map((item) => (
    <li key={item.id}>
      <a
        href={`#${item.id}`}
        className={`block py-1 pr-2 text-sm text-fg-muted transition-colors hover:text-accent-soft-fg ${
          item.depth === 3 ? "pl-6" : "pl-3"
        }`}
      >
        {item.text}
      </a>
    </li>
  ));

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col px-4">
      <div
        className={
          toc.length > 0
            ? "flex flex-col gap-8 pb-16 pt-12 lg:grid lg:grid-cols-[16rem_minmax(0,1fr)] lg:gap-10"
            : "pb-16 pt-12"
        }
      >
        {/* 目录：移动端原生 details 折叠在内容上方；lg sticky 左栏常驻 */}
        {toc.length > 0 && (
          <aside className="lg:sticky lg:top-20 lg:self-start">
            <details className="lg:hidden">
              <summary className="cursor-pointer text-sm font-medium text-fg-muted">
                目录
              </summary>
              <ul className="mt-3 flex flex-col">{tocLinks}</ul>
            </details>
            <nav aria-label="目录" className="hidden lg:block">
              <p className="pl-3 text-sm font-medium">目录</p>
              <ul className="mt-2 flex flex-col border-l border-border">
                {tocLinks}
              </ul>
            </nav>
          </aside>
        )}

        {/* 右内容：标题区 + 正文 + 评论区占位 */}
        <div className="min-w-0 max-w-3xl">
          <header className="flex flex-col gap-4 pb-8">
            <h1 className="font-serif-display text-4xl">{tutorial.title}</h1>
            {tutorial.summary && (
              <p className="leading-relaxed text-fg-muted">{tutorial.summary}</p>
            )}
            <div>
              <Badge variant="secondary">{tutorial.category}</Badge>
            </div>
          </header>

          {/* 正文：MarkdownView 渲染 h2/h3 注入与目录一致的锚点 id；
              scroll-mt 避免锚点跳转被 sticky 页头遮挡 */}
          <article className="pb-12 [&_h2]:scroll-mt-20 [&_h3]:scroll-mt-20">
            <MarkdownView content={tutorial.contentMd} />
          </article>

          {/* 评论区：个性化数据在 Suspense 子组件内取，不卷进 ISR 缓存（T10） */}
          <Suspense fallback={<CommentAreaFallback />}>
            <TutorialCommentArea tutorialId={tutorial.id} />
          </Suspense>
        </div>
      </div>
    </main>
  );
}
