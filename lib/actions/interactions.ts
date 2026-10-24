"use server";

import { and, eq, inArray, sql } from "drizzle-orm";
import type { Session } from "next-auth";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { comments, favorites, likes, replies, skills, threads } from "@/lib/db/schema";

/**
 * 点赞 / 收藏 server actions + 个性化状态查询（Phase 3 Task 1）。
 *
 * - toggleLike：insert onConflictDoNothing returning 判定新赞/已赞——
 *   有返回行 = 新点赞（like_count+1）；无返回行 = 已赞 → 删除并 -1。
 *   快速双击竞态（Review Focus #1）：likes_user_target_unique 唯一约束
 *   保证并发下只有一方 insert 返回行（只 +1 一次），另一方必然走删除分支。
 * - toggleFavorite：同法（skill/thread 两类目标，favorites 无计数列）。
 * - getMyInteractions：批量回查当前用户已赞/已藏的 id 子集，
 *   供 /api/me/interactions 路由给按钮组件挂载拉取初始状态。
 *
 * auth() 无请求上下文时抛错，按未登录处理（与 upload.ts / comments.ts 同模式）。
 * 不调 revalidatePath：点赞计数展示由 action 响应值驱动，无需失效 ISR。
 */

/** 点赞目标类型（likes.target_type 合法值） */
export type LikeTarget = "thread" | "reply" | "comment" | "skill";

/** 收藏目标类型（favorites.target_type 合法值） */
export type FavoriteTarget = "skill" | "thread";

export type ToggleLikeResult =
  | { ok: true; liked: boolean; count: number }
  | { ok: false; error: "unauthorized" | "invalid" };

export type ToggleFavoriteResult =
  | { ok: true; favorited: boolean }
  | { ok: false; error: "unauthorized" | "invalid" };

/** getMyInteractions 入参 "type:id" 数组上限（防超大 in 查询） */
const MAX_TARGETS = 100;

const LIKE_TARGET_TYPES: ReadonlySet<string> = new Set([
  "thread",
  "reply",
  "comment",
  "skill",
]);

const FAVORITE_TARGET_TYPES: ReadonlySet<string> = new Set(["skill", "thread"]);

/** target_id 为 uuid 列：非法格式触库前拒绝，避免 PG invalid input syntax */
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 取当前登录用户 id（auth() 抛错 / 无 session → null） */
async function currentUserId(): Promise<string | null> {
  let session: Session | null = null;
  try {
    session = await auth();
  } catch {
    session = null;
  }
  // next-auth v5 默认 Session 类型无 id；database 策略下运行时
  // session.user 即 user 表整行（含 id），此处局部断言取用
  return (session?.user as { id?: string } | undefined)?.id ?? null;
}

/**
 * 调整目标表 like_count 并返回新值（update ... returning）。
 * delta=0 为只读探针（+0 无副作用，返回当前值）；目标行不存在 → null。
 */
async function adjustLikeCount(
  targetType: LikeTarget,
  targetId: string,
  delta: number,
): Promise<number | null> {
  switch (targetType) {
    case "thread": {
      const [row] = await db
        .update(threads)
        .set({ likeCount: sql`${threads.likeCount} + ${delta}` })
        .where(eq(threads.id, targetId))
        .returning({ likeCount: threads.likeCount });
      return row?.likeCount ?? null;
    }
    case "reply": {
      const [row] = await db
        .update(replies)
        .set({ likeCount: sql`${replies.likeCount} + ${delta}` })
        .where(eq(replies.id, targetId))
        .returning({ likeCount: replies.likeCount });
      return row?.likeCount ?? null;
    }
    case "comment": {
      const [row] = await db
        .update(comments)
        .set({ likeCount: sql`${comments.likeCount} + ${delta}` })
        .where(eq(comments.id, targetId))
        .returning({ likeCount: comments.likeCount });
      return row?.likeCount ?? null;
    }
    case "skill": {
      const [row] = await db
        .update(skills)
        .set({ likeCount: sql`${skills.likeCount} + ${delta}` })
        .where(eq(skills.id, targetId))
        .returning({ likeCount: skills.likeCount });
      return row?.likeCount ?? null;
    }
  }
}

export async function toggleLike(
  targetType: LikeTarget,
  targetId: string,
): Promise<ToggleLikeResult> {
  // 1. 登录校验（触库前）
  const userId = await currentUserId();
  if (!userId) {
    return { ok: false, error: "unauthorized" };
  }

  // 2. 入参校验：server action 参数来自客户端，类型标注不可信，运行时重验
  if (!LIKE_TARGET_TYPES.has(targetType) || !UUID_RE.test(targetId)) {
    return { ok: false, error: "invalid" };
  }

  // 3. 新赞判定：唯一约束冲突时 onConflictDoNothing 返回 0 行。
  //    注意 insert 与计数 update 为分步语句（neon-http 无交互式事务，
  //    与 upload.ts 的 check-then-insert 同类权衡）：并发双击下 ±1 执行
  //    顺序可能交错（瞬时计数可为负），但唯一约束保证 +1 与 -1 各恰
  //    一次，终态净零、绝不双 +1。
  const inserted = await db
    .insert(likes)
    .values({ userId, targetType, targetId })
    .onConflictDoNothing()
    .returning({ id: likes.id });

  if (inserted.length > 0) {
    // 新点赞：计数 +1（返回新值）
    // TODO(T2 通知)：liked=true 时 createNotification "like" 型通知作者
    const count = await adjustLikeCount(targetType, targetId, 1);
    return { ok: true, liked: true, count: count ?? 0 };
  }

  // 4. 已赞 → 取消：删除自己的 like 行（changes>0 才动计数）
  const deleted = await db
    .delete(likes)
    .where(
      and(
        eq(likes.userId, userId),
        eq(likes.targetType, targetType),
        eq(likes.targetId, targetId),
      ),
    )
    .returning({ id: likes.id });

  if (deleted.length === 0) {
    // 极端竞态：冲突行已被并发请求删掉 → 状态即"未赞"，计数不动（幂等）
    const count = await adjustLikeCount(targetType, targetId, 0);
    return { ok: true, liked: false, count: count ?? 0 };
  }

  const count = await adjustLikeCount(targetType, targetId, -1);
  return { ok: true, liked: false, count: count ?? 0 };
}

export async function toggleFavorite(
  targetType: FavoriteTarget,
  targetId: string,
): Promise<ToggleFavoriteResult> {
  // 1. 登录校验（触库前）
  const userId = await currentUserId();
  if (!userId) {
    return { ok: false, error: "unauthorized" };
  }

  // 2. 入参校验（收藏只开放 skill/thread 两类目标）
  if (!FAVORITE_TARGET_TYPES.has(targetType) || !UUID_RE.test(targetId)) {
    return { ok: false, error: "invalid" };
  }

  // 3. 新藏判定（favorites 无计数列，只动关系表）
  const inserted = await db
    .insert(favorites)
    .values({ userId, targetType, targetId })
    .onConflictDoNothing()
    .returning({ id: favorites.id });

  if (inserted.length > 0) {
    return { ok: true, favorited: true };
  }

  // 4. 已藏 → 取消（重复取消幂等：0 行删除仍返回 favorited=false）
  const deleted = await db
    .delete(favorites)
    .where(
      and(
        eq(favorites.userId, userId),
        eq(favorites.targetType, targetType),
        eq(favorites.targetId, targetId),
      ),
    )
    .returning({ id: favorites.id });

  return { ok: true, favorited: deleted.length > 0 };
}

export async function getMyInteractions(
  targets: string[],
): Promise<{ liked: string[]; favorited: string[] }> {
  // 未登录：返回空数组（挂载期拉取 401 由 API 路由层负责，此处不报错）
  const userId = await currentUserId();
  if (!userId) {
    return { liked: [], favorited: [] };
  }

  // 解析 "type:id"：≤100 项；无冒号 / 类型枚举外 / 非法 uuid 一律跳过
  const likeIds: { [K in LikeTarget]: Set<string> } = {
    thread: new Set(),
    reply: new Set(),
    comment: new Set(),
    skill: new Set(),
  };
  const favoriteIds: { [K in FavoriteTarget]: Set<string> } = {
    skill: new Set(),
    thread: new Set(),
  };

  for (const raw of targets.slice(0, MAX_TARGETS)) {
    const sep = raw.indexOf(":");
    if (sep <= 0) continue;
    const type = raw.slice(0, sep);
    const id = raw.slice(sep + 1);
    if (!UUID_RE.test(id)) continue;
    // 显式枚举判断（不用 `in`：原型链键如 toString 会误命中）
    if (LIKE_TARGET_TYPES.has(type)) {
      likeIds[type as LikeTarget].add(id);
    } else if (FAVORITE_TARGET_TYPES.has(type)) {
      favoriteIds[type as FavoriteTarget].add(id);
    }
  }

  // 按 targetType 分组 inArray 查询（likes ≤4 组 + favorites ≤2 组并行）
  const likeQueries = (Object.keys(likeIds) as LikeTarget[])
    .filter((t) => likeIds[t].size > 0)
    .map((t) =>
      db
        .select({ targetId: likes.targetId })
        .from(likes)
        .where(
          and(
            eq(likes.userId, userId),
            eq(likes.targetType, t),
            inArray(likes.targetId, [...likeIds[t]]),
          ),
        ),
    );
  const favoriteQueries = (Object.keys(favoriteIds) as FavoriteTarget[])
    .filter((t) => favoriteIds[t].size > 0)
    .map((t) =>
      db
        .select({ targetId: favorites.targetId })
        .from(favorites)
        .where(
          and(
            eq(favorites.userId, userId),
            eq(favorites.targetType, t),
            inArray(favorites.targetId, [...favoriteIds[t]]),
          ),
        ),
    );

  const [likeRows, favoriteRows] = await Promise.all([
    Promise.all(likeQueries),
    Promise.all(favoriteQueries),
  ]);

  return {
    liked: likeRows.flat().map((r) => r.targetId),
    favorited: favoriteRows.flat().map((r) => r.targetId),
  };
}
