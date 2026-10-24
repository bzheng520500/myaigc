import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { comments, users, verificationTokens } from "@/lib/db/schema";
import {
  isWithinWindow,
  recentCount,
  TOKENS_MAX_AGE_SEC,
  tokensExpiresFloor,
} from "@/lib/ratelimit";

/**
 * recentCount 限流计数（Task 4）
 *
 * - 窗口计算为纯逻辑：不依赖数据库，正常执行
 * - 连库计数：Neon 未就位（无 DATABASE_URL）时自动跳过，
 *   控制器统一 push 后设置 DATABASE_URL 即可执行
 */

/* ---------------------------------------------------------------- */
/* 纯逻辑：窗口判断                                                   */
/* ---------------------------------------------------------------- */

describe("isWithinWindow 通用窗口判断（纯逻辑）", () => {
  const now = new Date("2026-01-01T12:00:00Z");
  const sec = (n: number) => new Date(now.getTime() - n * 1000);

  it("59 秒前的时间戳落在 60s 窗口内", () => {
    expect(isWithinWindow(sec(59), now, 60)).toBe(true);
  });

  it("恰好 60 秒前（边界）落在 60s 窗口内（闭区间）", () => {
    expect(isWithinWindow(sec(60), now, 60)).toBe(true);
  });

  it("61 秒前的时间戳在 60s 窗口外", () => {
    expect(isWithinWindow(sec(61), now, 60)).toBe(false);
  });

  it("未来时间戳落在窗口内（容忍时钟偏移）", () => {
    expect(isWithinWindow(new Date(now.getTime() + 5000), now, 60)).toBe(true);
  });
});

/* ---------------------------------------------------------------- */
/* 纯逻辑：verificationToken 窗口阈值                                  */
/* ---------------------------------------------------------------- */

describe("tokensExpiresFloor tokens 表窗口阈值（纯逻辑）", () => {
  it("token 有效期 15 分钟、窗口 60s → 阈值 = now + 14 分钟", () => {
    expect(TOKENS_MAX_AGE_SEC).toBe(15 * 60);
    const now = new Date("2026-01-01T12:00:00Z");
    const floor = tokensExpiresFloor(now, 60);
    // 刚创建（≤60s 前）的 token：expires ≥ now + 14min → 计入窗口
    expect(floor.getTime()).toBe(now.getTime() + (15 * 60 - 60) * 1000);
  });

  it("用阈值可反推：窗口内创建的 token 会被计入", () => {
    const now = new Date();
    const floor = tokensExpiresFloor(now, 60);
    const createdJustNow = new Date(now.getTime() + TOKENS_MAX_AGE_SEC * 1000); // 刚创建 → expires = now+15min
    const createdTwoMinAgo = new Date(
      now.getTime() - 120_000 + TOKENS_MAX_AGE_SEC * 1000,
    ); // 2 分钟前创建 → expires = now+13min
    expect(createdJustNow.getTime()).toBeGreaterThanOrEqual(floor.getTime());
    expect(createdTwoMinAgo.getTime()).toBeLessThan(floor.getTime());
  });
});

/* ---------------------------------------------------------------- */
/* 连库计数：插真实记录断言窗口内数量                                    */
/* ---------------------------------------------------------------- */

describe.skipIf(!process.env.DATABASE_URL)("recentCount 连库计数", () => {
  it("comments：60s 窗口内 1 条、窗口外 1 条 → 计 1；放大窗口 → 计 2", async () => {
    const email = `ratelimit-test-${Date.now()}-${Math.random()
      .toString(36)
      .slice(2, 8)}@example.invalid`;
    const [user] = await db.insert(users).values({ email }).returning();
    expect(user).toBeDefined();
    const userId = user!.id;
    const now = Date.now();

    await db.insert(comments).values([
      {
        userId,
        targetType: "skill",
        targetId: crypto.randomUUID(),
        content: "窗口内（30s 前）",
        createdAt: new Date(now - 30_000),
      },
      {
        userId,
        targetType: "skill",
        targetId: crypto.randomUUID(),
        content: "窗口外（120s 前）",
        createdAt: new Date(now - 120_000),
      },
    ]);

    try {
      await expect(recentCount("comments", userId, 60)).resolves.toBe(1);
      await expect(recentCount("comments", userId, 180)).resolves.toBe(2);
      await expect(recentCount("comments", userId, 10)).resolves.toBe(0);
    } finally {
      // comments.user_id 外键无 onDelete cascade，必须先删子表再删 users，否则 FK violation
      await db.delete(comments).where(eq(comments.userId, userId));
      await db.delete(users).where(eq(users.id, userId));
    }
  });

  it("tokens：identifier 命中且 token 刚创建 → 计 1；过期 token 不计", async () => {
    const email = `ratelimit-test-${Date.now()}-${Math.random()
      .toString(36)
      .slice(2, 8)}@example.invalid`;
    const now = Date.now();

    await db.insert(verificationTokens).values([
      {
        identifier: email,
        token: "fresh-token",
        expires: new Date(now + TOKENS_MAX_AGE_SEC * 1000), // 刚创建（15 分钟有效期）
      },
      {
        identifier: email,
        token: "stale-token",
        expires: new Date(now + TOKENS_MAX_AGE_SEC * 1000 - 180_000), // 3 分钟前创建 → 已在 60s 窗口外
      },
    ]);

    try {
      await expect(recentCount("tokens", email, 60)).resolves.toBe(1);
      // 不存在的邮箱 → 0
      await expect(recentCount("tokens", "nobody@example.invalid", 60)).resolves.toBe(0);
    } finally {
      await db
        .delete(verificationTokens)
        .where(eq(verificationTokens.identifier, email));
    }
  });

  it("threads / replies：其他用户不串号", async () => {
    const email = `ratelimit-test-${Date.now()}-${Math.random()
      .toString(36)
      .slice(2, 8)}@example.invalid`;
    const [user] = await db.insert(users).values({ email }).returning();
    const userId = user!.id;

    try {
      await expect(recentCount("threads", userId, 60)).resolves.toBe(0);
      await expect(recentCount("replies", userId, 60)).resolves.toBe(0);
    } finally {
      await db.delete(users).where(eq(users.id, userId));
    }
  });
});
