import Link from "next/link";
import type { ReactNode } from "react";
import { SkillCard } from "@/components/skill-card";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getHomeData } from "@/lib/queries/home";

/**
 * 首页（Task 5）：Hero → 四格统计 → 三入口 → 精选 Skill → 最新上传 → 论坛占位。
 *
 * 缓存：next.config.ts 开启 cacheComponents（Next.js 16 已移除
 * `export const revalidate` 段配置），ISR 语义由 getHomeData 的
 * "use cache" + cacheLife（revalidate = REVALIDATE_CONTENT）承载。
 */

const CATEGORY_ENTRIES = [
  {
    title: "Skill 库",
    description: "从故事创作到后期包装的可复用技能文档",
    href: "/skills",
  },
  {
    title: "提示词库",
    description: "基础运镜到电影级组合的即拷即用提示词",
    href: "/prompts",
  },
  {
    title: "教程",
    description: "跟着案例学会每一个镜头的语言与节奏",
    href: "/tutorials",
  },
] as const;

function StatCell({ value, label }: { value: number; label: string }) {
  return (
    <div className="flex flex-col items-center gap-1 rounded-xl border border-border bg-card px-4 py-5">
      <span className="font-serif-display text-3xl leading-none">{value}</span>
      <span className="text-sm text-fg-muted">{label}</span>
    </div>
  );
}

function SkillCardGrid({ children }: { children: ReactNode }) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {children}
    </div>
  );
}

/** 空态占位卡：横跨整行 */
function EmptyPlaceholder({ text }: { text: string }) {
  return (
    <Card className="col-span-full items-center border border-dashed border-border bg-transparent ring-0">
      <CardContent className="flex w-full items-center justify-center py-8">
        <p className="text-sm text-fg-muted">{text}</p>
      </CardContent>
    </Card>
  );
}

function SectionHeading({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="mb-4 flex items-end justify-between gap-4">
      <h2 className="font-serif-display text-2xl">{title}</h2>
      {hint && <span className="text-sm text-fg-muted">{hint}</span>}
    </div>
  );
}

export default async function Home() {
  const { stats, featured, latest } = await getHomeData();

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col px-4">
      {/* Hero */}
      <section className="flex flex-col items-center gap-6 py-20 text-center sm:py-28">
        <h1 className="font-serif-display text-5xl">AI影视工坊</h1>
        <p className="max-w-2xl text-lg leading-relaxed text-fg-muted">
          AI 影视制作学习社区 —— 从故事创作到镜头语言，一站式技能与提示词库
        </p>
        <div className="flex flex-col gap-3 sm:flex-row">
          <Link
            href="/skills"
            className={buttonVariants({
              variant: "default",
              size: "lg",
              className: "h-11 px-7 text-base",
            })}
          >
            浏览 Skill 库
          </Link>
          <Link
            href="/upload"
            className={buttonVariants({
              variant: "outline",
              size: "lg",
              className: "h-11 px-7 text-base",
            })}
          >
            上传我的 Skill
          </Link>
        </div>
      </section>

      {/* 四格统计 */}
      <section aria-label="站点统计" className="pb-16">
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <StatCell value={stats.skills} label="Skill 数" />
          <StatCell value={stats.prompts} label="提示词数" />
          <StatCell value={stats.tutorials} label="教程数" />
          <StatCell value={stats.threads} label="社区帖子" />
        </div>
      </section>

      {/* 三入口 */}
      <section className="pb-16">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          {CATEGORY_ENTRIES.map((entry) => (
            <Card key={entry.href} className="group relative gap-2">
              <CardHeader>
                <CardTitle className="font-serif-display text-lg">
                  {entry.title}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm leading-relaxed text-fg-muted">
                  {entry.description}
                </p>
                <span className="mt-3 inline-block text-sm text-accent-soft-fg transition-transform group-hover:translate-x-0.5">
                  进入 →
                </span>
              </CardContent>
              <Link
                href={entry.href}
                aria-label={`进入${entry.title}`}
                className="absolute inset-0 rounded-xl"
              >
                <span className="sr-only">{entry.title}</span>
              </Link>
            </Card>
          ))}
        </div>
      </section>

      {/* 精选 Skill */}
      <section className="pb-16">
        <SectionHeading title="精选 Skill" hint="按浏览量排序" />
        <SkillCardGrid>
          {featured.length > 0 ? (
            featured.map((skill) => (
              <SkillCard
                key={skill.slug}
                name={skill.name}
                description={skill.description}
                category={skill.category}
                slug={skill.slug}
              />
            ))
          ) : (
            <EmptyPlaceholder text="内容即将上线，敬请期待" />
          )}
        </SkillCardGrid>
      </section>

      {/* 最新上传（空库时隐藏整块） */}
      {latest.length > 0 && (
        <section className="pb-16">
          <SectionHeading title="最新上传" hint="按发布时间排序" />
          <SkillCardGrid>
            {latest.map((skill) => (
              <SkillCard
                key={skill.slug}
                name={skill.name}
                description={skill.description}
                category={skill.category}
                slug={skill.slug}
              />
            ))}
          </SkillCardGrid>
        </section>
      )}

      {/* 论坛热帖（Phase 4 接入真实数据，本期占位） */}
      <section className="pb-20">
        <SectionHeading title="论坛热帖" />
        <Card className="border border-dashed border-border bg-transparent ring-0">
          <CardHeader>
            <CardTitle className="text-base text-fg-muted">
              论坛即将开放
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm leading-relaxed text-fg-muted">
              社区讨论功能正在建设中，上线后这里将展示最热的话题与作品交流帖。
            </p>
          </CardContent>
        </Card>
      </section>
    </main>
  );
}
