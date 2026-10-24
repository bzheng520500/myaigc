"use client";

import { Star } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
  toggleFavorite,
  type FavoriteTarget,
} from "@/lib/actions/interactions";

/**
 * 收藏按钮（Phase 3 Task 1）：与 LikeButton 同模式，无计数显示。
 *
 * - 挂载后 fetch /api/me/interactions 拉当前用户收藏态
 * - 点击：未登录跳 /login?returnUrl=；已登录乐观切换
 *   （星形实心/空心）→ 调 toggleFavorite → 以响应为准修正；失败回滚
 * - aria-pressed 暴露开关态
 */

export type FavoriteButtonProps = {
  targetType: FavoriteTarget;
  targetId: string;
};

export function FavoriteButton({
  targetType,
  targetId,
}: FavoriteButtonProps) {
  const router = useRouter();
  const pathname = usePathname();
  // null = 挂载探测中；false = 未登录（点击跳登录）；true = 已登录
  const [loggedIn, setLoggedIn] = useState<boolean | null>(null);
  const [favorited, setFavorited] = useState(false);

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
        if (!res.ok) return;
        const data = (await res.json()) as { favorited: string[] };
        if (!cancelled) {
          setLoggedIn(true);
          setFavorited(data.favorited.includes(targetId));
        }
      })
      .catch(() => {
        // 网络失败：保持初值（静默降级）
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

    // 乐观切换：星形实心/空心，以服务端响应为准修正
    const prevFavorited = favorited;
    setFavorited(!favorited);

    try {
      const result = await toggleFavorite(targetType, targetId);
      if (result.ok) {
        setFavorited(result.favorited);
        return;
      }
      if (result.error === "unauthorized") {
        router.push(`/login?returnUrl=${encodeURIComponent(pathname)}`);
      }
    } catch (error) {
      console.error("toggleFavorite failed:", error);
    }
    // 失败回滚（无提示静默）
    setFavorited(prevFavorited);
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      aria-pressed={favorited}
      aria-label={favorited ? "取消收藏" : "收藏"}
      className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-xs text-fg-muted transition-colors hover:bg-accent-soft hover:text-accent-soft-fg aria-pressed:border-accent aria-pressed:text-accent"
    >
      <Star
        aria-hidden="true"
        className={favorited ? "size-4 fill-current" : "size-4"}
      />
      <span>{favorited ? "已收藏" : "收藏"}</span>
    </button>
  );
}
