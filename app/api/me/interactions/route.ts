import { NextResponse } from "next/server";
import type { Session } from "next-auth";
import { getMyInteractions } from "@/lib/actions/interactions";
import { auth } from "@/lib/auth";

/**
 * GET /api/me/interactions?targets=thread:uuid,skill:uuid
 *
 * 个性化状态批量回查（Phase 3 Task 1）：返回当前用户在给定目标中
 * 已赞 / 已藏的 id 子集，供 LikeButton / FavoriteButton 挂载后拉取初始态
 * （server action 无法批量查询，走 route handler）。
 *
 * - 未登录 → 401 {error:"unauthorized"}（Review Focus #3，
 *   客户端以此区分「跳登录」与「显示服务端初值」）
 * - targets 逗号分隔，getMyInteractions 内做 ≤100 截断与非法项跳过
 */
export async function GET(request: Request): Promise<NextResponse> {
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

  const raw = new URL(request.url).searchParams.get("targets") ?? "";
  const targets = raw
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

  const { liked, favorited } = await getMyInteractions(targets);
  return NextResponse.json({ liked, favorited });
}
