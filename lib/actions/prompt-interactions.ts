"use server";

import { eq, sql } from "drizzle-orm";
import { db, isDbAvailable } from "@/lib/db";
import { prompts } from "@/lib/db/schema";

/**
 * Prompt 互动计数 server action（Task 8）。
 *
 * fire-and-forget：复制计数在 CopyButton 复制成功后触发；
 * 失败或目标行不存在（update 影响 0 行）静默 no-op，绝不阻塞页面。
 */

/** 复制数 +1 */
export async function incrementPromptCopy(id: string): Promise<void> {
  // 无 D1 绑定（构建期 / 裸 Node 脚本）时静默跳过，避免 getDb 抛错
  if (!isDbAvailable()) return;
  try {
    await db
      .update(prompts)
      .set({ copyCount: sql`${prompts.copyCount} + 1` })
      .where(eq(prompts.id, id));
  } catch {
    // 计数失败静默（fire-and-forget）
  }
}
