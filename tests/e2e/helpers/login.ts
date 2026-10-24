import { expect, type Page } from "@playwright/test";
import { readFile, writeFile } from "node:fs/promises";

/**
 * E2E 登录共享 helpers（Phase 2 Task 3 从 phase1.spec.ts 抽出）。
 *
 * 运行前置（连库执行由控制器统一跑，spec 侧只做声明）：
 * - DATABASE_URL：Neon 连接串（未设置时 spec 顶层 skip）
 * - AUTH_DEV_MODE=1：lib/auth.ts 走 DEV 分支（不调 Resend）
 * - E2E_TOKEN_URL_FILE：设置后 lib/auth.ts 把魔法链接追加写入该文件
 *   （两侧默认值均为 .next/e2e-login-url.txt，相对 dev server cwd）
 *
 * 登录方案：Playwright 读不到 dev server 控制台，魔法链接由
 * lib/auth.ts DEV 分支落盘，轮询取最新一条后 page.goto 完成
 * 「点链接」登录；读到即清空文件，防止链接串用例。
 */

/** 魔法链接落盘文件，与 lib/auth.ts 的 E2E_TOKEN_URL_FILE 对齐 */
const LOGIN_URL_FILE =
  process.env.E2E_TOKEN_URL_FILE ?? ".next/e2e-login-url.txt";

/** 轮询节奏：5s 间隔 / 30s 超时 */
const POLL_INTERVAL_MS = 5_000;
const POLL_TIMEOUT_MS = 30_000;

const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * 轮询读取魔法链接文件，返回最新一条非空行。
 * DEV 分支是追加写（可能存在历史残留），取最后一行即最新链接；
 * 读取成功后立即清空文件（truncate），下个用例不会复用旧链接。
 */
export async function takeLatestLoginUrl(): Promise<string> {
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  let lastState = "尚未读到文件";
  while (Date.now() < deadline) {
    try {
      const text = await readFile(LOGIN_URL_FILE, "utf8");
      const lines = text
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean);
      if (lines.length > 0) {
        await writeFile(LOGIN_URL_FILE, "", "utf8");
        return lines[lines.length - 1];
      }
      lastState = "文件为空";
    } catch (error) {
      lastState = error instanceof Error ? error.message : String(error);
    }
    await sleep(POLL_INTERVAL_MS);
  }
  throw new Error(
    `${POLL_TIMEOUT_MS / 1000}s 内未从 ${LOGIN_URL_FILE} 读到魔法链接（最后状态：${lastState}）`,
  );
}

/**
 * 完整登录流程：登录页提交邮箱 → 轮询取魔法链接 → 访问链接
 * 完成登录 → 断言页头出现邮箱前缀（site-header 用户名 span）。
 */
export async function loginViaLink(page: Page, email: string): Promise<void> {
  await page.goto("/login");
  await page.getByLabel("邮箱地址").fill(email);
  await page.getByRole("button", { name: "发送登录链接" }).click();
  await expect(page.getByText("登录链接已发送到你的邮箱")).toBeVisible();

  // 魔法链接 = /api/auth/callback/email?token=…，验证成功后落回 returnUrl（默认 /）
  const loginUrl = await takeLatestLoginUrl();
  await page.goto(loginUrl);
  // site-header 用户名 span（邮箱前缀）；header 是 body 直接子级，role=banner
  await expect(
    page.getByRole("banner").getByText(email.split("@")[0]),
  ).toBeVisible();
}
