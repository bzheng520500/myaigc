import { inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { tutorials } from "@/lib/db/schema";
import { getTutorialBySlug, listTutorials } from "@/lib/queries/tutorials";
import { simulateNoDatabase } from "@/tests/helpers/db";

/**
 * Tutorial 查询（Task 9），模式与 tests/unit/queries/skills.test.ts 一致：
 *
 * - 纯逻辑：无库（D1 绑定不可用）兜底返回空
 * - 连库（本地 D1）：`npm run db:migrate:local` 后设 `D1_LOCAL_TEST=1`，
 *   插入带 uniq 探针的 2 篇教程断言 sortOrder asc 排序与 slug 命中 / null
 *
 * cacheLife 在 Next cache scope 之外会 throw，mock 成 no-op。
 */
vi.mock("next/cache", () => ({
  cacheLife: () => {},
}));

/* ---------------------------------------------------------------- */
/* 纯逻辑：无库（D1 绑定不可用）兜底                              */
/* ---------------------------------------------------------------- */

describe("无库兜底（D1 绑定不可用，内部短路，不发起查询）", () => {
  it("listTutorials 返回空数组", async () => {
    const restore = simulateNoDatabase();
    try {
      await expect(listTutorials()).resolves.toEqual([]);
    } finally {
      restore();
    }
  });

  it("getTutorialBySlug 返回 null", async () => {
    const restore = simulateNoDatabase();
    try {
      await expect(getTutorialBySlug("any-slug")).resolves.toBeNull();
    } finally {
      restore();
    }
  });
});

/* ---------------------------------------------------------------- */
/* 连库：插入 2 篇（sortOrder 2 / 1，探针圈定本组数据）                   */
/* ---------------------------------------------------------------- */

describe.skipIf(!process.env.D1_LOCAL_TEST)(
  "listTutorials / getTutorialBySlug 连库查询",
  () => {
    const uniq = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const slugFirst = `task9-test-first-${uniq}`; // sortOrder 1
    const slugSecond = `task9-test-second-${uniq}`; // sortOrder 2
    const allSlugs = [slugFirst, slugSecond];

    beforeAll(async () => {
      await db.insert(tutorials).values([
        {
          slug: slugSecond,
          title: `组合运镜进阶-${uniq}`,
          summary: `任务九测试数据 ${uniq}`,
          contentMd: "## 第二节\n\n正文",
          category: "运镜教学",
          sortOrder: 2,
        },
        {
          slug: slugFirst,
          title: `基础运镜入门-${uniq}`,
          summary: `任务九测试数据 ${uniq}`,
          contentMd: "## 第一节\n\n正文",
          category: "运镜教学",
          sortOrder: 1,
        },
      ]);
    });

    afterAll(async () => {
      // tutorials 无子表外键引用，直接按 slug 清理
      await db.delete(tutorials).where(inArray(tutorials.slug, allSlugs));
    });

    it("listTutorials 按 sort_order 升序（插入顺序颠倒也返回 1 在前）", async () => {
      const rows = (await listTutorials()).filter((t) =>
        t.slug.includes(uniq),
      );
      expect(rows.map((t) => t.slug)).toEqual([slugFirst, slugSecond]);
      // 列表行不含 contentMd 全文
      expect(rows[0]).not.toHaveProperty("contentMd");
    });

    it("getTutorialBySlug 命中：返回含 contentMd 全文", async () => {
      const row = await getTutorialBySlug(slugFirst);
      expect(row?.slug).toBe(slugFirst);
      expect(row?.contentMd).toBe("## 第一节\n\n正文");
    });

    it("getTutorialBySlug 不存在 → null", async () => {
      await expect(getTutorialBySlug(`no-such-${uniq}`)).resolves.toBeNull();
    });
  },
);
