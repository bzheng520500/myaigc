import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { forums, replies, threads, users } from "@/lib/db/schema";
import { simulateNoDatabase } from "@/tests/helpers/db";
import {
  getForumBySlug,
  getThreadById,
  listForums,
  listLatestThreads,
  listReplies,
  listThreads,
  THREADS_PAGE_SIZE,
} from "@/lib/queries/forum";

/**
 * 论坛查询（Phase 2 Task 1）。
 *
 * - 纯逻辑：THREADS_PAGE_SIZE 常量、无库（D1 绑定不可用）兜底返回空
 * - 连库（本地 D1）：`npm run db:migrate:local` 后设 `D1_LOCAL_TEST=1`；
 *   探针数据：2 板块（sort 递增）+ 4 帖（置顶 / 双排序序不同 / hidden）+ 3 回复（1 hidden）
 *
 * cacheLife 在 Next cache scope 之外会 throw（vitest 无该运行时），
 * mock 成 no-op（与 skills.test.ts 同模式）。
 */
vi.mock("next/cache", () => ({
  cacheLife: () => {},
}));

/* ---------------------------------------------------------------- */
/* 纯逻辑：常量与兜底                                                 */
/* ---------------------------------------------------------------- */

describe("THREADS_PAGE_SIZE 常量", () => {
  it("板块页每页固定 20 条", () => {
    expect(THREADS_PAGE_SIZE).toBe(20);
  });
});

describe("无库兜底（D1 绑定不可用，内部短路，不发起查询）", () => {
  it("listForums 返回空数组", async () => {
    const restore = simulateNoDatabase();
    try {
      await expect(listForums()).resolves.toEqual([]);
    } finally {
      restore();
    }
  });

  it("listThreads 返回空结果", async () => {
    const restore = simulateNoDatabase();
    try {
      await expect(
        listThreads("creation", { sort: "last_reply" }),
      ).resolves.toEqual({ items: [], total: 0 });
      await expect(
        listThreads("creation", { sort: "created", page: 3 }),
      ).resolves.toEqual({ items: [], total: 0 });
    } finally {
      restore();
    }
  });

  it("getThreadById 返回 null", async () => {
    const restore = simulateNoDatabase();
    try {
      await expect(
        getThreadById("0b2b0e35-0a44-4a5e-a3af-6d3349cd00f1"),
      ).resolves.toBeNull();
    } finally {
      restore();
    }
  });

  it("listReplies 返回空数组", async () => {
    const restore = simulateNoDatabase();
    try {
      await expect(
        listReplies("0b2b0e35-0a44-4a5e-a3af-6d3349cd00f1"),
      ).resolves.toEqual([]);
    } finally {
      restore();
    }
  });

  it("listLatestThreads 返回空数组", async () => {
    const restore = simulateNoDatabase();
    try {
      await expect(listLatestThreads(10)).resolves.toEqual([]);
      await expect(listLatestThreads(NaN)).resolves.toEqual([]);
    } finally {
      restore();
    }
  });

  it("getForumBySlug 返回 null", async () => {
    const restore = simulateNoDatabase();
    try {
      await expect(getForumBySlug("creation")).resolves.toBeNull();
    } finally {
      restore();
    }
  });
});

/* ---------------------------------------------------------------- */
/* 连库：2 板块 + 4 帖（置顶 1 / 双排序序相反 2 / hidden 1）+ 3 回复    */
/* ---------------------------------------------------------------- */

describe.skipIf(!process.env.D1_LOCAL_TEST)(
  "listForums / listThreads / getThreadById / listReplies 连库查询",
  () => {
    const uniq = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const slugA = `p2q-forum-a-${uniq}`; // sortOrder 较小
    const slugB = `p2q-forum-b-${uniq}`; // sortOrder 较大
    // 相对 now 的时间偏移（秒）：保证两种排序的先后相反
    // P1 置顶：created -30s，lastReply -20s
    // P2 常规：created -20s，lastReply -5s（最后回复最新）
    // P3 常规：created -10s，lastReply -10s（发布更新）
    // P4 hidden
    const sec = (s: number) => new Date(Date.now() - s * 1000);

    let forumAId: string;
    let forumBId: string;
    let userId: string;
    let threadIds: string[];
    let pinnedId: string;
    let regularNewerReplyId: string;
    let regularNewerCreatedId: string;

    beforeAll(async () => {
      const [user] = await db
        .insert(users)
        .values({ name: `任务二一作者-${uniq}`, email: `p2q-author-${uniq}@test.local` })
        .returning({ id: users.id });
      userId = user.id;

      const [f1, f2] = await db
        .insert(forums)
        .values([
          { slug: slugA, name: `板块甲-${uniq}`, description: "探针", sortOrder: 900001 },
          { slug: slugB, name: `板块乙-${uniq}`, description: "探针", sortOrder: 900002 },
        ])
        .returning({ id: forums.id });
      forumAId = f1.id;
      forumBId = f2.id;

      const [p1, p2, p3, p4] = await db
        .insert(threads)
        .values([
          {
            forumId: forumAId,
            authorId: userId,
            title: `置顶帖-${uniq}`,
            contentMd: "# 置顶",
            isPinned: true,
            createdAt: sec(30),
            lastReplyAt: sec(20),
          },
          {
            forumId: forumAId,
            authorId: userId,
            title: `最后回复最新帖-${uniq}`,
            contentMd: "# 回复新",
            createdAt: sec(20),
            lastReplyAt: sec(5),
          },
          {
            forumId: forumAId,
            authorId: userId,
            title: `发布时间最新帖-${uniq}`,
            contentMd: "# 发布新",
            createdAt: sec(10),
            lastReplyAt: sec(10),
          },
          {
            forumId: forumAId,
            authorId: userId,
            title: `隐藏帖-${uniq}`,
            contentMd: "# 隐藏",
            status: "hidden",
          },
        ])
        .returning({ id: threads.id });
      threadIds = [p1.id, p2.id, p3.id, p4.id];
      pinnedId = p1.id;
      regularNewerReplyId = p2.id;
      regularNewerCreatedId = p3.id;

      // p2 下 3 条回复：visible / hidden / visible → listReplies 只回 visible
      await db.insert(replies).values([
        {
          threadId: p2.id,
          authorId: userId,
          contentMd: "一楼",
          floorNumber: 1,
        },
        {
          threadId: p2.id,
          authorId: userId,
          contentMd: "被隐藏的二楼",
          floorNumber: 2,
          status: "hidden",
        },
        {
          threadId: p2.id,
          authorId: userId,
          contentMd: "三楼",
          floorNumber: 3,
        },
      ]);
    });

    afterAll(async () => {
      // 清理顺序：replies → threads → forums → users（外键依赖）
      await db.delete(replies).where(inArray(replies.threadId, threadIds));
      await db.delete(threads).where(inArray(threads.id, threadIds));
      await db.delete(forums).where(inArray(forums.id, [forumAId, forumBId]));
      await db.delete(users).where(eq(users.id, userId));
    });

    it("listForums 按 sort_order 升序返回两探针板块", async () => {
      const rows = await listForums();
      const idxA = rows.findIndex((f) => f.slug === slugA);
      const idxB = rows.findIndex((f) => f.slug === slugB);
      expect(idxA).toBeGreaterThanOrEqual(0);
      expect(idxB).toBeGreaterThanOrEqual(0);
      expect(idxA).toBeLessThan(idxB);
      // 投影字段齐备（不含 createdAt 等多余列也无妨，关键是消费字段在）
      const a = rows[idxA];
      expect(a).toMatchObject({
        slug: slugA,
        name: `板块甲-${uniq}`,
        threadCount: expect.any(Number),
        replyCount: expect.any(Number),
      });
    });

    it("listThreads sort=last_reply：置顶优先，其余按最后回复倒序，hidden 排除", async () => {
      const { items, total } = await listThreads(slugA, { sort: "last_reply" });
      expect(total).toBe(3);
      expect(items.map((t) => t.id)).toEqual([
        pinnedId,
        regularNewerReplyId,
        regularNewerCreatedId,
      ]);
      // 作者名来自 join users
      expect(items[0]?.authorName).toBe(`任务二一作者-${uniq}`);
      expect(items[0]?.isPinned).toBe(true);
    });

    it("listThreads sort=created：置顶优先，其余按发布时间倒序", async () => {
      const { items } = await listThreads(slugA, { sort: "created" });
      expect(items.map((t) => t.id)).toEqual([
        pinnedId,
        regularNewerCreatedId,
        regularNewerReplyId,
      ]);
    });

    it("listThreads 分页越界：items 空但 total 不变", async () => {
      const { items, total } = await listThreads(slugA, {
        sort: "last_reply",
        page: 99,
      });
      expect(total).toBe(3);
      expect(items).toEqual([]);
    });

    it("listThreads 只圈定该板块：另一板块无探针帖", async () => {
      const { items, total } = await listThreads(slugB, { sort: "last_reply" });
      expect(total).toBe(0);
      expect(items).toEqual([]);
    });

    it("getThreadById：正常帖返回整行 + 作者名 + 板块 slug", async () => {
      const row = await getThreadById(regularNewerReplyId);
      expect(row).not.toBeNull();
      expect(row?.thread.id).toBe(regularNewerReplyId);
      expect(row?.thread.contentMd).toBe("# 回复新");
      expect(row?.thread.authorId).toBe(userId);
      expect(row?.authorName).toBe(`任务二一作者-${uniq}`);
      expect(row?.forumSlug).toBe(slugA);
    });

    it("getThreadById：hidden 帖与不存在的 id 都返回 null", async () => {
      const hiddenId = threadIds[3];
      expect(await getThreadById(hiddenId)).toBeNull();
      expect(
        await getThreadById("0b2b0e35-0a44-4a5e-a3af-6d3349cd00f1"),
      ).toBeNull();
    });

    it("listReplies：floor 升序且只含 visible（hidden 二楼被过滤）", async () => {
      const rows = await listReplies(regularNewerReplyId);
      expect(rows.map((r) => r.floorNumber)).toEqual([1, 3]);
      expect(rows.every((r) => r.status === "visible")).toBe(true);
      expect(rows[0]?.contentMd).toBe("一楼");
      expect(rows[0]?.authorName).toBe(`任务二一作者-${uniq}`);
    });

    it("listLatestThreads：last_reply 倒序、hidden 排除、带板块名", async () => {
      // limit 放大：库中可能存在其他帖，断言只圈探针相对顺序
      const rows = await listLatestThreads(50);
      const probe = rows.filter((t) => threadIds.includes(t.id));
      // lastReplyAt 探针序：P2(-5s) → P3(-10s) → P1(-20s)；P4 hidden 不出现
      expect(probe.map((t) => t.id)).toEqual([
        regularNewerReplyId,
        regularNewerCreatedId,
        pinnedId,
      ]);
      expect(rows.some((t) => t.id === threadIds[3])).toBe(false);
      // join 板块：forumSlug / forumName 齐备
      expect(probe[0]).toMatchObject({
        forumSlug: slugA,
        forumName: `板块甲-${uniq}`,
        title: `最后回复最新帖-${uniq}`,
      });
    });

    it("listLatestThreads：limit 截断条数", async () => {
      const rows = await listLatestThreads(2);
      expect(rows.length).toBeLessThanOrEqual(2);
    });

    it("getForumBySlug：命中探针板块返回行，不存在返回 null", async () => {
      const hit = await getForumBySlug(slugA);
      expect(hit).not.toBeNull();
      expect(hit).toMatchObject({
        slug: slugA,
        name: `板块甲-${uniq}`,
        description: "探针",
        threadCount: expect.any(Number),
        replyCount: expect.any(Number),
      });
      expect(await getForumBySlug(`p2q-不存在-${uniq}`)).toBeNull();
    });
  },
);
