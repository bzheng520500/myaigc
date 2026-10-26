"use server";

import { and, desc, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import type { Session } from "next-auth";
import { auth } from "@/lib/auth";
import { db, isDbAvailable } from "@/lib/db";
import { comments, skills, tutorials, users } from "@/lib/db/schema";
import { createNotification } from "@/lib/notify";
import { recentCount } from "@/lib/ratelimit";
import {
  validateCommentContent,
  type CommentItem,
  type CommentTargetType,
  type CreateCommentError,
} from "./comments-core";

/**
 * 评论 server actions（Task 10）。
 *
 * - createComment：登录校验 → 内容校验 → 60s 限流 → 目标存在性校验
 *   （顺带回查 slug）→ 插入（status='visible'）→ revalidatePath 详情路径
 * - listComments：visible 过滤 + join users，created_at desc，limit 100
 *   （单页详情不做评论分页，YAGNI）
 *
 * auth() 在无请求上下文（vitest / 无库构建）时会抛错，按未登录处理
 * （try/catch 兜底，与 site-header 模式一致）。
 */

/** 评论发送限流窗口（秒）：同用户 60s 内只允许 1 条 */
const COMMENT_RATE_WINDOW_SEC = 60;

/** comments.target_id 为 uuid：非法格式直接 not_found（D1 下省一次无谓查询） */
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type CreateCommentInput = {
  targetType: CommentTargetType;
  targetId: string;
  content: string;
};

export type CreateCommentResult =
  | { ok: true }
  | { ok: false; error: CreateCommentError };

export async function createComment(
  input: CreateCommentInput,
): Promise<CreateCommentResult> {
  // 1. 登录态：auth() 抛错（无请求上下文）按未登录处理。
  //    显式 Session 注解：auth 是多重载类型（兼具 middleware handler），
  //    ReturnType 会取到 handler 分支
  let session: Session | null = null;
  try {
    session = await auth();
  } catch {
    session = null;
  }
  // next-auth v5 默认 Session 类型无 id；database 策略下运行时
  // session.user 即 user 表整行（含 id），此处局部断言取用
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) {
    return { ok: false, error: "unauthorized" };
  }

  // 2. 内容校验（trim 语义在 validateCommentContent 内收口）
  const invalid = validateCommentContent(input.content);
  if (invalid) {
    return { ok: false, error: invalid };
  }

  // 3. 限流：60s 窗口内已有评论 → rate_limited
  const recent = await recentCount(
    "comments",
    userId,
    COMMENT_RATE_WINDOW_SEC,
  );
  if (recent >= 1) {
    return { ok: false, error: "rate_limited" };
  }

  // 4. 目标存在性校验（顺带回查 slug 供 revalidatePath 使用）
  if (!UUID_RE.test(input.targetId)) {
    return { ok: false, error: "not_found" };
  }
  let detailPath: string;
  // skill 作者 id：评论成功后发 skill_comment 通知（builtin 无作者 → null 跳过）
  let skillAuthorId: string | null = null;
  if (input.targetType === "skill") {
    const [row] = await db
      .select({ slug: skills.slug, authorId: skills.authorId })
      .from(skills)
      .where(and(eq(skills.id, input.targetId), eq(skills.status, "published")))
      .limit(1);
    if (!row) {
      return { ok: false, error: "not_found" };
    }
    detailPath = `/skills/${row.slug}`;
    skillAuthorId = row.authorId;
  } else {
    const [row] = await db
      .select({ slug: tutorials.slug })
      .from(tutorials)
      .where(eq(tutorials.id, input.targetId))
      .limit(1);
    if (!row) {
      return { ok: false, error: "not_found" };
    }
    detailPath = `/tutorials/${row.slug}`;
  }

  // 5. 插入（trim 后入库，status 默认 visible；returning id 供通知 sourceId）。
  //    终审 F7：写库异常兜底（与 forum.ts 同模式），前端映射统一中文文案
  let insertedId: string;
  try {
    const [inserted] = await db
      .insert(comments)
      .values({
        userId,
        targetType: input.targetType,
        targetId: input.targetId,
        content: input.content.trim(),
        status: "visible",
      })
      .returning({ id: comments.id });
    insertedId = inserted.id;
  } catch {
    return { ok: false, error: "server_error" };
  }

  // 6. 失效详情路径缓存（评论区预取在 Suspense 内动态执行，此处兜底）
  revalidatePath(detailPath);

  // 7. 通知（Phase 3）：skill 评论 → Skill 作者收 skill_comment。
  //    builtin Skill 无作者（authorId null）跳过；自评论由
  //    createNotification 内部自通知跳过；写失败静默不阻塞评论
  if (input.targetType === "skill" && skillAuthorId) {
    await createNotification({
      userId: skillAuthorId,
      actorId: userId,
      type: "skill_comment",
      sourceType: "comment",
      sourceId: insertedId,
    });
  }

  return { ok: true };
}

export async function listComments(
  targetType: CommentTargetType,
  targetId: string,
): Promise<CommentItem[]> {
  // 无数据库环境（如纯静态构建）：返回空列表，页面评论区走空态
  if (!isDbAvailable()) {
    return [];
  }

  return db
    .select({
      id: comments.id,
      content: comments.content,
      createdAt: comments.createdAt,
      authorId: comments.userId,
      authorName: users.name,
      authorImage: users.image,
      likeCount: comments.likeCount,
    })
    .from(comments)
    .innerJoin(users, eq(comments.userId, users.id))
    .where(
      and(
        eq(comments.targetType, targetType),
        eq(comments.targetId, targetId),
        eq(comments.status, "visible"),
      ),
    )
    .orderBy(desc(comments.createdAt))
    .limit(100);
}
