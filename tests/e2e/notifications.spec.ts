import { test, expect } from "@playwright/test";
import { eq, inArray } from "drizzle-orm";
import { db } from "../../lib/db";
import { forums, notifications, replies, threads, users } from "../../lib/db/schema";
import { ensureLocalDb } from "./helpers/d1";
import { loginViaLink } from "./helpers/login";

/**
 * 通知链路 E2E（Phase 3 Task 2，写不跑——运行由控制器统一执行）：
 * 双账号 A 发帖 → B 回复 + 点赞 → A 铃铛红点 ≥2 → 通知中心见条目 →
 * 点击跳源消除一条红点 → 全部已读 → 铃铛红点清零。
 *
 * 运行前置：本地 D1（`npm run db:migrate:local` 后设 `D1_LOCAL_TEST=1`）、
 * AUTH_DEV_MODE=1（魔法链接落盘登录，见 tests/e2e/helpers/login.ts）；
 * 未设置 D1_LOCAL_TEST 时整个文件 skip（与 forum-post.spec.ts 同模式）。
 * 真实连库在 Phase E 接入。
 *
 * 双账号：同一 page 串行 loginViaLink 两次（不同邮箱），B 的 session
 * cookie 覆盖 A 的；A 二次登录受同邮箱 60s 发信频控
 * （lib/auth.ts RESEND_WINDOW_SEC），按首登时间戳补足等待窗口。
 *
 * 数据策略：时间戳唯一化；探针板块直插库（beforeAll），发帖用户经
 * 魔法链接登录创建（新邮箱 = 新用户，绕开登录 60s 频控与发帖 5 分钟
 * 限流）；afterAll 按 notifications → replies → threads → forums
 * 外键逆序清理（通知按 A/B 用户 id 删，登录用户保留无妨，brief 授权）。
 */

// 无库守卫：未启用本地 D1 连库测试的环境整个文件 skip
test.skip(process.env.D1_LOCAL_TEST !== "1", "需要 D1_LOCAL_TEST=1（本地 D1）");

const uniq = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const forumSlug = `p3b2-notify-${uniq}`;
const forumName = `E2E通知板块-${uniq}`;

let forumId: string;
/** A 发帖成功后回填（afterAll 清理用；失败时为空跳过 thread 清理） */
let threadId: string | null = null;
/** 双账号邮箱（afterAll 查用户 id 删通知用） */
let emailA = `e2e-notify-a-${uniq}@test.local`;
const emailB = `e2e-notify-b-${uniq}@test.local`;

// 直插库前注入本地 D1 绑定：必须是本文件第一个 beforeAll（钩子按注册序执行）
test.beforeAll(ensureLocalDb);

test.beforeAll(async () => {
  const [forum] = await db
    .insert(forums)
    .values({
      slug: forumSlug,
      name: forumName,
      description: "E2E 通知探针板块",
      sortOrder: 900006,
    })
    .returning({ id: forums.id });
  forumId = forum.id;
});

test.afterAll(async () => {
  // 清理顺序：notifications → replies → threads → forums（外键依赖）；
  // 登录用户保留无妨（先删其通知行，不影响外键）
  const owners = await db
    .select({ id: users.id })
    .from(users)
    .where(inArray(users.email, [emailA, emailB]));
  if (owners.length > 0) {
    await db.delete(notifications).where(
      inArray(
        notifications.userId,
        owners.map((u) => u.id),
      ),
    );
  }
  if (threadId) {
    await db.delete(replies).where(eq(replies.threadId, threadId));
    await db.delete(threads).where(eq(threads.id, threadId));
  }
  await db.delete(forums).where(eq(forums.id, forumId));
});

test("未登录直访 /notifications 重定向登录页（middleware 保护）", async ({
  page,
}) => {
  await page.goto("/notifications");
  // middleware 302 → /login?returnUrl=%2Fnotifications（goto 已跟随重定向）
  await expect(page).toHaveURL(/\/login\?returnUrl=%2Fnotifications$/);
  await expect(
    page.getByRole("button", { name: "发送登录链接" }),
  ).toBeVisible();
});

test("主链路：A 发帖 → B 回复+点赞 → A 铃铛红点 2 → 点击跳源消红点 → 全部已读", async ({
  page,
}) => {
  const ts = Date.now();
  emailA = `e2e-notify-a-${ts}@test.local`;
  const title = `E2E通知主帖-${ts}`;
  const replyText = `E2E通知回复-${ts}`;

  await test.step("A 魔法链接登录并发帖", async () => {
    await loginViaLink(page, emailA);
    await page.goto("/forum/new");
    await page.getByLabel("帖子标题").fill(title);
    await page.getByRole("combobox", { name: "选择板块" }).click();
    await page.getByRole("option", { name: forumName }).click();
    await page
      .getByLabel("Markdown 源码")
      .fill(`# E2E通知主帖正文\n\n${title}`);
    await page.getByRole("button", { name: "发布帖子" }).click();
    await page.waitForURL(/\/forum\/[^/]+\/[0-9a-f-]{36}$/);
    threadId = page.url().split("/").pop() ?? null;
  });

  // A 首登时间戳：二次登录须在 60s 发信频控窗口（+1s 余量）之外
  const firstLoginAt = Date.now();

  await test.step("B 登录（覆盖 session）→ 回复 + 点赞主楼", async () => {
    await loginViaLink(page, emailB);
    if (!threadId) throw new Error("A 发帖失败：threadId 未回填");
    await page.goto(`/forum/${forumSlug}/${threadId}`);

    // 回复（B 首条回复无限流问题）→ A 收 thread_reply
    await page.getByLabel("回复内容").fill(replyText);
    await page.getByRole("button", { name: "发布回复" }).click();
    await expect(page.getByText(replyText)).toBeVisible();

    // 点赞主楼（header 内 LikeButton）→ A 收 like
    const mainLike = page
      .locator("header")
      .getByRole("button", { name: "点赞" });
    await mainLike.click();
    await expect(mainLike).toHaveAttribute("aria-pressed", "true");
  });

  await test.step("A 重新登录（等 60s 发信频控窗口）→ 铃铛红点 2", async () => {
    const elapsed = Date.now() - firstLoginAt;
    const remaining = 61_000 - elapsed;
    if (remaining > 0) {
      await page.waitForTimeout(remaining);
    }
    await loginViaLink(page, emailA);

    // 铃铛红点：B 的回复 + 点赞 → thread_reply 与 like 各一条（不同
    // type 不合并）→ unread=2；pathname 变化触发 refetch，auto-retry
    await expect(
      page.getByRole("link", { name: "通知，2 条未读" }),
    ).toBeVisible();
    await expect(page.locator("[data-notification-count]")).toHaveText("2");
  });

  await test.step("通知中心：两条未读 + 类型文案 + 蓝点", async () => {
    await page.goto("/notifications");
    await expect(page.locator("[data-notification-id]")).toHaveCount(2);
    await expect(page.getByText("回复了你的帖子")).toBeVisible();
    await expect(page.getByText("赞了你的内容")).toBeVisible();
    await expect(page.getByText("2 条未读")).toBeVisible();
    await expect(page.locator("[data-unread-dot]")).toHaveCount(2);
  });

  await test.step("点击最新一条（like，created_at 倒序第一）→ 跳源页 → 红点减一", async () => {
    await page.locator("[data-notification-id]").first().click();
    // like 源（thread）→ 帖子详情页
    await page.waitForURL(/\/forum\/[^/]+\/[0-9a-f-]{36}$/);
    await expect(
      page.getByRole("heading", { level: 1, name: title }),
    ).toBeVisible();
    // 标读后 pathname 变化触发铃铛 refetch：2 → 1
    await expect(page.locator("[data-notification-count]")).toHaveText("1");
  });

  await test.step("全部已读：蓝点清零 + 铃铛红点消失", async () => {
    await page.goto("/notifications");
    await page.getByRole("button", { name: "全部已读" }).click();
    await expect(page.getByText("没有未读通知")).toBeVisible();
    await expect(page.locator("[data-unread-dot]")).toHaveCount(0);

    // 路由切换触发铃铛 refetch：红点归零（data-notification-bell=none）
    await page.goto("/");
    await expect(
      page.getByRole("link", { name: "通知", exact: true }),
    ).toHaveAttribute("data-notification-bell", "none");
  });
});
