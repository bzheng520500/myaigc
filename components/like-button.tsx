"use client";

import { Heart } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { toggleLike, type LikeTarget } from "@/lib/actions/interactions";

/**
 * 点赞按钮（Phase 3 Task 1）。
 *
 * - 挂载后 fetch /api/me/interactions 拉当前用户点赞态
 *   （401 = 未登录；失败保持服务端初值，静默降级）
 * - 点击：未登录跳 /login?returnUrl=；已登录乐观切换
 *   （数字 ±1、实心/空心心形）→ 调 toggleLike → 以响应为准修正；
 *   失败回滚（无提示静默 + console，与 CopyButton 同理不挂 toast）
 * - aria-pressed 暴露开关态给辅助技术与 E2E
 */

export type LikeButtonProps = {
  targetType: LikeTarget;
  targetId: string;
  initialCount: number;
};

export function LikeButton({
  targetType,
  targetId,
  initialCount,
}: LikeButtonProps) {
  const router = useRouter();
  const pathname = usePathname();
  // null = 挂载探测中；false = 未登录（点击跳登录）；true = 已登录
  const [loggedIn, setLoggedIn] = useState<boolean | null>(null);
  const [liked, setLiked] = useState(false);
  const [count, setCount] = useState(initialCount);

  useEffect(() => {
    let cancelled = false;
    fetch(
      `/api/me/interactions?targets=${encodeURIComponent(`${targetType}:${targetId}`)}`,
    )
      .then(async (res) => {
        if (res.status === 401) {
          if (!cancelled) setLoggedIn(false);
          return;
        }
        if (!res.ok) return; // 其他异常：保持服务端初值
        const data = (await res.json()) as { liked: string[] };
        if (!cancelled) {
          setLoggedIn(true);
          setLiked(data.liked.includes(targetId));
        }
      })
      .catch(() => {
        // 网络失败：保持初值（静默降级，点击时由 action 兜底）
      });
    return () => {
      cancelled = true;
    };
  }, [targetType, targetId]);

  async function handleClick() {
    if (loggedIn === false) {
      router.push(`/login?returnUrl=${encodeURIComponent(pathname)}`);
      return;
    }

    // 乐观切换：数字 ±1、实心/空心，以服务端响应为准修正
    const prevLiked = liked;
    const prevCount = count;
    const nextLiked = !liked;
    setLiked(nextLiked);
    setCount(nextLiked ? count + 1 : count - 1);

    try {
      const result = await toggleLike(targetType, targetId);
      if (result.ok) {
        setLiked(result.liked);
        setCount(result.count);
        return;
      }
      if (result.error === "unauthorized") {
        // 会话过期：跳登录重新认证
        router.push(`/login?returnUrl=${encodeURIComponent(pathname)}`);
      }
    } catch (error) {
      console.error("toggleLike failed:", error);
    }
    // 失败回滚（无提示静默）
    setLiked(prevLiked);
    setCount(prevCount);
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      aria-pressed={liked}
      aria-label={liked ? "取消点赞" : "点赞"}
      className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-xs text-fg-muted transition-colors hover:bg-accent-soft hover:text-accent-soft-fg aria-pressed:border-accent aria-pressed:text-accent"
    >
      <Heart
        aria-hidden="true"
        className={liked ? "size-4 fill-current" : "size-4"}
      />
      <span>{count}</span>
    </button>
  );
}
