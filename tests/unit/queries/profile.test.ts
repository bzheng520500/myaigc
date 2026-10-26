import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { favorites, forums, skills, threads, users } from "@/lib/db/schema";
import { getProfile, PROFILE_LIST_LIMIT } from "@/lib/queries/profile";
import { simulateNoDatabase } from "@/tests/helpers/db";

/**
 * 用户主页数据查询（Phase 3 Task 3）。
 *
 * Review Focus #5（收藏失效项过滤）：
 * - 收藏列表只回仍可见的目标——removed skill / hidden thread 的收藏行被过滤
 *
 * - 纯逻辑：无库（D1 绑定不可用）兜底返回 null
 * - 连库（本地 D1）：`npm run db:migrate:local` 后设 `D1_LOCAL_TEST=1`；
 *   探针：主页主人 + 他人各 1，主人 2 帖（visible/hidden）+ 2 skill
 *   （published/removed），收藏 4 行（有效/失效 × skill/thread）
 *
 * profile.ts 无 "use cache"（个人数据禁缓存），无需 mock next/cache。
 */

/** 合法 uuid（不存在的随机 id，用于不存在分支） */
const RANDOM_UUID = "5d2e7a41-9c30-4f6b-8e5d-1a2b3c4d5e6f";

/* ---------------------------------------------------------------- */
/* 纯逻辑：常量与兜底                                                 */
/* ---------------------------------------------------------------- */

describe("PROFILE_LIST_LIMIT 常量", () => {
  it("三列表每列表固定 20 条（分页不做，YAGNI）", () => {
    expect(PROFILE_LIST_LIMIT).toBe(20);
  });
});

describe("无库兜底（D1 绑定不可用，内部短路，不发起查询）", () => {
  it("getProfile 返回 null", async () => {
    const restore = simulateNoDatabase();
    try {
      await expect(getProfile(RANDOM_UUID)).resolves.toBeNull();
    } finally {
      restore();
    }
  });
});

/* ---------------------------------------------------------------- */
/* 连库：三列表正确 + 收藏失效过滤（Focus #5）+ hidden/removed 排除     */
/* ---------------------------------------------------------------- */

describe.skipIf(!process.env.D1_LOCAL_TEST)("getProfile 连库查询", () => {
  const uniq = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  let ownerId: string; // 主页主人
  let otherId: string; // 他人（收藏目标作者）
  let forumId: string;
  let ownerThreadId: string; // 主人 visible 帖
  let ownerHiddenThreadId: string; // 主人 hidden 帖（本人帖列表应排除）
  let otherThreadId: string; // 他人 visible 帖（被主人收藏）
  let ownerSkillId: string; // 主人 published skill
  let ownerRemovedSkillId: string; // 主人 removed skill（上传列表应排除）
  let otherSkillId: string; // 他人 published skill（被主人收藏）

  beforeAll(async () => {
    const [owner, other] = await db
      .insert(users)
      .values([
        {
          name: `主页主人-${uniq}`,
          email: `p3q-owner-${uniq}@test.local`,
          image: "https://example.com/avatar.png",
        },
        { name: `他人作者-${uniq}`, email: `p3q-other-${uniq}@test.local` },
      ])
      .returning({ id: users.id });
    ownerId = owner.id;
    otherId = other.id;

    const [forum] = await db
      .insert(forums)
      .values({ slug: `p3q-forum-${uniq}`, name: `主页板块-${uniq}`, sortOrder: 900005 })
      .returning({ id: forums.id });
    forumId = forum.id;

    const [t1, t2, t3] = await db
      .insert(threads)
      .values([
        {
          forumId,
          authorId: ownerId,
          title: `主人可见帖-${uniq}`,
          contentMd: "# 可见",
        },
        {
          forumId,
          authorId: ownerId,
          title: `主人隐藏帖-${uniq}`,
          contentMd: "# 隐藏",
          status: "hidden",
        },
        {
          forumId,
          authorId: otherId,
          title: `他人帖-${uniq}`,
          contentMd: "# 他人",
        },
      ])
      .returning({ id: threads.id });
    ownerThreadId = t1.id;
    ownerHiddenThreadId = t2.id;
    otherThreadId = t3.id;

    const [s1, s2, s3] = await db
      .insert(skills)
      .values([
        {
          slug: `p3q-skill-pub-${uniq}`,
          name: `主人已发布技能-${uniq}`,
          contentMd: "# 正文",
          category: "测试分类",
          authorId: ownerId,
          source: "user",
        },
        {
          slug: `p3q-skill-removed-${uniq}`,
          name: `主人已下架技能-${uniq}`,
          contentMd: "# 正文",
          category: "测试分类",
          authorId: ownerId,
          source: "user",
          status: "removed",
        },
        {
          slug: `p3q-skill-other-${uniq}`,
          name: `他人技能-${uniq}`,
          contentMd: "# 正文",
          category: "测试分类",
          authorId: otherId,
          source: "user",
        },
      ])
      .returning({ id: skills.id });
    ownerSkillId = s1.id;
    ownerRemovedSkillId = s2.id;
    otherSkillId = s3.id;

    // 收藏 4 行：skill 有效（他人 published）+ skill 失效（removed）+
    // thread 有效（他人 visible）+ thread 失效（hidden）
    await db.insert(favorites).values([
      { userId: ownerId, targetType: "skill", targetId: otherSkillId },
      { userId: ownerId, targetType: "skill", targetId: ownerRemovedSkillId },
      { userId: ownerId, targetType: "thread", targetId: otherThreadId },
      { userId: ownerId, targetType: "thread", targetId: ownerHiddenThreadId },
    ]);
  });

  afterAll(async () => {
    // 清理顺序（外键依赖）：favorites → skills → threads → forums → users
    await db.delete(favorites).where(eq(favorites.userId, ownerId));
    await db
      .delete(skills)
      .where(
        inArray(skills.id, [ownerSkillId, ownerRemovedSkillId, otherSkillId]),
      );
    await db
      .delete(threads)
      .where(
        inArray(threads.id, [
          ownerThreadId,
          ownerHiddenThreadId,
          otherThreadId,
        ]),
      );
    await db.delete(forums).where(eq(forums.id, forumId));
    await db.delete(users).where(inArray(users.id, [ownerId, otherId]));
  });

  it("资料头：返回 user 五字段（含 image 与 createdAt）", async () => {
    const profile = await getProfile(ownerId);
    expect(profile).not.toBeNull();
    expect(profile?.user).toMatchObject({
      id: ownerId,
      name: `主页主人-${uniq}`,
      image: "https://example.com/avatar.png",
      email: `p3q-owner-${uniq}@test.local`,
    });
    expect(profile?.user.createdAt).toBeInstanceOf(Date);
  });

  it("threads：本人帖列表只含 visible（hidden 排除），带 forumSlug 供 ThreadRow 跳转", async () => {
    const profile = await getProfile(ownerId);
    expect(profile?.threads.map((t) => t.id)).toEqual([ownerThreadId]);
    const row = profile?.threads[0];
    expect(row).toMatchObject({
      title: `主人可见帖-${uniq}`,
      authorId: ownerId,
      authorName: `主页主人-${uniq}`,
      forumSlug: `p3q-forum-${uniq}`,
    });
  });

  it("skills：本人上传只含 published（removed 排除，Focus #5 同族防线）", async () => {
    const profile = await getProfile(ownerId);
    expect(profile?.skills.map((s) => s.id)).toEqual([ownerSkillId]);
    expect(profile?.skills[0]).toMatchObject({
      slug: `p3q-skill-pub-${uniq}`,
      name: `主人已发布技能-${uniq}`,
      category: "测试分类",
    });
  });

  it("favorites.skills：removed 收藏被过滤，只剩 1 条有效（Review Focus #5）", async () => {
    const profile = await getProfile(ownerId);
    expect(profile?.favorites.skills.map((s) => s.id)).toEqual([otherSkillId]);
    expect(
      profile?.favorites.skills.some((s) => s.id === ownerRemovedSkillId),
    ).toBe(false);
  });

  it("favorites.threads：hidden 收藏被过滤，只剩 1 条有效（Review Focus #5）", async () => {
    const profile = await getProfile(ownerId);
    expect(profile?.favorites.threads.map((t) => t.id)).toEqual([otherThreadId]);
    expect(
      profile?.favorites.threads.some((t) => t.id === ownerHiddenThreadId),
    ).toBe(false);
  });

  it("他人视角：threads 只圈本人帖（他人帖不在主人主页），收藏含他人内容", async () => {
    const profile = await getProfile(ownerId);
    expect(profile?.threads.every((t) => t.authorId === ownerId)).toBe(true);
    expect(profile?.favorites.threads[0]?.authorId).toBe(otherId);
  });

  it("用户不存在 → null", async () => {
    expect(await getProfile(RANDOM_UUID)).toBeNull();
  });
});
