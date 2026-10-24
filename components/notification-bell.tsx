"use client";

import { Bell } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type MouseEvent, type ReactNode } from "react";
import { markNotificationRead } from "@/lib/actions/notifications";

/**
 * 通知铃铛 + 通知条目跳转链接（Phase 3 Task 2，client）。
 *
 * NotificationBell：
 * - 挂载 / 路由切换 / 60s 轮询 fetch /api/me/notifications-count
 *   （pathname 进 deps：软导航下 layout 组件不重挂载，靠路由变化
 *   及时刷新红点，E2E 点击通知跳源后无需等满 60s）
 * - 未登录（401）/ 探测中 → 渲染 null（探测中不闪铃铛，静默降级）
 * - unread>0 显示红点数字（>99 折叠 99+），点击链 /notifications
 *
 * NotificationLink（通知中心条目消费）：
 * - onClick 先 markNotificationRead 再 router.push（标读失败也照跳，
 *   通知中心页动态渲染不缓存，返回时列表自然刷新）
 * - link 为 null（源目标已删）→ 渲染纯文本，不可点
 */

export function NotificationBell() {
  const pathname = usePathname();
  // null = 探测中 / 未登录（渲染 null）；number = 已登录未读数
  const [unread, setUnread] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;

    const loadCount = () => {
      fetch("/api/me/notifications-count")
        .then(async (res) => {
          if (res.status === 401) {
            if (!cancelled) setUnread(null);
            return;
          }
          if (!res.ok) return; // 其他异常：保持当前值（静默降级）
          const data = (await res.json()) as { unread: number };
          if (!cancelled) setUnread(data.unread);
        })
        .catch(() => {
          // 网络失败：保持当前值，下个轮询周期自愈
        });
    };

    loadCount();
    const timer = setInterval(loadCount, 60_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [pathname]);

  if (unread === null) return null;

  return (
    <Link
      href="/notifications"
      aria-label={unread > 0 ? `通知，${unread} 条未读` : "通知"}
      data-notification-bell={unread > 0 ? "unread" : "none"}
      className="relative inline-flex items-center rounded-full p-2 text-fg-muted transition-colors hover:bg-accent-soft hover:text-accent-soft-fg"
    >
      <Bell className="size-4" aria-hidden="true" />
      {unread > 0 && (
        <span
          data-notification-count={unread}
          className="absolute -right-0.5 -top-0.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-medium leading-none text-white"
        >
          {unread > 99 ? "99+" : unread}
        </span>
      )}
    </Link>
  );
}

export type NotificationLinkProps = {
  /** 通知 id（点击标读用） */
  id: string;
  /** 解析出的源链接；null（源已删）时渲染纯文本 */
  link: string | null;
  children: ReactNode;
};

export function NotificationLink({ id, link, children }: NotificationLinkProps) {
  const router = useRouter();

  if (!link) {
    return <span className="block">{children}</span>;
  }

  async function handleClick(event: MouseEvent<HTMLAnchorElement>) {
    event.preventDefault();
    try {
      await markNotificationRead(id);
    } catch {
      // 标读失败不拦截跳转（下次进通知中心仍可标）
    } finally {
      // 嵌套函数内不保留外层收窄，push 前再判一次
      if (link) router.push(link);
    }
  }

  return (
    <a href={link} onClick={handleClick} data-notification-id={id}>
      {children}
    </a>
  );
}
