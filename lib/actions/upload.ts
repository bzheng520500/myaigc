"use server";

import { and, count, eq, gte } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import type { Session } from "next-auth";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { skills } from "@/lib/db/schema";
import { parseSkillMd } from "@/lib/frontmatter";
import { ensureUniqueSlug, slugify } from "@/lib/slug";

/**
 * Skill 上传 server action（Task 11，Review Focus #5 未登录拒绝）。
 *
 * 分支顺序（前三步在任何数据库调用之前，vitest 无库可测）：
 * 登录校验 → 100KB 体积 → frontmatter 校验（透传中文文案）→
 * category 默认 → 10 分钟 3 条限流 → slug 去重插入 → revalidate。
 *
 * 限流说明：ratelimit.ts 只支持 comments/threads/replies/tokens 四表，
 * skills 上传频控直接查 skills 表（authorId + created_at 时间窗）。
 * auth() 无请求上下文时抛错，按未登录处理（与 comments.ts 同模式）。
 */

/** 上传原文体积上限（字符数，100KB） */
const MAX_RAW_LENGTH = 100 * 1024;

/** 上传限流窗口（秒）：同用户 10 分钟内最多 3 条 */
const UPLOAD_WINDOW_SEC = 10 * 60;
const UPLOAD_WINDOW_MAX = 3;

export type UploadSkillResult =
  | { ok: true; slug: string }
  | { ok: false; error: string };

/** PG 唯一约束冲突（如 skills.slug unique 撞车）的 error code */
function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: unknown }).code === "23505"
  );
}

export async function uploadSkill(
  raw: string,
  category: string,
): Promise<UploadSkillResult> {
  // 1. 登录态：auth() 抛错（无请求上下文）按未登录处理
  //    （显式 Session 注言：auth 是多重载类型，ReturnType 会取到 handler 分支）
  let session: Session | null = null;
  try {
    session = await auth();
  } catch {
    session = null;
  }
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) {
    return { ok: false, error: "请先登录后再上传" };
  }

  // 2. 体积限制（放在 frontmatter 之前：超长内容解析本身也是浪费）
  if (raw.length > MAX_RAW_LENGTH) {
    return { ok: false, error: "内容超过 100KB 限制" };
  }

  // 3. frontmatter 校验：中文文案直接透传给页面行内提示
  const parsed = parseSkillMd(raw);
  if (!parsed.ok) {
    return { ok: false, error: parsed.error };
  }

  // 4. category 兜底
  const finalCategory = category.trim() || "其他";

  // 5. 限流：该作者 10 分钟窗口内的上传条数（直接查 skills 表）
  const since = new Date(Date.now() - UPLOAD_WINDOW_SEC * 1000);
  const [recent] = await db
    .select({ n: count() })
    .from(skills)
    .where(and(eq(skills.authorId, userId), gte(skills.createdAt, since)));
  if (Number(recent?.n ?? 0) >= UPLOAD_WINDOW_MAX) {
    return { ok: false, error: "上传太频繁，请稍后再试" };
  }

  // 6. slug 去重（中文名转拼音）并插入，content 存 raw 原文（含 frontmatter）。
  //    ensureUniqueSlug 是 check-then-insert，非原子：并发同 base 时可能
  //    撞 skills.slug 唯一约束（PG 23505），此时重算 slug 重试一次；
  //    二次仍失败或任何其他 DB 异常 → 中文错误，不向客户端裸抛。
  const base = slugify(parsed.name);
  let slug: string | null = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    const candidate = await ensureUniqueSlug(base);
    try {
      await db.insert(skills).values({
        slug: candidate,
        name: parsed.name,
        description: parsed.description,
        contentMd: raw,
        category: finalCategory,
        authorId: userId,
        source: "user",
        status: "published",
      });
      slug = candidate;
      break;
    } catch (error) {
      if (!isUniqueViolation(error)) {
        return { ok: false, error: "上传失败，请稍后再试" };
      }
      // 唯一冲突：并发撞车，下一轮 ensureUniqueSlug 会查到已有 slug 改派生
    }
  }
  if (slug === null) {
    return { ok: false, error: "上传失败，请稍后再试" };
  }

  revalidatePath("/skills");
  revalidatePath("/");

  return { ok: true, slug };
}
