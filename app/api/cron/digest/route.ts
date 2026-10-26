import { NextResponse } from "next/server";
import { sendDailyDigests } from "@/lib/digest";

/**
 * GET /api/cron/digest —— Vercel Cron 每日邮件摘要入口（Phase 3 Task 4）。
 *
 * 调度见 vercel.json（0 0 * * *，UTC 0 点 = 北京 8 点）。Vercel Cron
 * 在项目配置了 CRON_SECRET 环境变量时会自动带
 * `Authorization: Bearer ${CRON_SECRET}` 调用本路由。
 *
 * 鉴权 fail-closed（Review Focus #4）：CRON_SECRET 未设置 → 500。
 * 宁可整个端点拒服务，也不允许生产漏配 secret 后被任意 GET 刷邮件。
 * secret 设置但 token 不匹配 → 401。
 *
 * baseUrl：优先 env NEXT_PUBLIC_BASE_URL，fallback 请求头 host 拼
 * `https://{host}`（Vercel 上 cron 请求的 host 即生产域名）。
 */
export async function GET(request: Request): Promise<NextResponse> {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json(
      { error: "CRON_SECRET not configured" },
      { status: 500 },
    );
  }

  const authorization = request.headers.get("authorization");
  if (authorization !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // 空串（wrangler vars 配了空值）按未配置处理，避免邮件里出现相对链接
  const baseUrl =
    process.env.NEXT_PUBLIC_BASE_URL ||
    `https://${request.headers.get("host") ?? "localhost"}`;

  const { sent, skipped, failed } = await sendDailyDigests(baseUrl);
  return NextResponse.json({ sent, skipped, failed });
}
