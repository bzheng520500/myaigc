import { test, expect } from "@playwright/test";
import { eq, inArray } from "drizzle-orm";
import { db } from "../../lib/db";
import { forums, replies, threads, users } from "../../lib/db/schema";
import { ensureLocalDb } from "./helpers/d1";

/**
 * 论坛浏览链路 E2E（Phase 2 Task 2，写不跑——运行由控制器统一执行）：
 * 论坛首页板块卡片 → 板块页排序 Tab 与帖子列表 → 帖子页楼层递增 → hidden 帖 404。
 *
 * Review Focus 对照：
 * - #4 长标题不破版：100 字标题帖断言标题元素含 truncate class
 * - #5 hidden 帖直连：notFound() 返回 404 状态码
 *
 * 运行前置：本地 D1（`npm run db:migrate:local` 后设 `D1_LOCAL_TEST=1`；
 * 未设置时整个文件 skip；真实连库在 Phase E 接入）。
 * 探针数据直插库（drizzle），时间戳唯一化，afterAll 按外键逆序清理。
 */

// 无库守卫：未启用本地 D1 连库测试的环境整个文件 skip（与 phase1.spec.ts 同模式）
test.skip(process.env.D1_LOCAL_TEST !== "1", "需要 D1_LOCAL_TEST=1（本地 D1）");

const uniq = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const forumSlug = `p2e2-forum-${uniq}`;
const forumName = `E2E浏览板块-${uniq}`;
/** 100 字标题（threads.title 应用层上限，直插库不校验） */
const longTitle = "超".repeat(100);

let forumId: string;
let userId: string;
let threadIds: string[];
let longThreadId: string;
let hiddenThreadId: string;

// 直插库前注入本地 D1 绑定：必须是本文件第一个 beforeAll（钩子按注册序执行）
test.beforeAll(ensureLocalDb);

test.beforeAll(async () => {
  const [user] = await db
    .insert(users)
    .values({ name: `E2E浏览作者-${uniq}`, email: `p2e2-author-${uniq}@test.local` })
    .returning({ id: users.id });
  userId = user.id;

  const [forum] = await db
    .insert(forums)
    .values({ slug: forumSlug, name: forumName, description: "E2E 浏览探针板块", sortOrder: 900003 })
    .returning({ id: forums.id });
  forumId = forum.id;

  const [longThread, hiddenThread] = await db
    .insert(threads)
    .values([
      {
        forumId: forum.id,
        authorId: userId,
        title: longTitle,
        contentMd: "# 百字长标题帖正文",
      },
      {
        forumId: forum.id,
        authorId: userId,
        title: `E2E隐藏帖-${uniq}`,
        contentMd: "# 隐藏帖正文",
        status: "hidden",
      },
    ])
    .returning({ id: threads.id });
  threadIds = [longThread.id, hiddenThread.id];
  longThreadId = longThread.id;
  hiddenThreadId = hiddenThread.id;

  // 长标题帖 3 条 visible 回复：楼层 1 → 3 递增断言
  await db.insert(replies).values(
    [1, 2, 3].map((floor) => ({
      threadId: longThread.id,
      authorId: userId,
      contentMd: `第${floor}楼回复`,
      floorNumber: floor,
    })),
  );
});

test.afterAll(async () => {
  // 清理顺序：replies → threads → forums → users（外键依赖）
  await db.delete(replies).where(eq(replies.threadId, longThreadId));
  await db.delete(threads).where(inArray(threads.id, threadIds));
  await db.delete(forums).where(eq(forums.id, forumId));
  await db.delete(users).where(eq(users.id, userId));
});

test("论坛首页：板块卡片渲染", async ({ page }) => {
  await page.goto("/forum");
  await expect(page.getByRole("heading", { name: "论坛" })).toBeVisible();
  // 整卡链 aria-label「进入{板块名}」唯一定位探针板块卡
  await expect(
    page.getByRole("link", { name: `进入${forumName}` }),
  ).toBeVisible();
});

test("板块页：排序 Tab 与帖子列表，100 字标题单行截断", async ({ page }) => {
  await page.goto(`/forum/${forumSlug}`);

  // 排序 Tab：两个链接式切换可见，默认「最后回复」高亮
  const sortNav = page.getByRole("navigation", { name: "帖子排序" });
  await expect(sortNav.getByText("最后回复")).toBeVisible();
  await expect(sortNav.getByText("最新发布")).toBeVisible();

  // Review Focus #4：100 字标题渲染且标题元素含 truncate（不破版）
  const titleLink = page.locator("[data-thread-title]", { hasText: longTitle });
  await expect(titleLink).toBeVisible();
  await expect(titleLink).toHaveClass(/truncate/);

  // hidden 帖不出现在列表
  await expect(page.getByText(`E2E隐藏帖-${uniq}`)).toHaveCount(0);
});

test("帖子页：楼层号从 1 递增", async ({ page }) => {
  await page.goto(`/forum/${forumSlug}/${longThreadId}`);
  await expect(
    page.getByRole("heading", { name: longTitle }),
  ).toBeVisible();

  const floors = page.locator("[data-floor-number]");
  await expect(floors).toHaveCount(3);
  await expect(floors).toHaveText(["#1", "#2", "#3"]);
});

test("hidden 帖直连返回 404（Review Focus #5）", async ({ page }) => {
  const res = await page.goto(`/forum/${forumSlug}/${hiddenThreadId}`);
  expect(res?.status()).toBe(404);
});
