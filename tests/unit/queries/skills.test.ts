import { inArray } from "drizzle-orm";
import { beforeAll, afterAll, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { skills } from "@/lib/db/schema";
import { listCategories, listSkills, PAGE_SIZE } from "@/lib/queries/skills";
import { simulateNoDatabase } from "@/tests/helpers/db";

/**
 * Skill 库列表查询（Task 6）
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
  it("listSkills 返回空结果", async () => {
    const restore = simulateNoDatabase();
    try {
      await expect(listSkills()).resolves.toEqual({ items: [], total: 0 });
      await expect(listSkills({ category: "运镜", q: "推", page: 2 })).resolves.toEqual(
        { items: [], total: 0 },
      );
      // 终审 F4：hot 排序同样短路不崩
      await expect(listSkills({ q: "推", sort: "hot" })).resolves.toEqual({
        items: [],
        total: 0,
      });
    } finally {
      restore();
    }
  });

  it("listCategories 返回空数组", async () => {
    const restore = simulateNoDatabase();
    try {
      await expect(listCategories()).resolves.toEqual([]);
    } finally {
      restore();
    }
  });
});

/* ---------------------------------------------------------------- */
/* 连库：插入 3 条（2 条 category=A 其中 1 条 removed、1 条 category=B） */
/* ---------------------------------------------------------------- */

describe.skipIf(!process.env.D1_LOCAL_TEST)("listSkills / listCategories 连库查询", () => {
  const uniq = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const catA = `测试分类甲-${uniq}`;
  const catB = `测试分类乙-${uniq}`;
  // 3 条记录的 name/description 均带 uniq 探针：q=uniq 可圈定本组数据，
  // 不受库中既有内容影响
  const slugs = {
    aPublished: `task6-test-a-${uniq}`, // catA published（较早）
    aRemoved: `task6-test-b-${uniq}`, // catA removed
    bPublished: `task6-test-c-${uniq}`, // catB published（最新）
  };
  const allSlugs = Object.values(slugs);

  beforeAll(async () => {
    await db.insert(skills).values([
      {
        slug: slugs.aPublished,
        name: `运镜基础入门-${uniq}`,
        description: `任务六测试数据 ${uniq}`,
        contentMd: "# 测试",
        category: catA,
        status: "published",
        createdAt: new Date(Date.now() - 20_000),
      },
      {
        slug: slugs.aRemoved,
        name: `已被下架条目-${uniq}`,
        description: `任务六测试数据 ${uniq}`,
        contentMd: "# 测试",
        category: catA,
        status: "removed",
        createdAt: new Date(Date.now() - 10_000),
      },
      {
        slug: slugs.bPublished,
        name: `独门绝技合集-${uniq}`,
        description: `任务六测试数据 ${uniq}`,
        contentMd: "# 测试",
        category: catB,
        status: "published",
        createdAt: new Date(),
      },
    ]);
  });

  afterAll(async () => {
    // skills 无子表外键引用，直接按 slug 清理
    await db.delete(skills).where(inArray(skills.slug, allSlugs));
  });

  it("默认列表只含 published（removed 不出现），按 created_at 倒序", async () => {
    const { items, total } = await listSkills({ q: uniq });
    expect(total).toBe(2);
    expect(items.map((s) => s.slug)).toEqual([
      slugs.bPublished,
      slugs.aPublished,
    ]);
  });

  it("category 精确匹配：catA 只剩 1 条 published", async () => {
    const { items, total } = await listSkills({ q: uniq, category: catA });
    expect(total).toBe(1);
    expect(items.map((s) => s.slug)).toEqual([slugs.aPublished]);
  });

  it("q 命中 name 子串：仅 1 条", async () => {
    const { items, total } = await listSkills({ q: `独门绝技合集-${uniq}` });
    expect(total).toBe(1);
    expect(items[0]?.slug).toBe(slugs.bPublished);
  });

  it("page 越界：items 为空但 total 正确", async () => {
    const { items, total } = await listSkills({ q: uniq, page: 99 });
    expect(total).toBe(2);
    expect(items).toEqual([]);
  });

  it("listCategories 返回 published 的 distinct 分类（含本组两个分类）", async () => {
    const categories = await listCategories();
    expect(categories).toContain(catA);
    expect(categories).toContain(catB);
    // distinct：同分类不重复出现
    expect(new Set(categories).size).toBe(categories.length);
  });
});

/* ---------------------------------------------------------------- */
/* 连库：sort=new/hot 排序（终审 F4，独立数据组不干扰上方断言）          */
/* ---------------------------------------------------------------- */

describe.skipIf(!process.env.D1_LOCAL_TEST)("listSkills sort 排序连库", () => {
  const uniq = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const hotCategory = `热度分类-${uniq}`;

  // 排序探针：hotOld 浏览量高但最旧；zeroMid / zeroNew 零浏览量、时间递增
  const slugs = {
    hotOld: `f4-hot-old-${uniq}`, // viewCount=5，20s 前
    zeroMid: `f4-zero-mid-${uniq}`, // viewCount=0，10s 前
    zeroNew: `f4-zero-new-${uniq}`, // viewCount=0，最新
  };
  const allSlugs = Object.values(slugs);

  beforeAll(async () => {
    await db.insert(skills).values([
      {
        slug: slugs.hotOld,
        name: `高浏览旧文-${uniq}`,
        description: `排序探针 ${uniq}`,
        contentMd: "# 测试",
        category: hotCategory,
        status: "published",
        viewCount: 5,
        createdAt: new Date(Date.now() - 20_000),
      },
      {
        slug: slugs.zeroMid,
        name: `零浏览中位-${uniq}`,
        description: `排序探针 ${uniq}`,
        contentMd: "# 测试",
        category: hotCategory,
        status: "published",
        createdAt: new Date(Date.now() - 10_000),
      },
      {
        slug: slugs.zeroNew,
        name: `零浏览最新-${uniq}`,
        description: `排序探针 ${uniq}`,
        contentMd: "# 测试",
        category: hotCategory,
        status: "published",
        createdAt: new Date(),
      },
    ]);
  });

  afterAll(async () => {
    await db.delete(skills).where(inArray(skills.slug, allSlugs));
  });

  it("默认（sort 缺省）：created_at desc 最新优先", async () => {
    const { items, total } = await listSkills({ q: uniq });
    expect(total).toBe(3);
    expect(items.map((s) => s.slug)).toEqual([
      slugs.zeroNew,
      slugs.zeroMid,
      slugs.hotOld,
    ]);
  });

  it("sort=new：与默认一致（显式传参）", async () => {
    const { items } = await listSkills({ q: uniq, sort: "new" });
    expect(items.map((s) => s.slug)).toEqual([
      slugs.zeroNew,
      slugs.zeroMid,
      slugs.hotOld,
    ]);
  });

  it("sort=hot：view_count desc 优先，同分按 created_at desc 次序", async () => {
    const { items, total } = await listSkills({ q: uniq, sort: "hot" });
    expect(total).toBe(3);
    // hotOld 浏览量最高排第一；zeroNew / zeroMid 同为 0 → 新的在前
    expect(items.map((s) => s.slug)).toEqual([
      slugs.hotOld,
      slugs.zeroNew,
      slugs.zeroMid,
    ]);
  });
});
