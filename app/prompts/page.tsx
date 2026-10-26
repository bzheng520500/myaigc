import Link from "next/link";
import { Suspense } from "react";
import { Pagination } from "@/components/pagination";
import { PromptCard } from "@/components/prompt-card";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { listPromptCategories, listPrompts, PAGE_SIZE } from "@/lib/queries/prompts";

export const dynamic = "force-dynamic";

/**
 * 运镜提示词库列表页（Task 8）。
 *
 * - URL 参数：?category=&q=&page=（筛选变更回到第 1 页）
 * - listPrompts / listPromptCategories 直接查 D1（每次请求实时）
 * - 搜索：原生 GET form 提交到本页，无客户端 JS 依赖
 * - 分类：优先库中 distinct 分类；无库/空表时回退到 schema 约定的四个固定分类，
 *   保证纯静态环境下工具行仍完整可渲染
 */

/** schema 约定的提示词分类（库为空时的回退顺序） */
const FALLBACK_CATEGORIES = ["基础运镜", "组合运镜", "特效运镜", "电影级组合"];

type PromptsPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

/** searchParams 值可能是数组，取第一个 */
function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/** 分类筛选链接：保留 q（搜索词），不带 page（切分类回第 1 页） */
function categoryHref(category: string | undefined, q: string | undefined): string {
  const params = new URLSearchParams();
  if (category) params.set("category", category);
  if (q) params.set("q", q);
  const qs = params.toString();
  return qs ? `/prompts?${qs}` : "/prompts";
}

const filterLinkClass =
  "rounded-full px-3 py-1.5 text-sm text-fg-muted transition-colors hover:bg-accent-soft hover:text-accent-soft-fg";

const filterLinkActiveClass =
  "rounded-full bg-accent-soft px-3 py-1.5 text-sm font-medium text-accent-soft-fg";

export default function PromptsPage(props: PromptsPageProps) {
  // await searchParams 必须在 <Suspense> 内（Task 14 fix）
  return (
    <Suspense fallback={<main className="mx-auto w-full max-w-6xl flex-1" aria-busy="true" />}>
      <PromptsContent {...props} />
    </Suspense>
  );
}

async function PromptsContent({ searchParams }: PromptsPageProps) {
  const sp = await searchParams;
  const category = first(sp.category);
  const q = first(sp.q);
  const page = Math.max(1, Number.parseInt(first(sp.page) ?? "1", 10) || 1);

  const [{ items, total }, dbCategories] = await Promise.all([
    listPrompts({ category, q, page }),
    listPromptCategories(),
  ]);
  const categories = dbCategories.length > 0 ? dbCategories : FALLBACK_CATEGORIES;

  const hasFilter = Boolean(category || q);

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col px-4">
      {/* 页头 */}
      <section className="flex flex-col gap-6 pb-8 pt-12">
        <div>
          <h1 className="font-serif-display text-4xl">运镜提示词库</h1>
          <p className="mt-2 text-fg-muted">
            电影级镜头语言提示词，点击复制即用于 AI 视频生成
          </p>
        </div>

        {/* 工具行：分类筛选 + 搜索 */}
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <nav aria-label="分类筛选" className="flex flex-wrap items-center gap-1">
            <Link
              href={categoryHref(undefined, q)}
              className={!category ? filterLinkActiveClass : filterLinkClass}
            >
              全部
            </Link>
            {categories.map((c) => (
              <Link
                key={c}
                href={categoryHref(c, q)}
                className={c === category ? filterLinkActiveClass : filterLinkClass}
              >
                {c}
              </Link>
            ))}
          </nav>

          <form action="/prompts" method="get" className="flex items-center gap-2">
            {category && <input type="hidden" name="category" value={category} />}
            <Input
              type="search"
              name="q"
              defaultValue={q ?? ""}
              placeholder="搜索提示词名称或中文描述"
              aria-label="搜索提示词"
              className="w-60"
            />
            <Button type="submit" variant="outline">
              搜索
            </Button>
          </form>
        </div>
      </section>

      {/* 主体：PromptCard 网格 / 空态（信息密度高，1/2 列） */}
      <section aria-label="提示词列表" className="pb-10">
        {total > 0 ? (
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {items.map((prompt) => (
              <PromptCard key={prompt.id} prompt={prompt} />
            ))}
          </div>
        ) : (
          <Card className="border border-dashed border-border bg-transparent ring-0">
            <CardContent className="flex w-full flex-col items-center gap-3 py-12">
              <p className="text-sm text-fg-muted">没有找到匹配的提示词</p>
              {hasFilter && (
                <Link
                  href="/prompts"
                  className="text-sm text-accent-soft-fg underline-offset-4 hover:underline"
                >
                  清除筛选条件
                </Link>
              )}
            </CardContent>
          </Card>
        )}
      </section>

      {/* 底部分页 */}
      <div className="pb-16">
        <Pagination
          page={page}
          total={total}
          pageSize={PAGE_SIZE}
          basePath="/prompts"
          searchParams={{ category, q }}
        />
      </div>
    </main>
  );
}
