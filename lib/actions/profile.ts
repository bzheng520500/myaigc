"use server";

import { eq } from "drizzle-orm";
import type { Session } from "next-auth";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";

/**
 * 个人设置 server action（Phase 3 Task 3）。
 *
 * - 只改本人（update where id = session.user.id，天然免越权）
 * - 校验全部在触库之前：未登录 / 昵称超 30 字 / 头像非 http(s) URL
 * - 不调 revalidatePath：个人主页查询禁缓存（lib/queries/profile.ts
 *   查询不缓存），设置页靠 router.refresh() 拉新
 */

/** 昵称字数上限（schema 注释：应用层校验） */
const NAME_MAX_LENGTH = 30;

/** 头像地址：仅允许 http(s)，防 javascript: 等注入协议 */
const IMAGE_URL_RE = /^https?:\/\/\S+$/i;

export type UpdateProfileInput = {
  name?: string;
  image?: string;
  notifyEmailEnabled?: boolean;
};

export type UpdateProfileResult =
  | { ok: true }
  | { ok: false; error: string };

export async function updateProfile(
  input: UpdateProfileInput,
): Promise<UpdateProfileResult> {
  // 1. 登录态：auth() 抛错（无请求上下文）按未登录处理
  //    （显式 Session 注言：auth 是多重载类型，与 comments.ts 同模式）
  let session: Session | null = null;
  try {
    session = await auth();
  } catch {
    session = null;
  }
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) {
    return { ok: false, error: "请先登录" };
  }

  // 2. 组装更新列：三个字段均可选，只更新显式提供的
  const patch: Partial<{
    name: string;
    image: string | null;
    notifyEmail: boolean;
  }> = {};

  if (input.name !== undefined) {
    const trimmed = input.name.trim();
    if (trimmed.length > NAME_MAX_LENGTH) {
      return { ok: false, error: "昵称不能超过 30 字" };
    }
    // trim 后为空：跳过（不误清昵称，页面回退邮箱前缀）
    if (trimmed) {
      patch.name = trimmed;
    }
  }

  if (input.image !== undefined) {
    const trimmed = input.image.trim();
    if (trimmed === "") {
      patch.image = null; // 空串清空头像
    } else if (!IMAGE_URL_RE.test(trimmed)) {
      return { ok: false, error: "头像地址无效" };
    } else {
      patch.image = trimmed;
    }
  }

  if (typeof input.notifyEmailEnabled === "boolean") {
    patch.notifyEmail = input.notifyEmailEnabled;
  }

  // 3. 无任何有效更新列：直接成功（不发起空 update）
  if (Object.keys(patch).length === 0) {
    return { ok: true };
  }

  // 4. 写库（终审 F7：异常兜底返回统一中文文案，与 forum.ts 同模式）
  try {
    await db.update(users).set(patch).where(eq(users.id, userId));
  } catch {
    return { ok: false, error: "操作失败，请稍后再试" };
  }
  return { ok: true };
}
