import Link from "next/link";
import { Suspense } from "react";
import { auth, signOut } from "@/lib/auth";
import { NotificationBell } from "@/components/notification-bell";

/**
 * 全站页头（Task 5）。
 *
 * - sticky + 毛玻璃：backdrop-blur + 半透明米白底 + 底边框
 * - 登录态：auth() 读取 session（request-time API）。本项目开启
 *   cacheComponents，读 headers/cookies 的调用必须位于 <Suspense>
 *   边界内的子组件，auth() 异常时按未登录渲染（无库/无 session
 *   环境可构建、可渲染）
 * - 右区 NotificationBell：Phase 3 Task 2 通知铃铛（client 组件，
 *   自行轮询 /api/me/notifications-count，未登录渲染 null）
 */

const NAV_ITEMS = [
  { label: "Skill库", href: "/skills" },
  { label: "提示词库", href: "/prompts" },
  { label: "教程", href: "/tutorials" },
  { label: "论坛", href: "/forum" },
] as const;

/** Phase 3 Task 2：真实通知铃铛（保留 Slot 名，页头结构不变）。
 *  usePathname() 是动态值，cacheComponents 预渲染要求 <Suspense> 边界（Phase 3 波次末修复）。 */
export function NotificationBellSlot() {
  return (
    <Suspense fallback={null}>
      <NotificationBell />
    </Suspense>
  );
}

async function signOutAction() {
  "use server";
  await signOut({ redirectTo: "/" });
}

/** 邮箱前缀作为展示用户名兜底（schema 注释：name 默认取邮箱前缀） */
function emailPrefix(email: string | null | undefined): string | null {
  if (!email) return null;
  return email.split("@")[0] || null;
}

const USER_MENU_ITEM =
  "block w-full px-3 py-2 text-left text-sm text-fg-muted transition-colors hover:bg-accent-soft hover:text-accent-soft-fg";

/**
 * 登录用户菜单：hover 触发的纯 CSS 下拉（group-hover + focus-within）。
 *
 * 用 hover 而非 details/summary 的点击：鼠标移入显示、移出消失。
 * 保留 focus-within 让键盘 Tab 也能进入菜单（无障碍）。
 * 菜单与触发按钮同属一个 group 容器，两者之间用 pt-1 的透明间隙衔接，
 * 避免鼠标从名字移到菜单的途中因空隙而收起。
 * 「退出」保留 form + server action signOut。
 */
function UserMenu({ userName, userId }: { userName: string; userId: string }) {
  return (
    <div className="group relative">
      <button
        type="button"
        className="flex cursor-pointer items-center gap-1 rounded-full px-2 py-1 text-fg-muted transition-colors group-hover:bg-accent-soft group-hover:text-accent-soft-fg focus-within:bg-accent-soft"
        aria-haspopup="menu"
      >
        <span className="max-w-32 truncate">{userName}</span>
        <span className="text-xs" aria-hidden="true">
          ▾
        </span>
      </button>
      <div className="pointer-events-none invisible absolute right-0 top-full z-50 w-40 pt-1 opacity-0 transition-opacity group-hover:pointer-events-auto group-hover:visible group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:visible group-focus-within:opacity-100">
        <div className="rounded-lg border border-border bg-[var(--bg)] py-1 shadow-md">
          <Link href={`/u/${userId}`} className={USER_MENU_ITEM}>
            个人主页
          </Link>
          <Link href="/settings" className={USER_MENU_ITEM}>
            设置
          </Link>
          <form action={signOutAction}>
            <button type="submit" className={USER_MENU_ITEM}>
              退出
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}

async function HeaderAuthArea() {
  let session = null;
  try {
    session = await auth();
  } catch {
    session = null;
  }

  // session callback（lib/auth.ts）已注入 user.id；name 为 Auth.js
  // 默认回填（users 表 name 列，默认邮箱前缀），email 前缀兜底
  const userName =
    session?.user?.name ?? emailPrefix(session?.user?.email);
  const userId = session?.user?.id;

  return (
    <div className="flex items-center gap-3 text-sm">
      {userName && userId ? (
        <UserMenu userName={userName} userId={userId} />
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
