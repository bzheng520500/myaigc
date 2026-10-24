import type { Metadata } from "next";
import { notFound } from "next/navigation";
import MarkdownView from "@/components/markdown-view";
import { Badge } from "@/components/ui/badge";
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

export default async function TutorialDetailPage({
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

          {/* CommentSection T10 */}
        </div>
      </div>
    </main>
  );
}
