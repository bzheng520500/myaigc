import { test, expect } from "@playwright/test";
import { eq } from "drizzle-orm";
import { db } from "../../lib/db";
import { forums, replies, threads } from "../../lib/db/schema";
import { ensureLocalDb } from "./helpers/d1";
import { loginViaLink } from "./helpers/login";

/**
 * 论坛发帖 / 回复链路 E2E（Phase 2 Task 3，写不跑——运行由控制器统一执行）：
 * middleware 保护 /forum/new → 登录 → 发帖页选板块/标题/正文 → 帖子页断言
 * → 回复两次（30s 限流文案展示 + 等待窗口后重试成功）→ 板块页见帖。
 *
 * 运行前置：本地 D1（`npm run db:migrate:local` 后设 `D1_LOCAL_TEST=1`）、
 * AUTH_DEV_MODE=1（魔法链接落盘登录，见 tests/e2e/helpers/login.ts）；
 * 未设置 D1_LOCAL_TEST 时整个文件 skip（与 phase1.spec.ts 同模式）。
 * 真实连库在 Phase E 接入。
 *
 * 数据策略：时间戳唯一化；探针板块直插库（beforeAll），发帖用户经
 * 魔法链接登录创建（新邮箱 = 新用户，天然绕开登录 60s 频控与发帖
 * 5 分钟限流）；afterAll 按 replies → threads → forums 外键逆序
 * 清理，魔法链接登录用户保留无妨（brief 授权）。
 */

// 无库守卫：未启用本地 D1 连库测试的环境整个文件 skip
test.skip(process.env.D1_LOCAL_TEST !== "1", "需要 D1_LOCAL_TEST=1（本地 D1）");

const uniq = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const forumSlug = `p2e2-post-${uniq}`;
const forumName = `E2E发帖板块-${uniq}`;

let forumId: string;
/** 主链路发帖成功后回填（afterAll 清理用；失败时为空跳过 thread 清理） */
let threadId: string | null = null;

// 直插库前注入本地 D1 绑定：必须是本文件第一个 beforeAll（钩子按注册序执行）
test.beforeAll(ensureLocalDb);

test.beforeAll(async () => {
  const [forum] = await db
    .insert(forums)
    .values({
      slug: forumSlug,
      name: forumName,
      description: "E2E 发帖探针板块",
      sortOrder: 900004,
    })
    .returning({ id: forums.id });
  forumId = forum.id;
});

test.afterAll(async () => {
  // 清理顺序：replies → threads → forums（外键依赖）；登录用户保留无妨
  if (threadId) {
    await db.delete(replies).where(eq(replies.threadId, threadId));
    await db.delete(threads).where(eq(threads.id, threadId));
  }
  await db.delete(forums).where(eq(forums.id, forumId));
});

test("未登录直访 /forum/new 重定向登录页（middleware 保护）", async ({
  page,
}) => {
  await page.goto("/forum/new");
  // middleware 302 → /login?returnUrl=%2Fforum%2Fnew（goto 已跟随重定向）
  await expect(page).toHaveURL(/\/login\?returnUrl=%2Fforum%2Fnew$/);
  await expect(
    page.getByRole("button", { name: "发送登录链接" }),
  ).toBeVisible();
});

test("主链路：登录 → 发帖 → 回复两次 → 楼层 #1 #2 → 板块页见帖", async ({
  page,
}) => {
  const ts = Date.now();
  const email = `e2e-post-${ts}@test.local`;
  const title = `E2E发帖标题-${ts}`;
  const bodyHeading = `E2E发帖正文标题${ts}`;
  const bodyText = `这是E2E发帖正文（${ts}）`;
  const reply1 = `E2E第一条回复-${ts}`;
  const reply2 = `E2E第二条回复-${ts}`;

  await test.step("魔法链接登录（新用户）", async () => {
    await loginViaLink(page, email);
  });

  await test.step("发帖页：选板块/标题/正文，提交跳帖子页", async () => {
    await page.goto("/forum/new");
    await page.getByLabel("帖子标题").fill(title);
    // 板块 Select（Base UI）：trigger role=combobox，弹出层 option
    await page.getByRole("combobox", { name: "选择板块" }).click();
    await page.getByRole("option", { name: forumName }).click();
    await expect(
      page.getByRole("combobox", { name: "选择板块" }),
    ).toContainText(forumName);
    await page
      .getByLabel("Markdown 源码")
      .fill(`# ${bodyHeading}\n\n${bodyText}`);
    await page.getByRole("button", { name: "发布帖子" }).click();
    // server action 成功后 router.push('/forum/<slug>/<uuid>')
    await page.waitForURL(/\/forum\/[^/]+\/[0-9a-f-]{36}$/);
    threadId = page.url().split("/").pop() ?? null;
    await expect(
      page.getByRole("heading", { level: 1, name: title }),
    ).toBeVisible();
    // 正文经 MarkdownView 渲染
    await expect(
      page.getByRole("heading", { name: bodyHeading }),
    ).toBeVisible();
    await expect(page.getByText(bodyText)).toBeVisible();
  });

  await test.step("回复两次：第一条成功、限流文案展示、窗口过后第二条成功", async () => {
    // 第一条：router.refresh() 后服务端重取楼层，#1 出现
    await page.getByLabel("回复内容").fill(reply1);
    await page.getByRole("button", { name: "发布回复" }).click();
    const floors = page.locator("[data-floor-number]");
    await expect(floors).toHaveCount(1);
    await expect(floors).toHaveText(["#1"]);
    await expect(page.getByText(reply1)).toBeVisible();
    // 成功后表单清空
    await expect(page.getByLabel("回复内容")).toHaveValue("");

    // 30s 限流窗口内立即再发：中文限流文案照实展示（role=alert）
    await page.getByLabel("回复内容").fill(reply2);
    await page.getByRole("button", { name: "发布回复" }).click();
    await expect(page.getByRole("alert")).toHaveText("回复太频繁，请稍后再试");

    // 等限流窗口（30s）过后重试，楼层 #2 出现
    await page.waitForTimeout(31_000);
    await page.getByLabel("回复内容").fill(reply2);
    await page.getByRole("button", { name: "发布回复" }).click();
    await expect(floors).toHaveCount(2);
    await expect(floors).toHaveText(["#1", "#2"]);
    await expect(page.getByText(reply2)).toBeVisible();
  });

  await test.step("板块页列表出现该帖", async () => {
    await page.goto(`/forum/${forumSlug}`);
    await expect(
      page.locator("[data-thread-title]", { hasText: title }),
    ).toBeVisible();
  });
});
