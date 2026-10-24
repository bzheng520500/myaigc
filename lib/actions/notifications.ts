"use server";

import type { Session } from "next-auth";
import { auth } from "@/lib/auth";
import { markAllReadForUser, markRead } from "@/lib/notify";

/**
 * 通知 server actions（Phase 3 Task 2）。
 *
 * - markNotificationRead(id)：通知中心条目点击时先标读再跳源
 *   （components/notification-bell.tsx 的 NotificationLink 消费）
 * - markAllRead()：「全部已读」表单按钮（app/notifications/page.tsx
 *   form action 消费，提交后 Next 自动重渲染当前路由）
 *
 * 底层校验（本人匹配 / 未读才标）在 lib/notify.ts 的 markRead /
 * markAllReadForUser；action 层只做登录判定。页面为动态渲染
 * （auth() 读 cookies），无需 revalidatePath。
 */

/** 登录态：auth() 抛错（无请求上下文）按未登录处理（与 forum.ts 同模式） */
async function currentUserId(): Promise<string | null> {
  let session: Session | null = null;
  try {
    session = await auth();
  } catch {
    session = null;
  }
  return (session?.user as { id?: string } | undefined)?.id ?? null;
}

export async function markNotificationRead(id: string): Promise<boolean> {
  const userId = await currentUserId();
  if (!userId) return false;
  return markRead(id, userId);
}

export async function markAllRead(): Promise<void> {
  const userId = await currentUserId();
  if (!userId) return;
  await markAllReadForUser(userId);
}
