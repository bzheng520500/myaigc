import { Suspense } from "react";
import { redirect } from "next/navigation";
import type { Session } from "next-auth";
import { auth } from "@/lib/auth";
import { SKILL_TEMPLATE } from "@/lib/frontmatter";
import { UploadForm } from "./upload-form";

/**
 * 上传页（Task 11，server 壳）。
 *
 * - cacheComponents 下 auth()（读 cookies）必须位于 <Suspense>
 *   边界内的异步子组件（参照 site-header / skill 详情页模式），
 *   读 session 即请求时执行，无需显式缓存指令
 * - 未登录 → redirect /login?returnUrl=/upload（Review Focus #5）
 * - SKILL_TEMPLATE 由 server 端解析后以 initialValue 传入 client
 *   表单（模板在 lib/frontmatter.ts，其 gray-matter 依赖不进
 *   client bundle）
 */

async function UploadGate() {
  let session: Session | null = null;
  try {
    session = await auth();
  } catch {
    session = null;
  }
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) {
    redirect("/login?returnUrl=/upload");
  }

  return <UploadForm initialValue={SKILL_TEMPLATE} />;
}

/** 与表单大致等高的占位（避免流式注入时布局跳动） */
function UploadFallback() {
  return <div className="h-[640px]" aria-hidden="true" />;
}

export default function UploadPage() {
  return (
    <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col px-4">
      <section className="flex flex-col gap-2 pb-8 pt-12">
        <h1 className="font-serif-display text-4xl">上传 Skill</h1>
        <p className="leading-relaxed text-fg-muted">
          分享你的可复用技能文档：文件开头需用 --- 包裹 name 与
          description，正文支持 Markdown；可直接导入 .md 文件，
          右侧实时预览发布效果。
        </p>
      </section>

      <Suspense fallback={<UploadFallback />}>
        <UploadGate />
      </Suspense>
    </main>
  );
}
