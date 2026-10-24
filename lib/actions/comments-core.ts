/**
 * 评论纯逻辑与共享类型（Task 10）。
 *
 * 独立于 "use server" 文件的原因：Next 只允许 "use server" 文件导出
 * async 函数，同步纯函数 validateCommentContent 必须外置才能被
 * action 层复用与 vitest 直接单测（brief 预案的 comments-core 拆分）。
 */

/** 评论字数上限（schema comments.content 注释：应用层校验） */
export const COMMENT_MAX_LENGTH = 2000;

/** 评论目标类型（多态 targetType 列的合法值） */
export type CommentTargetType = "skill" | "tutorial";

/** createComment 的失败错误码 */
export type CreateCommentError =
  | "unauthorized"
  | "too_long"
  | "rate_limited"
  | "not_found"
  | "empty";

/** listComments / 评论区消费的单条评论（join users 后的投影） */
export type CommentItem = {
  id: string;
  content: string;
  createdAt: Date;
  authorName: string | null;
  authorImage: string | null;
};

/**
 * 纯逻辑：content 校验（trim 后空 → empty；超上限 → too_long；合法 → null）。
 * 入参为原始字符串，trim 语义由本函数收口，调用方无需预先 trim。
 */
export function validateCommentContent(
  raw: string,
): Extract<CreateCommentError, "empty" | "too_long"> | null {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return "empty";
  if (trimmed.length > COMMENT_MAX_LENGTH) return "too_long";
  return null;
}
