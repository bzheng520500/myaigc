import { eq } from "drizzle-orm";
import { Resend } from "resend";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { listNotifications } from "@/lib/notify";
import {
  renderDailyDigestHtml,
  type DigestNotification,
} from "@/lib/emails/daily-digest";

/**
 * 每日邮件摘要域库（Phase 3 Task 4）。
 *
 * - buildDigest：直接复用 listNotifications（link 解析 / unread 计数
 *   一分不重写），无未读返回 null（调用方 skip）
 * - sendDailyDigests：遍历 notify_email_enabled=true 的用户（社区早期
 *   用户量小，一次查全表不分页——YAGNI）；AUTH_DEV_MODE=1 时不真发
 *   （摘要打印 console），sent 正常计数，dev 可测
 * - 单用户失败（查询 / 发信异常）catch 计 failed，不中断其他用户
 */

export type { DigestNotification };

export type SendDailyDigestsResult = {
  sent: number;
  skipped: number;
  failed: number;
};

export async function buildDigest(
  userId: string,
): Promise<{ unread: DigestNotification[] } | null> {
  // 无数据库环境（纯静态构建 / 本地无 .env）：无可摘要
  if (!process.env.DATABASE_URL) return null;

  const { items, unread } = await listNotifications(userId);
  if (unread === 0) return null;

  // 摘要只放未读条目（items 为最近一页含已读，过滤掉）
  const unreadItems: DigestNotification[] = items
    .filter((item) => item.readAt === null)
    .map(({ id, type, actorName, link, createdAt }) => ({
      id,
      type,
      actorName,
      link,
      createdAt,
    }));
  return { unread: unreadItems };
}

export async function sendDailyDigests(
  baseUrl: string,
): Promise<SendDailyDigestsResult> {
  if (!process.env.DATABASE_URL) {
    return { sent: 0, skipped: 0, failed: 0 };
  }

  const devMode = process.env.AUTH_DEV_MODE === "1";
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.AUTH_EMAIL_FROM;
  const resend = !devMode && apiKey && from ? new Resend(apiKey) : null;

  const enabled = await db
    .select({ id: users.id, name: users.name, email: users.email })
    .from(users)
    .where(eq(users.notifyEmail, true));

  let sent = 0;
  let skipped = 0;
  let failed = 0;

  for (const user of enabled) {
    try {
      const digest = await buildDigest(user.id);
      if (!digest) {
        skipped += 1;
        continue;
      }

      const html = renderDailyDigestHtml({
        // name 可空（schema 默认取邮箱前缀由应用层处理），兜底邮箱前缀
        recipientName: user.name ?? user.email.split("@")[0],
        baseUrl,
        items: digest.unread,
      });

      if (devMode) {
        console.log(
          `[digest] DEV 摘要（${user.email}）：${digest.unread.length} 条未读`,
        );
        sent += 1;
        continue;
      }

      if (!resend || !from) {
        // 非 DEV 但 RESEND_API_KEY / AUTH_EMAIL_FROM 未配置
        failed += 1;
        continue;
      }

      const { error } = await resend.emails.send({
        from,
        to: user.email,
        subject: `你在 AI影视工坊 有 ${digest.unread.length} 条新通知`,
        html,
      });
      if (error) {
        failed += 1;
      } else {
        sent += 1;
      }
    } catch {
      // 单用户失败不中断批次
      failed += 1;
    }
  }

  return { sent, skipped, failed };
}
