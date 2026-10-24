import type { NotificationType } from "@/lib/notify";

/**
 * 每日摘要邮件 HTML 模板（Phase 3 Task 4）。
 *
 * 纯函数纯字符串模板（不用 react-email——YAGNI）：服务端渲染一次
 * 发给全部开关用户，零交互零组件复用，字符串拼接足够。
 *
 * - 品牌风格对齐站内设计 token：米白底 #FAF9F5、衬线标题
 *   （邮件不引 webfont，Georgia 系衬线 fallback）、陶土橙 #D97757 按钮
 * - 用户内容（recipientName / actorName / link）一律 escapeHtml——
 *   邮件客户端无 CSP 保护，XSS 转义是硬要求
 * - 相对时间在发送时刻计算（邮件是静态快照，不含脚本）
 */

/** 摘要条目（buildDigest 产出，见 lib/digest.ts） */
export type DigestNotification = {
  id: string;
  type: NotificationType;
  actorName: string | null;
  link: string | null;
  createdAt: Date;
};

export type DailyDigestInput = {
  recipientName: string;
  baseUrl: string;
  items: DigestNotification[];
};

/** 类型 → 动作文案（与 app/notifications/page.tsx 的 TYPE_TEXT 保持一致） */
const TYPE_TEXT: Record<NotificationType, string> = {
  thread_reply: "回复了你的帖子",
  reply_reply: "回复了你",
  skill_comment: "评论了你的 Skill",
  like: "赞了你的内容",
};

/** HTML 转义（& < > " ' 全量，用户内容进属性与文本前必过） */
function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/** 相对时间（发送时刻快照）：刚刚 / N 分钟前 / N 小时前 / N 天前 / N 个月前 / N 年前 */
function relativeTime(date: Date, now = new Date()): string {
  const seconds = Math.max(0, Math.floor((now.getTime() - date.getTime()) / 1000));
  if (seconds < 60) return "刚刚";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} 天前`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months} 个月前`;
  return `${Math.floor(months / 12)} 年前`;
}

/** 单条摘要行：actor + 动作文案（link 可点，源已删纯文本）+ 相对时间 */
function renderItem(item: DigestNotification, baseUrl: string): string {
  const actor = item.actorName ? escapeHtml(item.actorName) : "有人";
  const text = `${actor} ${TYPE_TEXT[item.type]}`;
  const body = item.link
    ? `<a href="${escapeHtml(`${baseUrl}${item.link}`)}" style="color:#2F2B25;text-decoration:none;">${text}</a>`
    : `<span style="color:#2F2B25;">${text}</span>`;
  return [
    '<li style="padding:10px 0;border-bottom:1px solid #EDEAE3;font-size:14px;line-height:1.6;">',
    body,
    `<span style="color:#8A857C;"> · ${relativeTime(item.createdAt)}</span>`,
    "</li>",
  ].join("");
}

export function renderDailyDigestHtml(input: DailyDigestInput): string {
  const name = escapeHtml(input.recipientName);
  const listHtml =
    input.items.length > 0
      ? input.items.map((item) => renderItem(item, input.baseUrl)).join("")
      : '<li style="padding:10px 0;font-size:14px;color:#8A857C;">暂无未读通知</li>';

  return `<!DOCTYPE html>
<html lang="zh-CN">
<body style="margin:0;padding:24px;background:#FAF9F5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','PingFang SC','Microsoft YaHei',sans-serif;">
  <div style="max-width:560px;margin:0 auto;">
    <div style="background:#FFFFFF;border-radius:12px;padding:32px;">
      <p style="margin:0 0 4px;font-family:Georgia,'Times New Roman',serif;font-size:20px;font-weight:700;color:#2F2B25;">AI影视工坊</p>
      <p style="margin:0 0 24px;font-size:13px;color:#8A857C;">每日通知摘要</p>
      <p style="margin:0 0 8px;font-size:15px;color:#2F2B25;">你好，${name}</p>
      <p style="margin:0 0 16px;font-size:15px;color:#2F2B25;">以下是你的未读通知：</p>
      <ul style="margin:0 0 24px;padding:0;list-style:none;">${listHtml}</ul>
      <div style="text-align:center;">
        <a href="${escapeHtml(`${input.baseUrl}/notifications`)}" style="display:inline-block;background:#D97757;color:#FFFFFF;font-size:14px;font-weight:600;text-decoration:none;border-radius:9999px;padding:10px 28px;">查看全部通知</a>
      </div>
    </div>
    <p style="margin:16px 0 0;text-align:center;font-size:12px;color:#8A857C;">
      不想再收到邮件通知？可在设置中关闭邮件通知：<a href="${escapeHtml(`${input.baseUrl}/settings`)}" style="color:#8A857C;">前往设置</a>
    </p>
  </div>
</body>
</html>`;
}
