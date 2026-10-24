import Link from "next/link";
import { Suspense } from "react";
import { Pagination } from "@/components/pagination";
import { SkillCard } from "@/components/skill-card";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { listCategories, listSkills, PAGE_SIZE } from "@/lib/queries/skills";

/**
 * Skill 库列表页（Task 6）。
 *
 * - URL 参数：?category=&q=&page=（筛选变更回到第 1 页）
 * - ISR 300s：由 listSkills / listCategories 的 "use cache" + cacheLife 承载
 *   （cacheComponents 模式，项目无 export const revalidate）
 * - 搜索：原生 GET form 提交到本页，无客户端 JS 依赖
 */

type SkillsPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

/** searchParams 值可能是数组，取第一个 */
function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/** 解析排序参数（终审 F4）：仅 hot 合法，其余（含缺省）归 new */
function parseSort(raw: string | undefined): "new" | "hot" {
  return raw === "hot" ? "hot" : "new";
}

/**
 * 筛选链接（终审 F4 统一）：保留 category / q / sort 非默认值，
 * 不带 page（任何筛选/排序切换回第 1 页），缺省项不写参数保持 URL 干净。
 */
function filterHref(params: {
  category?: string;
  q?: string;
  sort?: string;
}): string {
  const sp = new URLSearchParams();
  if (params.category) sp.set("category", params.category);
  if (params.q) sp.set("q", params.q);
  if (params.sort) sp.set("sort", params.sort);
  const qs = sp.toString();
  return qs ? `/skills?${qs}` : "/skills";
}

const filterLinkClass =
  "rounded-full px-3 py-1.5 text-sm text-fg-muted transition-colors hover:bg-accent-soft hover:text-accent-soft-fg";

const filterLinkActiveClass =
  "rounded-full bg-accent-soft px-3 py-1.5 text-sm font-medium text-accent-soft-fg";

export default function SkillsPage(props: SkillsPageProps) {
  // cacheComponents 下 await searchParams 必须在 <Suspense> 内（Task 14 fix）
  return (
    <Suspense fallback={<main className="mx-auto w-full max-w-6xl flex-1" aria-busy="true" />}>
      <SkillsContent {...props} />
    </Suspense>
  );
}

async function SkillsContent({ searchParams }: SkillsPageProps) {
  const sp = await searchParams;
  const category = first(sp.category);
  const q = first(sp.q);
  const sort = parseSort(first(sp.sort));
  const page = Math.max(1, Number.parseInt(first(sp.page) ?? "1", 10) || 1);

  const [{ items, total }, categories] = await Promise.all([
    listSkills({ category, q, page, sort }),
    listCategories(),
  ]);

  const hasFilter = Boolean(category || q);

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col px-4">
      {/* 页头 */}
      <section className="flex flex-col gap-6 pb-8 pt-12">
        <div>
          <h1 className="font-serif-display text-4xl">Skill 库</h1>
          <p className="mt-2 text-fg-muted">
            从故事创作到后期包装的可复用技能文档
          </p>
        </div>

        {/* 工具行：分类筛选 + 排序切换 + 搜索 */}
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <nav aria-label="分类筛选" className="flex flex-wrap items-center gap-1">
            <Link
              href={filterHref({ q, sort: sort === "hot" ? "hot" : undefined })}
              className={!category ? filterLinkActiveClass : filterLinkClass}
            >
              全部
            </Link>
            {categories.map((c) => (
              <Link
                key={c}
                href={filterHref({
                  category: c,
                  q,
                  sort: sort === "hot" ? "hot" : undefined,
                })}
                className={c === category ? filterLinkActiveClass : filterLinkClass}
              >
                {c}
              </Link>
            ))}
          </nav>

          <div className="flex flex-wrap items-center gap-4">
            {/* 排序切换（链接式 Tab，与板块页同模式；保留 category / q） */}
            <nav aria-label="排序" className="flex items-center gap-1">
              <Link
                href={filterHref({ category, q })}
                aria-current={sort === "new" ? "true" : undefined}
                className={sort === "new" ? filterLinkActiveClass : filterLinkClass}
              >
                最新
              </Link>
              <Link
                href={filterHref({ category, q, sort: "hot" })}
                aria-current={sort === "hot" ? "true" : undefined}
                className={sort === "hot" ? filterLinkActiveClass : filterLinkClass}
              >
                最热
              </Link>
            </nav>

            <form action="/skills" method="get" className="flex items-center gap-2">
              {category && <input type="hidden" name="category" value={category} />}
              {sort === "hot" && <input type="hidden" name="sort" value="hot" />}
              <Input
                type="search"
                name="q"
                defaultValue={q ?? ""}
                placeholder="搜索 Skill 名称或简介"
                aria-label="搜索 Skill"
                className="w-60"
              />
              <Button type="submit" variant="outline">
                搜索
              </Button>
            </form>
          </div>
        </div>
      </section>

      {/* 主体：SkillCard 网格 / 空态 */}
      <section aria-label="Skill 列表" className="pb-10">
        {total > 0 ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {items.map((skill) => (
              <SkillCard
                key={skill.id}
                name={skill.name}
                description={skill.description}
                category={skill.category}
                slug={skill.slug}
              />
            ))}
          </div>
        ) : (
          <Card className="border border-dashed border-border bg-transparent ring-0">
            <CardContent className="flex w-full flex-col items-center gap-3 py-12">
              <p className="text-sm text-fg-muted">没有找到匹配的 Skill</p>
              {hasFilter && (
                <Link
                  href="/skills"
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
          basePath="/skills"
          searchParams={{
            category,
            q,
            sort: sort === "hot" ? "hot" : undefined,
          }}
        />
      </div>
    </main>
  );
}
