import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { after } from "next/server";
import { Suspense } from "react";
import { CommentSection } from "@/components/comment-section";
import { CopyButton, DownloadButton } from "@/components/copy-button";
import MarkdownView from "@/components/markdown-view";
import { Badge } from "@/components/ui/badge";
import { listComments } from "@/lib/actions/comments";
import {
  incrementSkillCopy,
  incrementSkillView,
} from "@/lib/actions/skill-interactions";
import { auth } from "@/lib/auth";
import { stripFrontmatter } from "@/lib/markdown";
import { getSkillBySlug } from "@/lib/queries/skills";

/**
 * Skill 详情页（Task 7）。
 *
 * - ISR 300s：由 getSkillBySlug 的 "use cache" + cacheLife 承载
 *   （cacheComponents 模式，项目无 export const revalidate）
 * - 正文经 MarkdownView 白名单消毒渲染（全站 XSS 防线）
 * - 浏览计数：after() 在响应结束后 fire-and-forget，不阻塞渲染
 */

type SkillDetailPageProps = {
  params: Promise<{ slug: string }>;
};

/**
 * 评论区服务端壳（Task 10）：auth() 与评论预取是请求个性化数据，
 * 必须留在 "use cache" 函数之外——挂在 Suspense 内的异步子组件里
 * （cacheComponents 下读 cookies 的调用需在 Suspense 边界内，参照 site-header）。
 */
async function SkillCommentArea({ skillId }: { skillId: string }) {
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

  const comments = await listComments("skill", skillId);

  return (
    <CommentSection
      targetType="skill"
      targetId={skillId}
      initialComments={comments}
      currentUserName={currentUserName}
    />
  );
}

/** 与评论区大致等高的占位（避免流式注入时布局跳动） */
function CommentAreaFallback() {
  return <div className="h-48" aria-hidden="true" />;
}

/** 中文日期格式化：2026年10月24日 */
const zhDate = new Intl.DateTimeFormat("zh-CN", {
  year: "numeric",
  month: "long",
  day: "numeric",
});

export async function generateMetadata({
  params,
}: SkillDetailPageProps): Promise<Metadata> {
  const { slug } = await params;
  const skill = await getSkillBySlug(slug);
  if (!skill) {
    return { title: "Skill 不存在" };
  }
  return { title: skill.name, description: skill.description ?? undefined };
}

export default function SkillDetailPage(props: SkillDetailPageProps) {
  // cacheComponents 下 await params 必须在 <Suspense> 内（Task 14 fix）
  return (
    <Suspense fallback={<main className="mx-auto w-full max-w-3xl flex-1" aria-busy="true" />}>
      <SkillDetailContent {...props} />
    </Suspense>
  );
}

async function SkillDetailContent({ params }: SkillDetailPageProps) {
  const { slug } = await params;
  const skill = await getSkillBySlug(slug);
  if (!skill) notFound();

  // 浏览计数：响应结束后执行，避免未 await promise 告警
  after(() => incrementSkillView(slug));

  // 剥离 frontmatter：正文单独渲染，元信息消费解析结果做兜底
  const { frontmatter, content } = stripFrontmatter(skill.contentMd);
  const fmDescription =
    typeof frontmatter.description === "string" ? frontmatter.description : null;
  const description = skill.description ?? fmDescription;
  const sourceLabel = skill.source === "user" ? "社区投稿" : "官方收录";

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col px-4">
      {/* 元信息头 */}
      <header className="flex flex-col gap-4 pb-8 pt-12">
        <h1 className="font-serif-display text-4xl">{skill.name}</h1>
        {description && <p className="leading-relaxed text-fg-muted">{description}</p>}

        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-fg-muted">
          <Badge variant="secondary">{skill.category}</Badge>
          <span>{sourceLabel}</span>
          <span aria-hidden="true">·</span>
          <span>{skill.viewCount} 次浏览</span>
          <span aria-hidden="true">·</span>
          <time dateTime={skill.updatedAt.toISOString()}>
            更新于 {zhDate.format(skill.updatedAt)}
          </time>
        </div>

        {/* 操作行：复制全文（计数上报）/ 下载 .md */}
        <div className="flex items-center gap-2">
          <CopyButton
            text={skill.contentMd}
            label="复制全文"
            reportCopy={incrementSkillCopy.bind(null, slug)}
          />
          <DownloadButton
            text={skill.contentMd}
            filename={`${skill.slug}.md`}
          />
        </div>
      </header>

      {/* 正文：MarkdownView 内部经 rehype-sanitize 消毒 */}
      <article className="pb-12">
        <MarkdownView content={content} />
      </article>

      {/* 评论区：个性化数据在 Suspense 子组件内取，不卷进 ISR 缓存（T10） */}
      <Suspense fallback={<CommentAreaFallback />}>
        <SkillCommentArea skillId={skill.id} />
      </Suspense>
    </main>
  );
}
