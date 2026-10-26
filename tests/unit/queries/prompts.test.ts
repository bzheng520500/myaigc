import { inArray } from "drizzle-orm";
import { beforeAll, afterAll, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { prompts } from "@/lib/db/schema";
import {
  listPromptCategories,
  listPrompts,
  PAGE_SIZE,
} from "@/lib/queries/prompts";
import { simulateNoDatabase } from "@/tests/helpers/db";

/**
 * 运镜提示词库列表查询（Task 8）
 *
 * - 纯逻辑：PAGE_SIZE 常量、无库（D1 绑定不可用）兜底返回空
 * - 连库（本地 D1）：`npm run db:migrate:local` 后设 `D1_LOCAL_TEST=1`
 *
 * cacheLife 在 Next cache scope 之外会 throw（vitest 无该运行时），
 * 这里 mock 成 no-op——测试只关心查询逻辑本身。
 */
vi.mock("next/cache", () => ({
  cacheLife: () => {},
}));

/* ---------------------------------------------------------------- */
/* 纯逻辑：常量与兜底                                                 */
/* ---------------------------------------------------------------- */

describe("PAGE_SIZE 常量", () => {
  it("每页固定 20 条", () => {
    expect(PAGE_SIZE).toBe(20);
  });
});

describe("无库兜底（D1 绑定不可用，内部短路，不发起查询）", () => {
  it("listPrompts 返回空结果", async () => {
    const restore = simulateNoDatabase();
    try {
      await expect(listPrompts()).resolves.toEqual({ items: [], total: 0 });
      await expect(
        listPrompts({ category: "基础运镜", q: "推", page: 2 }),
      ).resolves.toEqual({ items: [], total: 0 });
    } finally {
      restore();
    }
  });

  it("listPromptCategories 返回空数组", async () => {
    const restore = simulateNoDatabase();
    try {
      await expect(listPromptCategories()).resolves.toEqual([]);
    } finally {
      restore();
    }
  });
});

/* ---------------------------------------------------------------- */
/* 连库：插入 3 条（2 条 category=A、1 条 category=B，其中 1 条 name 含特定子串） */
/* ---------------------------------------------------------------- */

describe.skipIf(!process.env.D1_LOCAL_TEST)(
  "listPrompts / listPromptCategories 连库查询",
  () => {
    const uniq = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const catA = `测试运镜甲-${uniq}`;
    const catB = `测试运镜乙-${uniq}`;
    // 3 条记录的 name / promptZh 均带 uniq 探针：q=uniq 可圈定本组数据，
    // 不受库中既有内容影响
    const names = {
      aSlow: `缓慢推近-${uniq}`, // catA，sortOrder 20
      aOrbit: `环绕横移-${uniq}`, // catA，sortOrder 10，promptZh 含特定子串
      bZoom: `希区柯克变焦-${uniq}`, // catB，sortOrder 30
    };
    const allNames = Object.values(names);
    // aOrbit 的 promptZh 独有子串：验证 q 命中 promptZh（中文搜索）
    const zhProbe = `环绕镜头运镜说明-${uniq}`;

    beforeAll(async () => {
      await db.insert(prompts).values([
        {
          name: names.aSlow,
          category: catA,
          promptEn: `Slow push-in test ${uniq}`,
          promptZh: `缓慢推近主体 ${uniq}`,
          sortOrder: 20,
          sourceDoc: "a.md",
        },
        {
          name: names.aOrbit,
          category: catA,
          promptEn: `Orbit move test ${uniq}`,
          promptZh: zhProbe,
          sortOrder: 10,
          sourceDoc: "b.md",
        },
        {
          name: names.bZoom,
          category: catB,
          promptEn: `Dolly zoom test ${uniq}`,
          promptZh: `滑动变焦 ${uniq}`,
          sortOrder: 30,
          sourceDoc: "c.md",
        },
      ]);
    });

    afterAll(async () => {
      // prompts 无子表外键引用，直接按 name 清理
      await db.delete(prompts).where(inArray(prompts.name, allNames));
    });

    it("默认列表按 sort_order 升序稳定排序", async () => {
      const { items, total } = await listPrompts({ q: uniq });
      expect(total).toBe(3);
      expect(items.map((p) => p.name)).toEqual([names.aOrbit, names.aSlow, names.bZoom]);
    });

    it("category 精确匹配：catA 命中 2 条", async () => {
      const { items, total } = await listPrompts({ q: uniq, category: catA });
      expect(total).toBe(2);
      expect(items.map((p) => p.name)).toEqual([names.aOrbit, names.aSlow]);
    });

    it("q 命中 name 子串：仅 1 条", async () => {
      const { items, total } = await listPrompts({ q: `希区柯克变焦-${uniq}` });
      expect(total).toBe(1);
      expect(items[0]?.name).toBe(names.bZoom);
    });

    it("q 命中 promptZh 子串（中文搜索）：仅 1 条", async () => {
      const { items, total } = await listPrompts({ q: `环绕镜头运镜说明-${uniq}` });
      expect(total).toBe(1);
      expect(items[0]?.name).toBe(names.aOrbit);
    });

    it("page 越界：items 为空但 total 正确", async () => {
      const { items, total } = await listPrompts({ q: uniq, page: 99 });
      expect(total).toBe(3);
      expect(items).toEqual([]);
    });

    it("listPromptCategories 返回 distinct 分类（含本组两个分类）", async () => {
      const categories = await listPromptCategories();
      expect(categories).toContain(catA);
      expect(categories).toContain(catB);
      // distinct：同分类不重复出现
      expect(new Set(categories).size).toBe(categories.length);
    });
  },
);
