import { and, count, eq, gte } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  comments,
  replies,
  threads,
  verificationTokens,
} from "@/lib/db/schema";

/**
 * 通用限流计数（Task 4）
 *
 * recentCount 统计「窗口秒数内」某用户（或邮箱）在某张表中的记录数，
 * 供魔法链接发送频控（tokens 表）与后续评论 / 发帖频控复用。
 *
 * 表名 → 查询映射：
 * - comments / threads / replies：按 user_id 列 + created_at 时间窗计数
 * - tokens（verificationToken 表）：该表无 created_at 列，只有 expires；
 *   token 创建时 expires = 创建时刻 + TOKENS_MAX_AGE_SEC（15 分钟），
 *   因此「windowSec 秒内创建过」⟺「expires ≥ now + (TOKENS_MAX_AGE_SEC − windowSec)」。
 *   TOKENS_MAX_AGE_SEC 必须与 lib/auth.ts 中 Email provider 的 maxAge 保持一致。
 */

/** 魔法链接 token 有效期（秒），与 lib/auth.ts Email provider maxAge 一致 */
export const TOKENS_MAX_AGE_SEC = 15 * 60;

/** recentCount 支持的表名 */
export type RateLimitTable = "comments" | "threads" | "replies" | "tokens";

/**
 * 纯逻辑：timestamp 是否落在「以 now 为终点、往前 windowSec 秒」的窗口内（闭区间）。
 * 未来时间戳视为窗口内（容忍时钟偏移）。
 */
export function isWithinWindow(
  timestamp: Date,
  now: Date,
  windowSec: number,
): boolean {
  return timestamp.getTime() >= now.getTime() - windowSec * 1000;
}

/**
 * 纯逻辑：verificationToken 表按 expires 反推创建窗口的判断阈值。
 * expires ≥ floor ⟺ 创建时刻在 windowSec 窗口内。
 */
export function tokensExpiresFloor(now: Date, windowSec: number): Date {
  return new Date(now.getTime() + (TOKENS_MAX_AGE_SEC - windowSec) * 1000);
}

/**
 * 统计 windowSec 秒窗口内的记录数。
 *
 * @param table 表名（见 RateLimitTable）
 * @param userIdOrEmail comments/threads/replies 传用户 id；tokens 传邮箱（identifier）
 * @param windowSec 窗口秒数
 */
export async function recentCount(
  table: RateLimitTable,
  userIdOrEmail: string,
  windowSec: number,
): Promise<number> {
  const now = new Date();
  const since = new Date(now.getTime() - windowSec * 1000);

  switch (table) {
    case "comments": {
      const [row] = await db
        .select({ n: count() })
        .from(comments)
        .where(and(eq(comments.userId, userIdOrEmail), gte(comments.createdAt, since)));
      return Number(row?.n ?? 0);
    }
    case "threads": {
      const [row] = await db
        .select({ n: count() })
        .from(threads)
        .where(and(eq(threads.authorId, userIdOrEmail), gte(threads.createdAt, since)));
      return Number(row?.n ?? 0);
    }
    case "replies": {
      const [row] = await db
        .select({ n: count() })
        .from(replies)
        .where(and(eq(replies.authorId, userIdOrEmail), gte(replies.createdAt, since)));
      return Number(row?.n ?? 0);
    }
    case "tokens": {
      const [row] = await db
        .select({ n: count() })
        .from(verificationTokens)
        .where(
          and(
            eq(verificationTokens.identifier, userIdOrEmail),
            gte(verificationTokens.expires, tokensExpiresFloor(now, windowSec)),
          ),
        );
      return Number(row?.n ?? 0);
    }
    default: {
      // 穷尽性保护（TS 层面 default 分支不可达）
      const exhausted: never = table;
      throw new Error(`recentCount: 未知表名 ${String(exhausted)}`);
    }
  }
}
