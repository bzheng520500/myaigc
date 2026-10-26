"use server";

import { and, eq, ne, sql } from "drizzle-orm";
import { db, isDbAvailable } from "@/lib/db";
import { skills } from "@/lib/db/schema";

/**
 * Skill 互动计数 server actions（Task 7）。
 *
 * fire-and-forget：浏览计数在页面渲染后 after() 触发，复制计数在
 * CopyButton 复制成功后触发；失败或目标行不存在（update 影响 0 行）
 * 静默 no-op，绝不阻塞页面。
 */

/** 浏览数 +1 */
export async function incrementSkillView(slug: string): Promise<void> {
  // 无 D1 绑定（构建期 / 裸 Node 脚本）时静默跳过，避免 getDb 抛错
  if (!isDbAvailable()) return;
  try {
    await db
      .update(skills)
      .set({ viewCount: sql`${skills.viewCount} + 1` })
      .where(and(eq(skills.slug, slug), ne(skills.status, "removed")));
  } catch {
    // 计数失败静默（fire-and-forget）
  }
}

/** 复制数 +1 */
export async function incrementSkillCopy(slug: string): Promise<void> {
  // 无 D1 绑定（构建期 / 裸 Node 脚本）时静默跳过，避免 getDb 抛错
  if (!isDbAvailable()) return;
  try {
    await db
      .update(skills)
      .set({ copyCount: sql`${skills.copyCount} + 1` })
      .where(and(eq(skills.slug, slug), ne(skills.status, "removed")));
  } catch {
    // 计数失败静默（fire-and-forget）
  }
}
