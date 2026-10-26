import { Suspense } from "react";
import { redirect } from "next/navigation";
import type { Session } from "next-auth";
import { auth } from "@/lib/auth";
import { listAdminData, listForumAdminData } from "@/lib/actions/admin";
import { AdminClient } from "./admin-client";

export const dynamic = "force-dynamic";

/**
 * 管理后台页面（Task 12，server 壳）。
 *
 * - auth()（读 cookies）必须位于 <Suspense>
 *   边界内的异步子组件（参照 upload 页模式）
 * - 无 session → redirect /login?returnUrl=/admin（middleware 已拦，
 *   此处兜底）；role!=="admin" → 渲染「无权限」提示页（不 redirect）
 * - listAdminData 非 ok（session 失效等）同样渲染无权限提示
 * - 行类型 AdminSkillRow / AdminCommentRow 见 lib/actions/admin.ts
 */

/** 无权限提示（已登录但非管理员；不跳转，保留当前 URL） */
function NoPermission() {
  return (
    <div className="flex flex-col items-center gap-3 py-24 text-center">
      <p className="font-serif-display text-2xl">无权限访问</p>
      <p className="text-sm leading-relaxed text-fg-muted">
        管理后台仅对管理员开放。如需管理权限，请联系站点管理员
        将你的账号提升为管理员。
      </p>
    </div>
  );
}

async function AdminGate() {
  let session: Session | null = null;
  try {
    session = await auth();
  } catch {
    session = null;
  }
  // database 策略 session.user 含 id（+ role，由 session callback 注入）
  const user = session?.user as { id?: string; role?: string } | undefined;
  if (!user?.id) {
    redirect("/login?returnUrl=/admin");
  }

  if (user?.role !== "admin") {
    return <NoPermission />;
  }

  // 两路数据并行取（论坛数据失败与 skills/comments 同按无权限处理）
  const [data, forumData] = await Promise.all([
    listAdminData(),
    listForumAdminData(),
  ]);
  if (!data.ok || !forumData.ok) {
    return <NoPermission />;
  }

  return (
    <AdminClient
      skills={data.data.skills}
      comments={data.data.comments}
      forums={forumData.data.forums}
      threads={forumData.data.threads}
    />
  );
}

/** 与管理台内容大致等高的占位（避免流式注入时布局跳动） */
function AdminFallback() {
  return <div className="h-[640px]" aria-hidden="true" />;
}

export default function AdminPage() {
  return (
    <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col px-4">
      <section className="flex flex-col gap-2 pb-8 pt-12">
        <h1 className="font-serif-display text-4xl">管理后台</h1>
        <p className="leading-relaxed text-fg-muted">
          管理 Skill 内容、评论与论坛的展示状态：下架的 Skill 不再出现在列表，
          隐藏的评论 / 帖子不再显示，论坛板块可新建、编辑与删除。
        </p>
      </section>

      <Suspense fallback={<AdminFallback />}>
        <AdminGate />
      </Suspense>
    </main>
  );
}
