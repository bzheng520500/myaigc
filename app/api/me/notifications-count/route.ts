import { NextResponse } from "next/server";
import type { Session } from "next-auth";
import { auth } from "@/lib/auth";

/**
 * GET /api/me/notifications-count
 *
 * 通知未读数占位（Phase 3 Task 1）：本任务先返回 { unread: 0 }，
 * T2 通知表实装后接真实未读数（notifications.readAt is null 计数）。
 *
 * 未登录 → 401 {error:"unauthorized"}（与 /api/me/interactions 同语义）。
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

  // TODO(T2 通知)：替换为 notifications 表未读数（readAt 为空的行数）
  return NextResponse.json({ unread: 0 });
}
