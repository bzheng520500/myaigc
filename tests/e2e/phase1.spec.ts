import { test, expect } from "@playwright/test";
import { readFile, writeFile } from "node:fs/promises";

/**
 * Phase 1 E2E 主链路（Task 14）：
 * 登录 → 上传 → 详情 → 评论 → /skills 列表 revalidate。
 *
 * 运行前置（连库执行由控制器统一跑，本 spec 只做声明）：
 * - DATABASE_URL：Neon 连接串（未设置时整个文件 skip，见顶层守卫）
 * - AUTH_DEV_MODE=1：lib/auth.ts 走 DEV 分支（不调 Resend）
 * - E2E_TOKEN_URL_FILE：设置后 lib/auth.ts 把魔法链接追加写入该文件
 *   （两侧默认值均为 .next/e2e-login-url.txt，相对 dev server cwd）
 *
 * 登录方案：Playwright 读不到 dev server 控制台，魔法链接由
 * lib/auth.ts DEV 分支落盘，本 spec 轮询取最新一条后 page.goto
 * 完成「点链接」登录；读到即清空文件，防止链接串用例。
 */

// 无库守卫：无 DATABASE_URL 的环境（纯静态构建验收波次）整个文件 skip
test.skip(!process.env.DATABASE_URL, "需要 DATABASE_URL");

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
async function takeLatestLoginUrl(): Promise<string> {
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

test("主链路：登录 → 上传 → 详情 → 评论 → 列表", async ({ page }) => {
  // 时间戳唯一化：邮箱 / Skill 名 / 正文 / 评论，保证每轮运行互不干扰
  // （新邮箱 = 新用户，天然绕开登录 60s 频控 / 评论 60s 频控 / 上传 10 分钟限流）
  const ts = Date.now();
  const email = `e2e-${ts}@test.local`;
  const emailPrefix = `e2e-${ts}`;
  const skillName = `E2E测试Skill-${ts}`;
  const description = `E2E端到端链路验证Skill-${ts}`;
  const bodyHeading = `E2E正文标题${ts}`;
  const bodyText = `这是E2E端到端链路验证正文（${ts}）`;
  const commentText = `E2E 测试评论 ${ts}`;

  // 完整 frontmatter（name/description/category）+ 正文，能通过 parseSkillMd 校验
  const markdown = [
    "---",
    `name: ${skillName}`,
    `description: ${description}`,
    "category: 其他",
    "---",
    "",
    `## ${bodyHeading}`,
    "",
    bodyText,
    "",
  ].join("\n");

  await test.step("登录页提交邮箱，出现「登录链接已发送」", async () => {
    await page.goto("/login");
    await page.getByLabel("邮箱地址").fill(email);
    await page.getByRole("button", { name: "发送登录链接" }).click();
    await expect(page.getByText("登录链接已发送到你的邮箱")).toBeVisible();
  });

  await test.step("轮询取魔法链接并访问，页头出现邮箱前缀", async () => {
    const loginUrl = await takeLatestLoginUrl();
    // 魔法链接 = /api/auth/callback/email?token=…，验证成功后落回 returnUrl（默认 /）
    await page.goto(loginUrl);
    // site-header 用户名 span（邮箱前缀）；header 是 body 直接子级，role=banner
    await expect(page.getByRole("banner").getByText(emailPrefix)).toBeVisible();
  });

  await test.step("上传页：填 frontmatter 正文、分类选「其他」，提交跳详情", async () => {
    await page.goto("/upload");
    await page.getByLabel("Markdown 源码").fill(markdown);
    // 分类 Select（Base UI）：trigger role=combobox，弹出层 option
    await page.getByRole("combobox", { name: "选择分类" }).click();
    await page.getByRole("option", { name: "其他" }).click();
    await expect(
      page.getByRole("combobox", { name: "选择分类" }),
    ).toContainText("其他");
    await page.getByRole("button", { name: "发布 Skill" }).click();
    // server action 成功后 router.push('/skills/<slug>')
    await page.waitForURL(/\/skills\/[^/]+$/);
    await expect(
      page.getByRole("heading", { level: 1, name: skillName }),
    ).toBeVisible();
    // 正文经 MarkdownView 渲染（frontmatter 已剥离）
    await expect(
      page.getByRole("heading", { name: bodyHeading }),
    ).toBeVisible();
    await expect(page.getByText(bodyText)).toBeVisible();
  });

  await test.step("详情页评论：提交后列表出现该评论", async () => {
    // 登录后评论表单可见（未登录显示的是「登录后参与评论」链接）
    await page.getByLabel("评论内容").fill(commentText);
    await page.getByRole("button", { name: "发布评论" }).click();
    // 提交成功后 optimistic 插入列表头部
    await expect(
      page.getByRole("listitem").filter({ hasText: commentText }),
    ).toBeVisible();
  });

  await test.step("/skills 列表出现刚上传的 Skill（revalidate 生效）", async () => {
    await page.goto("/skills");
    // SkillCard 整卡链接 aria-label="查看 <name>"；列表按 createdAt 倒序，新 Skill 在首页
    await expect(
      page.getByRole("link", { name: `查看 ${skillName}` }),
    ).toBeVisible();
  });
});
