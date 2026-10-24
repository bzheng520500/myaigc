import { test, expect } from "@playwright/test";
import { loginViaLink } from "./helpers/login";

/**
 * Phase 1 E2E 主链路（Task 14）：
 * 登录 → 上传 → 详情 → 评论 → /skills 列表 revalidate。
 *
 * 运行前置（连库执行由控制器统一跑，本 spec 只做声明）：
 * - DATABASE_URL：Neon 连接串（未设置时整个文件 skip，见顶层守卫）
 * - AUTH_DEV_MODE / E2E_TOKEN_URL_FILE 及魔法链接落盘登录方案
 *   见 tests/e2e/helpers/login.ts（Phase 2 Task 3 抽出的共享 helpers）
 */

// 无库守卫：无 DATABASE_URL 的环境（纯静态构建验收波次）整个文件 skip
test.skip(!process.env.DATABASE_URL, "需要 DATABASE_URL");

test("主链路：登录 → 上传 → 详情 → 评论 → 列表", async ({ page }) => {
  // 时间戳唯一化：邮箱 / Skill 名 / 正文 / 评论，保证每轮运行互不干扰
  // （新邮箱 = 新用户，天然绕开登录 60s 频控 / 评论 60s 频控 / 上传 10 分钟限流）
  const ts = Date.now();
  const email = `e2e-${ts}@test.local`;
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

  await test.step("登录：提交邮箱并访问魔法链接，页头出现邮箱前缀", async () => {
    await loginViaLink(page, email);
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
