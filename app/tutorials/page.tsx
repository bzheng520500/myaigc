import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { listTutorials } from "@/lib/queries/tutorials";

export const dynamic = "force-dynamic";

/**
 * 教程列表页（Task 9）。
 *
 * - 单列卡片（max-w-3xl）：衬线标题 + summary 两行截断 +「阅读全文 →」，
 *   整卡可点（stretched Link，模式同 SkillCard）
 * - listTutorials 直接查 D1（每次请求实时）
 */

export default async function TutorialsPage() {
  const items = await listTutorials();

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col px-4">
      {/* 页头 */}
      <section className="pb-8 pt-12">
        <h1 className="font-serif-display text-4xl">运镜教程</h1>
        <p className="mt-2 text-fg-muted">从零掌握 AI 视频的镜头语言</p>
      </section>

      {/* 主体：单列卡片 / 空态 */}
      <section aria-label="教程列表" className="flex flex-col gap-4 pb-16">
        {items.length > 0 ? (
          items.map((tutorial) => (
            <Card
              key={tutorial.id}
              className="group relative gap-2 transition-shadow hover:shadow-card-hover"
            >
              <CardHeader>
                <CardTitle className="font-serif-display text-xl leading-snug">
                  {tutorial.title}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="line-clamp-2 min-h-10 text-sm leading-relaxed text-fg-muted">
                  {tutorial.summary ?? "暂无简介"}
                </p>
                <p className="mt-3 text-sm transition-colors group-hover:text-accent-soft-fg">
                  阅读全文 →
                </p>
              </CardContent>
              <Link
                href={`/tutorials/${tutorial.slug}`}
                aria-label={`阅读 ${tutorial.title}`}
                className="absolute inset-0 rounded-xl"
              >
                <span className="sr-only">{tutorial.title}</span>
              </Link>
            </Card>
          ))
        ) : (
          <Card className="border border-dashed border-border bg-transparent ring-0">
            <CardContent className="flex w-full flex-col items-center gap-3 py-12">
              <p className="text-sm text-fg-muted">教程即将上线</p>
            </CardContent>
          </Card>
        )}
      </section>
    </main>
  );
}
