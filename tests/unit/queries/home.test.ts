import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { forums, threads, users } from "@/lib/db/schema";
import { getHomeData, getHotThreads } from "@/lib/queries/home";

/**
 * 首页查询（Phase 4 Task 1：热帖）。
 *
 * - 纯逻辑：无 DATABASE_URL 兜底（stub 后直接调用）
 * - 连库：Neon 未就位（无 DATABASE_URL）时自动跳过；
 *   探针数据：1 板块 + 5 帖（30 天内不同回复数 3 条 / 40 天前高回复老帖
 *   1 条 / hidden 高回复 1 条）
 *
 * cacheLife 在 Next cache scope 之外会 throw（vitest 无该运行时），
 * mock 成 no-op（与 forum.test.ts 同模式）。
 */
vi.mock("next/cache", () => ({
  cacheLife: () => {},
}));

/* ---------------------------------------------------------------- */
/* 纯逻辑：无 DATABASE_URL 兜底                                       */
/* ---------------------------------------------------------------- */

describe("无 DATABASE_URL 兜底（内部短路，不发起查询）", () => {
  it("getHotThreads 返回空数组", async () => {
    vi.stubEnv("DATABASE_URL", "");
    try {
      await expect(getHotThreads()).resolves.toEqual([]);
      await expect(getHotThreads(3)).resolves.toEqual([]);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("getHomeData 返回空数据且含 hotThreads 字段", async () => {
    vi.stubEnv("DATABASE_URL", "");
    try {
      const data = await getHomeData();
      expect(data.hotThreads).toEqual([]);
      expect(data.stats).toEqual({
        skills: 0,
        prompts: 0,
        tutorials: 0,
        threads: 0,
      });
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

/* ---------------------------------------------------------------- */
/* 连库：30 天内 reply desc 排序 + 老帖/hidden 排除                     */
/* ---------------------------------------------------------------- */

describe.skipIf(!process.env.DATABASE_URL)(
  "getHotThreads / getHomeData 连库查询",
  () => {
    const uniq = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const slug = `p4q-hot-${uniq}`;
    // 相对 now 的时间偏移
    const ago = (ms: number) => new Date(Date.now() - ms);
    const MIN = 60 * 1000;
    const DAY = 24 * 60 * MIN;

    let forumId: string;
    let userId: string;
    let threadIds: string[];
    let hot1Id: string;
    let hot2Id: string;
    let hot3Id: string;
    let oldId: string;
    let hiddenId: string;

    beforeAll(async () => {
      const [user] = await db
        .insert(users)
        .values({ name: `热帖作者-${uniq}`, email: `p4q-hot-${uniq}@test.local` })
        .returning({ id: users.id });
      userId = user.id;

      const [forum] = await db
        .insert(forums)
        .values({ slug, name: `热帖板块-${uniq}`, sortOrder: 900003 })
        .returning({ id: forums.id });
      forumId = forum.id;

      const [hot1, hot2, hot3, old, hidden] = await db
        .insert(threads)
        .values([
          {
            forumId,
            authorId: userId,
            title: `回复最多帖-${uniq}`,
            contentMd: "# 一",
            replyCount: 30,
            createdAt: ago(10 * MIN),
          },
          {
            forumId,
            authorId: userId,
            title: `回复中游帖-${uniq}`,
            contentMd: "# 二",
            replyCount: 20,
            createdAt: ago(2 * 60 * MIN),
          },
          {
            forumId,
            authorId: userId,
            title: `回复最少帖-${uniq}`,
            contentMd: "# 三",
            replyCount: 10,
            createdAt: ago(DAY),
          },
          {
            // 40 天前老帖：回复最高，但超过 30 天窗口，不应出现
            forumId,
            authorId: userId,
            title: `老帖霸榜帖-${uniq}`,
            contentMd: "# 老",
            replyCount: 99,
            createdAt: ago(40 * DAY),
          },
          {
            // hidden 帖：回复很高，但状态不可见，不应出现
            forumId,
            authorId: userId,
            title: `隐藏帖-${uniq}`,
            contentMd: "# 藏",
            replyCount: 80,
            status: "hidden",
            createdAt: ago(5 * MIN),
          },
        ])
        .returning({ id: threads.id });
      threadIds = [hot1.id, hot2.id, hot3.id, old.id, hidden.id];
      hot1Id = hot1.id;
      hot2Id = hot2.id;
      hot3Id = hot3.id;
      oldId = old.id;
      hiddenId = hidden.id;
    });

    afterAll(async () => {
      // 清理顺序：threads → forums → users（外键依赖；探针无 replies）
      await db.delete(threads).where(inArray(threads.id, threadIds));
      await db.delete(forums).where(eq(forums.id, forumId));
      await db.delete(users).where(eq(users.id, userId));
    });

    it("按 reply_count 倒序；40 天老帖与 hidden 帖不出现", async () => {
      const rows = await getHotThreads(10);
      const probe = rows.filter((t) => threadIds.includes(t.id));
      expect(probe.map((t) => t.id)).toEqual([hot1Id, hot2Id, hot3Id]);
      expect(rows.some((t) => t.id === oldId)).toBe(false);
      expect(rows.some((t) => t.id === hiddenId)).toBe(false);
    });

    it("行字段齐备：join 板块带 slug / name", async () => {
      const rows = await getHotThreads(10);
      const hit = rows.find((t) => t.id === hot1Id);
      expect(hit).toMatchObject({
        id: hot1Id,
        title: `回复最多帖-${uniq}`,
        replyCount: 30,
        forumSlug: slug,
        forumName: `热帖板块-${uniq}`,
      });
    });

    it("limit 截断条数", async () => {
      const rows = await getHotThreads(2);
      expect(rows.length).toBeLessThanOrEqual(2);
    });

    it("getHomeData.hotThreads 含探针热帖，老帖不出现", async () => {
      const data = await getHomeData();
      const probe = data.hotThreads.filter((t) => threadIds.includes(t.id));
      // 默认 limit 5：库中可能存在其他帖，断言只圈探针相对顺序
      expect(probe.map((t) => t.id)).toEqual([hot1Id, hot2Id, hot3Id]);
      expect(data.hotThreads.some((t) => t.id === oldId)).toBe(false);
      expect(data.hotThreads.some((t) => t.id === hiddenId)).toBe(false);
    });
  },
);
