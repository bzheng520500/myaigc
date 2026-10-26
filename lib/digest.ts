import { eq } from "drizzle-orm";
import { db, isDbAvailable } from "@/lib/db";
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
 * - 发信直接 fetch Resend REST API（不引 resend SDK：Workers 下省体积、
 *   免 Node 兼容层），10s 超时防止 cron 挂死
 * - 单用户失败（查询 / 发信异常）catch 计 failed，不中断其他用户
 */

export type { DigestNotification };

export type SendDailyDigestsResult = {
  sent: number;
  skipped: number;
  failed: number;
};

/** 摘要窗口（毫秒）：只汇总最近 24 小时的通知（spec 每日摘要） */
export const DIGEST_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * 纯逻辑：摘要窗口起点（now 往前 24h）。导出供单测（终审 F3）。
 */
export function digestSince(now: Date = new Date()): Date {
  return new Date(now.getTime() - DIGEST_WINDOW_MS);
}

/** Resend 发信 REST 端点（Cloudflare Workers 下不引 SDK，直接 fetch） */
const RESEND_ENDPOINT = "https://api.resend.com/emails";

/** 单次发信请求超时（毫秒）：外部 API 无响应时不拖死整个 cron 批次 */
const RESEND_TIMEOUT_MS = 10_000;

export type DigestEmailPayload = {
  from: string;
  to: string;
  subject: string;
  html: string;
};

/**
 * 直接 POST Resend REST API 发送一封邮件（替代 resend SDK：Workers 下
 * 省体积、免 Node 兼容层）。返回是否成功（2xx），非 2xx 记 console.error
 * 后返回 false；网络异常 / 超时向调用方抛出（由 sendDailyDigests 的
 * 单用户 catch 计 failed）。导出供单测断言请求体（与 digestSince 同模式）。
 */
export async function sendDigestEmail(
  apiKey: string,
  payload: DigestEmailPayload,
): Promise<boolean> {
  const response = await fetch(RESEND_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(RESEND_TIMEOUT_MS),
  });

  if (!response.ok) {
    console.error(
      `[digest] Resend 发信失败（HTTP ${response.status}）：${await response.text()}`,
    );
    return false;
  }
  return true;
}

export async function buildDigest(
  userId: string,
): Promise<{ unread: DigestNotification[] } | null> {
  // 无数据库环境（纯静态构建 / 本地无 .env）：无可摘要
  if (!isDbAvailable()) return null;

  // 终审 F3：只汇总最近 24h 的通知（更早的未读留给通知中心自行查看）
  const { items, unread } = await listNotifications(userId, undefined, {
    since: digestSince(),
  });
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
  if (!isDbAvailable()) {
    return { sent: 0, skipped: 0, failed: 0 };
  }

  const devMode = process.env.AUTH_DEV_MODE === "1";

  // 终审 F6：非 DEV 且发信配置缺失 → 循环前快速失败（不查库、不进
  // 循环逐用户 failed）。failed=-1 哨兵表示配置缺失（区别于发信失败），
  // route 原样返回给调用方 / 监控，可诊断漏配。
  if (!devMode && (!process.env.RESEND_API_KEY || !process.env.AUTH_EMAIL_FROM)) {
    console.error(
      "[digest] 每日摘要未发送：非 DEV 环境缺少 RESEND_API_KEY / AUTH_EMAIL_FROM 配置（failed=-1）",
    );
    return { sent: 0, skipped: 0, failed: -1 };
  }

  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.AUTH_EMAIL_FROM;

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

      if (!apiKey || !from) {
        // 非 DEV 但 RESEND_API_KEY / AUTH_EMAIL_FROM 未配置
        // （正常已被上面的快速失败拦下，保留防御）
        failed += 1;
        continue;
      }

      const ok = await sendDigestEmail(apiKey, {
        from,
        to: user.email,
        subject: `你在 AI影视工坊 有 ${digest.unread.length} 条新通知`,
        html,
      });
      if (ok) {
        sent += 1;
      } else {
        failed += 1;
      }
    } catch {
      // 单用户失败不中断批次
      failed += 1;
    }
  }

  return { sent, skipped, failed };
}
