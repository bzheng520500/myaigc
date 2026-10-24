import Link from "next/link";
import { Suspense } from "react";
import { auth, signOut } from "@/lib/auth";

/**
 * 全站页头（Task 5）。
 *
 * - sticky + 毛玻璃：backdrop-blur + 半透明米白底 + 底边框
 * - 登录态：auth() 读取 session（request-time API）。本项目开启
 *   cacheComponents，读 headers/cookies 的调用必须位于 <Suspense>
 *   边界内的子组件，auth() 异常时按未登录渲染（无库/无 session
 *   环境可构建、可渲染）
 * - 右区 NotificationBellSlot：Phase 3 通知铃铛占位
 */

const NAV_ITEMS = [
  { label: "Skill库", href: "/skills" },
  { label: "提示词库", href: "/prompts" },
  { label: "教程", href: "/tutorials" },
  { label: "论坛", href: "/forum" },
] as const;

/** Phase 3 替换为真实通知组件 */
export function NotificationBellSlot() {
  return null;
}

async function signOutAction() {
  "use server";
  await signOut({ redirectTo: "/" });
}

/** 邮箱前缀作为展示用户名（schema 注释：name 默认取邮箱前缀） */
function emailPrefix(email: string | null | undefined): string | null {
  if (!email) return null;
  return email.split("@")[0] || null;
}

async function HeaderAuthArea() {
  let session = null;
  try {
    session = await auth();
  } catch {
    session = null;
  }

  const userName = emailPrefix(session?.user?.email);

  return (
    <div className="flex items-center gap-3 text-sm">
      {userName ? (
        <>
          <span
            className="max-w-32 truncate text-fg-muted"
            title={session?.user?.email ?? undefined}
          >
            {userName}
          </span>
          <form action={signOutAction}>
            <button
              type="submit"
              className="transition-colors hover:text-accent-soft-fg"
            >
              退出
            </button>
          </form>
        </>
      ) : (
        <Link
          href="/login"
          className="transition-colors hover:text-accent-soft-fg"
        >
          登录
        </Link>
      )}
    </div>
  );
}

/** 与 HeaderAuthArea 渲染内容等高的占位（避免流式注入时布局跳动） */
function HeaderAuthFallback() {
  return (
    <div className="flex min-w-16 items-center text-sm" aria-hidden="true" />
  );
}

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 border-b border-border bg-[var(--bg)]/80 backdrop-blur-md">
      <div className="mx-auto flex h-14 w-full max-w-5xl items-center justify-between gap-4 px-4">
        <Link
          href="/"
          className="font-serif-display text-lg leading-none tracking-tight"
        >
          AI影视工坊
        </Link>

        <nav aria-label="主导航">
          <ul className="flex items-center gap-1 text-sm">
            {NAV_ITEMS.map((item) => (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className="rounded-full px-3 py-1.5 text-fg-muted transition-colors hover:bg-accent-soft hover:text-accent-soft-fg"
                >
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>

        <div className="flex items-center gap-2">
          <NotificationBellSlot />
          <Suspense fallback={<HeaderAuthFallback />}>
            <HeaderAuthArea />
          </Suspense>
        </div>
      </div>
    </header>
  );
}
