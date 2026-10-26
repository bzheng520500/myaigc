import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import type { Session } from "next-auth";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { SettingsForm } from "./settings-form";

export const dynamic = "force-dynamic";

/**
 * 个人设置页（Phase 3 Task 3，server 壳）。
 *
 * - middleware 已拦截 /settings（302 登录页），页面层 auth() 守卫
 *   是双保险（auth() 读 cookies 必须位于
 *   <Suspense> 内的异步子组件，参照 app/upload/page.tsx）
 * - 表单初值从 users 表现查（database session 只回填部分字段，
 *   现查保证 notifyEmail 等业务字段拿得到最新值）
 */

async function SettingsGate() {
  let session: Session | null = null;
  try {
    session = await auth();
  } catch {
    session = null;
  }
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) {
    redirect("/login?returnUrl=/settings");
  }

  const [user] = await db
    .select({
      name: users.name,
      image: users.image,
      notifyEmail: users.notifyEmail,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  return (
    <SettingsForm
      initial={user ?? { name: null, image: null, notifyEmail: true }}
    />
  );
}

/** 与表单大致等高的占位（避免流式注入时布局跳动） */
function SettingsFallback() {
  return <div className="h-80" aria-hidden="true" />;
}

export default function SettingsPage() {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col px-4">
      <section className="flex flex-col gap-2 pb-8 pt-12">
        <h1 className="font-serif-display text-4xl">个人设置</h1>
        <p className="leading-relaxed text-fg-muted">
          管理你的公开资料与通知偏好。
        </p>
      </section>

      <Suspense fallback={<SettingsFallback />}>
        <SettingsGate />
      </Suspense>
    </main>
  );
}
