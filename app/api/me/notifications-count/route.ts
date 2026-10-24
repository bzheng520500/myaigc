import { NextResponse } from "next/server";
import type { Session } from "next-auth";
import { auth } from "@/lib/auth";
import { getUnreadCount } from "@/lib/notify";

/**
 * GET /api/me/notifications-count
 *
 * 通知未读数（Phase 3 Task 2 接真数）：notifications.readAt is null 计数，
 * 供 NotificationBell 挂载 / 路由切换 / 60s 轮询拉取。
 *
 * 未登录 → 401 {error:"unauthorized"}（铃铛以此渲染 null）；
 * 已登录无库 / 探测失败 → getUnreadCount 内部兜底 0。
 */
export async function GET(): Promise<NextResponse> {
  let session: Session | null = null;
  try {
    session = await auth();
  } catch {
    session = null;
  }
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const unread = await getUnreadCount(userId);
  return NextResponse.json({ unread });
}
