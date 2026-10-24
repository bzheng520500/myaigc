import { Suspense } from "react";
import { redirect } from "next/navigation";
import type { Session } from "next-auth";
import { auth } from "@/lib/auth";
import { listForums } from "@/lib/queries/forum";
import { NewThreadForm } from "./new-thread-form";

/**
 * 发帖页（Phase 2 Task 3，server 壳）。
 *
 * - middleware 已拦截 /forum/new（302 登录页），此处 auth() 守卫是
 *   页面层双保险（cacheComponents 下 auth() 读 cookies，必须位于
 *   <Suspense> 边界内的异步子组件，参照 app/upload/page.tsx）
 * - searchParams ?forum= 预选板块（同样在 Suspense 内 await）
 * - 板块列表来自 listForums()：无库 / 空列表时不 fallback 固定板块
 *   （论坛本身不可用），直接渲染提示文案
 */

type NewThreadPageProps = {
  searchParams: Promise<{ forum?: string | string[] | undefined }>;
};

async function NewThreadGate({ searchParams }: NewThreadPageProps) {
  const sp = await searchParams;
  const preselect = Array.isArray(sp.forum) ? sp.forum[0] : sp.forum;

  let session: Session | null = null;
  try {
    session = await auth();
  } catch {
    session = null;
  }
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) {
    redirect("/login?returnUrl=/forum/new");
  }

  const forums = await listForums();
  if (forums.length === 0) {
    return (
      <p className="pb-16 leading-relaxed text-fg-muted">
        论坛板块暂时不可用，请稍后再试。
      </p>
    );
  }

  return (
    <NewThreadForm
      forums={forums.map((f) => ({ slug: f.slug, name: f.name }))}
      preselectSlug={preselect}
    />
  );
}

/** 与表单大致等高的占位（避免流式注入时布局跳动，与上传页同模式） */
function NewThreadFallback() {
  return <div className="h-[640px]" aria-hidden="true" />;
}

export default function NewThreadPage(props: NewThreadPageProps) {
  return (
    <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col px-4">
      <section className="flex flex-col gap-2 pb-8 pt-12">
        <h1 className="font-serif-display text-4xl">发起讨论</h1>
        <p className="leading-relaxed text-fg-muted">
          选择板块、拟好标题，用 Markdown 写下你的想法；
          右侧实时预览发布效果。
        </p>
      </section>

      <Suspense fallback={<NewThreadFallback />}>
        <NewThreadGate searchParams={props.searchParams} />
      </Suspense>
    </main>
  );
}
