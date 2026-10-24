"use server";

import { asc, desc, eq, max } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import type { Session } from "next-auth";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import {
  comments,
  forums,
  replies,
  skills,
  threads,
  tutorials,
  users,
} from "@/lib/db/schema";
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
 *
 * 论坛管理（Phase 2 Task 4 追加，同一前置模式）：
 * - setThreadFlags / setReplyStatus：置顶 / 锁定 / hidden 部分更新
 * - createForum / updateForum / deleteForum：板块 CRUD（slug 不可改、有帖禁删）
 * - listForumAdminData：管理台板块 + 帖子列表（hidden 帖包含，前台已排除）
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

/* ------------------------------------------------------------------ */
/* 论坛管理（Phase 2 Task 4 追加）                                       */
/* ------------------------------------------------------------------ */

/**
 * 论坛管理 action 的失败返回：error 为既有错误码（forbidden / invalid /
 * not_found，client 端映射中文）或业务中文文案（如「slug 已存在」）。
 */
export type AdminForumActionResult =
  | { ok: true }
  | { ok: false; error: string };

/** 板块 slug 规则：小写字母数字连字符 2-32 位 */
const FORUM_SLUG_RE = /^[a-z0-9-]{2,32}$/;

/** slug 校验失败文案（触库前返回） */
const FORUM_SLUG_ERROR =
  "slug 只能包含小写字母、数字和连字符，长度 2-32 位";

/** 管理台板块行（threadCount / replyCount 为 forums 表冗余计数） */
export type AdminForumRow = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  sortOrder: number | null;
  threadCount: number;
  replyCount: number;
};

/** 管理台帖子行（hidden 帖包含——前台列表已排除，管理台必须可见） */
export type AdminThreadRow = {
  id: string;
  title: string;
  forumSlug: string;
  forumName: string;
  status: string;
  isPinned: boolean;
  isLocked: boolean;
  replyCount: number;
  viewCount: number;
  createdAt: Date;
  authorName: string | null;
};

export type ForumAdminDataResult =
  | {
      ok: true;
      data: { forums: AdminForumRow[]; threads: AdminThreadRow[] };
    }
  | { ok: false; error: "forbidden" };

/** 管理台帖子列表最多返回条数（简易后台不做分页与搜索） */
const ADMIN_THREAD_LIST_LIMIT = 100;

/**
 * 更新帖子标志（置顶 / 锁定 / 状态）：只更新传入的字段（部分更新）。
 * 三类标志都影响前台展示或板块页排序，成功后统一 revalidate
 * 帖子页（/forum/[slug]/[threadId]）+ 板块页（/forum/[slug]）+ /forum。
 */
export async function setThreadFlags(
  id: string,
  flags: { pinned?: boolean; locked?: boolean; status?: "published" | "hidden" },
): Promise<AdminForumActionResult> {
  // 1. 权限：非 admin 一律拒绝（在任何数据库调用之前）
  if (!requireAdmin(await getSession())) {
    return { ok: false, error: "forbidden" };
  }

  // 2. id 格式：非 UUID 直接 invalid（触库之前）
  if (!UUID_RE.test(id)) {
    return { ok: false, error: "invalid" };
  }

  // 3. 至少传一个标志，否则无从更新
  if (
    flags.pinned === undefined &&
    flags.locked === undefined &&
    flags.status === undefined
  ) {
    return { ok: false, error: "invalid" };
  }

  // 4. 回查所属板块 slug（revalidate 需要；顺带校验帖子存在）
  const [row] = await db
    .select({ forumSlug: forums.slug })
    .from(threads)
    .innerJoin(forums, eq(threads.forumId, forums.id))
    .where(eq(threads.id, id))
    .limit(1);
  if (!row) {
    return { ok: false, error: "not_found" };
  }

  // 5. 部分更新：只 set 传入的标志（updatedAt 同步刷新）
  const patch: {
    isPinned?: boolean;
    isLocked?: boolean;
    status?: "published" | "hidden";
  } = {};
  if (flags.pinned !== undefined) patch.isPinned = flags.pinned;
  if (flags.locked !== undefined) patch.isLocked = flags.locked;
  if (flags.status !== undefined) patch.status = flags.status;
  await db
    .update(threads)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(threads.id, id));

  // 6. 失效缓存：hidden 影响帖子页/板块页/首页列表，置顶影响板块页排序
  revalidatePath(`/forum/${row.forumSlug}/${id}`);
  revalidatePath(`/forum/${row.forumSlug}`);
  revalidatePath("/forum");

  return { ok: true };
}

/** 隐藏 / 恢复楼层回复：回查所属帖子与板块 slug 后 revalidate 帖子页 */
export async function setReplyStatus(
  id: string,
  status: "visible" | "hidden",
): Promise<AdminForumActionResult> {
  // 1. 权限：非 admin 一律拒绝（在任何数据库调用之前）
  if (!requireAdmin(await getSession())) {
    return { ok: false, error: "forbidden" };
  }

  // 2. id 格式：非 UUID 直接 invalid（触库之前）
  if (!UUID_RE.test(id)) {
    return { ok: false, error: "invalid" };
  }

  // 3. 回查回复所属帖子 id + 板块 slug（revalidate 帖子页需要）
  const [row] = await db
    .select({ threadId: replies.threadId, forumSlug: forums.slug })
    .from(replies)
    .innerJoin(threads, eq(replies.threadId, threads.id))
    .innerJoin(forums, eq(threads.forumId, forums.id))
    .where(eq(replies.id, id))
    .limit(1);
  if (!row) {
    return { ok: false, error: "not_found" };
  }

  // 4. 更新 + 失效帖子页缓存（楼层只在帖子页展示）
  await db.update(replies).set({ status }).where(eq(replies.id, id));
  revalidatePath(`/forum/${row.forumSlug}/${row.threadId}`);

  return { ok: true };
}

/** 新建板块：slug 唯一且受正则约束；sortOrder 缺省取全表 max+1 */
export async function createForum(input: {
  slug: string;
  name: string;
  description?: string;
  sortOrder?: number;
}): Promise<AdminForumActionResult> {
  // 1. 权限：非 admin 一律拒绝（在任何数据库调用之前）
  if (!requireAdmin(await getSession())) {
    return { ok: false, error: "forbidden" };
  }

  // 2. slug / name 格式（触库之前）
  if (!FORUM_SLUG_RE.test(input.slug)) {
    return { ok: false, error: FORUM_SLUG_ERROR };
  }
  if (!input.name.trim()) {
    return { ok: false, error: "板块名称不能为空" };
  }

  // 3. 重名检查（slug 有 unique 约束，先查给出友好错误）
  const [existing] = await db
    .select({ id: forums.id })
    .from(forums)
    .where(eq(forums.slug, input.slug))
    .limit(1);
  if (existing) {
    return { ok: false, error: "slug 已存在" };
  }

  // 4. sortOrder 缺省取 max+1（空表时为 1）
  let sortOrder = input.sortOrder;
  if (sortOrder === undefined) {
    const [maxRow] = await db
      .select({ value: max(forums.sortOrder) })
      .from(forums);
    sortOrder = (maxRow?.value ?? 0) + 1;
  }

  await db.insert(forums).values({
    slug: input.slug,
    name: input.name.trim(),
    description: input.description?.trim() || null,
    sortOrder,
  });

  revalidatePath("/forum");
  return { ok: true };
}

/** 更新板块（slug 不可改）：部分更新 name / description / sortOrder */
export async function updateForum(
  id: string,
  input: { name?: string; description?: string; sortOrder?: number },
): Promise<AdminForumActionResult> {
  // 1. 权限：非 admin 一律拒绝（在任何数据库调用之前）
  if (!requireAdmin(await getSession())) {
    return { ok: false, error: "forbidden" };
  }

  // 2. id 格式：非 UUID 直接 invalid（触库之前）
  if (!UUID_RE.test(id)) {
    return { ok: false, error: "invalid" };
  }

  // 3. 回查 slug（改名影响板块页标题，revalidate 需要；顺带校验存在）
  const [row] = await db
    .select({ slug: forums.slug })
    .from(forums)
    .where(eq(forums.id, id))
    .limit(1);
  if (!row) {
    return { ok: false, error: "not_found" };
  }

  // 4. 部分更新：只 set 传入的字段
  const patch: { name?: string; description?: string | null; sortOrder?: number } =
    {};
  if (input.name !== undefined) {
    if (!input.name.trim()) {
      return { ok: false, error: "板块名称不能为空" };
    }
    patch.name = input.name.trim();
  }
  if (input.description !== undefined) {
    patch.description = input.description.trim() || null;
  }
  if (input.sortOrder !== undefined) {
    patch.sortOrder = input.sortOrder;
  }
  if (Object.keys(patch).length === 0) {
    return { ok: false, error: "invalid" };
  }
  await db.update(forums).set(patch).where(eq(forums.id, id));

  revalidatePath("/forum");
  revalidatePath(`/forum/${row.slug}`);

  return { ok: true };
}

/**
 * 删除板块：板块内还有帖子（含 hidden——DB 无外键孤儿帖，任何帖子都阻止
 * 删除）→ 拒绝；空板块删除后 revalidate /forum。
 */
export async function deleteForum(
  id: string,
): Promise<AdminForumActionResult> {
  // 1. 权限：非 admin 一律拒绝（在任何数据库调用之前）
  if (!requireAdmin(await getSession())) {
    return { ok: false, error: "forbidden" };
  }

  // 2. id 格式：非 UUID 直接 invalid（触库之前）
  if (!UUID_RE.test(id)) {
    return { ok: false, error: "invalid" };
  }

  // 3. 回查存在性
  const [row] = await db
    .select({ id: forums.id })
    .from(forums)
    .where(eq(forums.id, id))
    .limit(1);
  if (!row) {
    return { ok: false, error: "not_found" };
  }

  // 4. 板块内有任何帖子（含 hidden）→ 拒绝删除
  const [threadRow] = await db
    .select({ id: threads.id })
    .from(threads)
    .where(eq(threads.forumId, id))
    .limit(1);
  if (threadRow) {
    return { ok: false, error: "板块内还有帖子，请先处理" };
  }

  await db.delete(forums).where(eq(forums.id, id));

  revalidatePath("/forum");
  return { ok: true };
}

/** 管理台论坛数据：板块全量（sortOrder 升序）+ 最近帖子（hidden 包含） */
export async function listForumAdminData(): Promise<ForumAdminDataResult> {
  // 1. 权限：非 admin 一律拒绝（在任何数据库调用之前）
  if (!requireAdmin(await getSession())) {
    return { ok: false, error: "forbidden" };
  }

  // 2. 板块列表（threadCount / replyCount 为表上冗余计数，与论坛首页一致）
  const forumRows = await db
    .select({
      id: forums.id,
      slug: forums.slug,
      name: forums.name,
      description: forums.description,
      sortOrder: forums.sortOrder,
      threadCount: forums.threadCount,
      replyCount: forums.replyCount,
    })
    .from(forums)
    .orderBy(asc(forums.sortOrder));

  // 3. 帖子列表：join 板块 + 作者，hidden 包含（管理台要能看到并恢复）
  const threadRows = await db
    .select({
      id: threads.id,
      title: threads.title,
      forumSlug: forums.slug,
      forumName: forums.name,
      status: threads.status,
      isPinned: threads.isPinned,
      isLocked: threads.isLocked,
      replyCount: threads.replyCount,
      viewCount: threads.viewCount,
      createdAt: threads.createdAt,
      authorName: users.name,
    })
    .from(threads)
    .innerJoin(forums, eq(threads.forumId, forums.id))
    .innerJoin(users, eq(threads.authorId, users.id))
    .orderBy(desc(threads.createdAt))
    .limit(ADMIN_THREAD_LIST_LIMIT);

  return { ok: true, data: { forums: forumRows, threads: threadRows } };
}
