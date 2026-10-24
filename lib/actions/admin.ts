"use server";

import { desc, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import type { Session } from "next-auth";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { comments, skills, tutorials, users } from "@/lib/db/schema";
import { requireAdmin } from "./admin-core";

/**
 * 管理后台 server actions（Task 12）。
 *
 * 统一模式：auth() 取 session → 无 session 或 role!=="admin" →
 * { ok:false, error:"forbidden" }（auth() 抛错按无 session 处理，
 * 与 comments.ts / upload.ts 同模式）。
 *
 * - setSkillStatus：回查 slug 后更新，revalidate 列表 + 首页 + 详情页
 * - setCommentStatus：回查评论的 targetType/targetId，revalidate 对应详情页
 * - listAdminData：管理台两列表数据（skills / comments 各最近 200 条）
 */

/** 管理台每个列表最多返回条数（简易后台不做分页，倒序取最近即可） */
const ADMIN_LIST_LIMIT = 200;

/** AdminCommentRow.content 的截断长度（管理台只展示摘要） */
const COMMENT_SNIPPET_LENGTH = 80;

/** skills.id / comments.id 均为 uuid 列：非法格式直接 invalid，避免 PG 抛 invalid input syntax */
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** setSkillStatus / setCommentStatus 的失败错误码 */
export type AdminActionError = "forbidden" | "invalid" | "not_found";

export type AdminActionResult =
  | { ok: true }
  | { ok: false; error: AdminActionError };

/** Skill 管理列表行（Phase 2/3 扩展依赖的接口） */
export type AdminSkillRow = {
  id: string;
  slug: string;
  name: string;
  category: string;
  source: string | null;
  status: string;
  viewCount: number;
  copyCount: number;
  createdAt: Date;
};

/** 评论管理列表行（content 已截断 80 字；Phase 2/3 扩展依赖的接口） */
export type AdminCommentRow = {
  id: string;
  content: string;
  status: string;
  createdAt: Date;
  targetType: string;
  authorName: string | null;
};

export type AdminDataResult =
  | { ok: true; data: { skills: AdminSkillRow[]; comments: AdminCommentRow[] } }
  | { ok: false; error: "forbidden" };

/**
 * 取当前 session；auth() 在无请求上下文（vitest / 无库构建）时会抛错，
 * 按无 session 处理。显式 Session 注言：auth 是多重载类型（兼具
 * middleware handler），ReturnType 会取到 handler 分支。
 */
async function getSession(): Promise<Session | null> {
  try {
    return await auth();
  } catch {
    return null;
  }
}

export async function setSkillStatus(
  id: string,
  status: "published" | "removed",
): Promise<AdminActionResult> {
  // 1. 权限：非 admin 一律拒绝（在任何数据库调用之前）
  if (!requireAdmin(await getSession())) {
    return { ok: false, error: "forbidden" };
  }

  // 2. id 格式：非 UUID 直接 invalid（触库之前）
  if (!UUID_RE.test(id)) {
    return { ok: false, error: "invalid" };
  }

  // 3. 回查 slug（revalidate 详情页需要；顺带校验目标存在）
  const [row] = await db
    .select({ slug: skills.slug })
    .from(skills)
    .where(eq(skills.id, id))
    .limit(1);
  if (!row) {
    return { ok: false, error: "not_found" };
  }

  // 4. 更新（updatedAt 同步刷新）
  await db
    .update(skills)
    .set({ status, updatedAt: new Date() })
    .where(eq(skills.id, id));

  // 5. 失效缓存：Skill 列表、首页聚合、详情页
  revalidatePath("/skills");
  revalidatePath("/");
  revalidatePath(`/skills/${row.slug}`);

  return { ok: true };
}

export async function setCommentStatus(
  id: string,
  status: "visible" | "hidden",
): Promise<AdminActionResult> {
  // 1. 权限：非 admin 一律拒绝（在任何数据库调用之前）
  if (!requireAdmin(await getSession())) {
    return { ok: false, error: "forbidden" };
  }

  // 2. id 格式：非 UUID 直接 invalid（触库之前）
  if (!UUID_RE.test(id)) {
    return { ok: false, error: "invalid" };
  }

  // 3. 回查评论的目标类型 / 目标 id（revalidate 对应详情页）
  const [row] = await db
    .select({ targetType: comments.targetType, targetId: comments.targetId })
    .from(comments)
    .where(eq(comments.id, id))
    .limit(1);
  if (!row) {
    return { ok: false, error: "not_found" };
  }

  // 4. 更新
  await db.update(comments).set({ status }).where(eq(comments.id, id));

  // 5. 失效目标详情页缓存：skill 回查 slug；tutorial 直接拼 /tutorials/${slug}
  if (row.targetType === "skill") {
    const [skill] = await db
      .select({ slug: skills.slug })
      .from(skills)
      .where(eq(skills.id, row.targetId))
      .limit(1);
    if (skill) {
      revalidatePath(`/skills/${skill.slug}`);
    }
  } else if (row.targetType === "tutorial") {
    const [tutorial] = await db
      .select({ slug: tutorials.slug })
      .from(tutorials)
      .where(eq(tutorials.id, row.targetId))
      .limit(1);
    if (tutorial) {
      revalidatePath(`/tutorials/${tutorial.slug}`);
    }
  }

  return { ok: true };
}

export async function listAdminData(): Promise<AdminDataResult> {
  // 1. 权限：非 admin 一律拒绝（在任何数据库调用之前）
  if (!requireAdmin(await getSession())) {
    return { ok: false, error: "forbidden" };
  }

  // 2. 两列表：skills / comments（join users 取作者名）各取最近 N 条
  const skillRows = await db
    .select({
      id: skills.id,
      slug: skills.slug,
      name: skills.name,
      category: skills.category,
      source: skills.source,
      status: skills.status,
      viewCount: skills.viewCount,
      copyCount: skills.copyCount,
      createdAt: skills.createdAt,
    })
    .from(skills)
    .orderBy(desc(skills.createdAt))
    .limit(ADMIN_LIST_LIMIT);

  const commentRows = await db
    .select({
      id: comments.id,
      content: comments.content,
      status: comments.status,
      createdAt: comments.createdAt,
      targetType: comments.targetType,
      authorName: users.name,
    })
    .from(comments)
    .innerJoin(users, eq(comments.userId, users.id))
    .orderBy(desc(comments.createdAt))
    .limit(ADMIN_LIST_LIMIT);

  return {
    ok: true,
    data: {
      skills: skillRows,
      comments: commentRows.map((row) => ({
        ...row,
        // 管理台只展示摘要：超长截断 80 字 + 省略号
        content:
          row.content.length > COMMENT_SNIPPET_LENGTH
            ? row.content.slice(0, COMMENT_SNIPPET_LENGTH) + "…"
            : row.content,
      })),
    },
  };
}
