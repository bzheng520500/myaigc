import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { updateProfile } from "@/lib/actions/profile";

/**
 * 个人资料 server action（Phase 3 Task 3）。
 *
 * - 纯逻辑（无库可跑）：未登录 / name 超长 / image 非 URL，
 *   分支顺序保证这些错误在任何数据库调用之前返回
 * - 连库：Neon 未就位（无 DATABASE_URL）时自动跳过；
 *   合法更新生效（trim / image 落库 / notifyEmail 翻转 / 空串清空头像）
 *
 * mock（与 upload.test.ts / interactions.test.ts 同模式）：@/lib/auth 注入登录态。
 * profile.ts 不调 revalidatePath（个人主页查询禁缓存，设置页靠 router.refresh），
 * 无需 mock next/cache。
 */

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(),
}));

const authMock = vi.mocked(auth);

/** 注入已登录用户（database 策略 session.user 含 id；auth 是多重载类型用 never cast） */
function loginAs(userId: string) {
  authMock.mockResolvedValue({ user: { id: userId } } as never);
}

/** 合法 uuid（不存在的随机 id，校验失败分支触库前返回） */
const RANDOM_UUID = "6e3f8b52-0d41-4a7c-9b6e-2c3d4e5f6a7b";

/* ---------------------------------------------------------------- */
/* 纯逻辑：触库之前的分支                                              */
/* ---------------------------------------------------------------- */

describe("updateProfile 前置分支（纯逻辑）", () => {
  beforeEach(() => {
    authMock.mockReset();
  });

  it("auth() 抛错（vitest 无请求上下文）→ 兜底按未登录拒绝", async () => {
    authMock.mockImplementation(() => {
      throw new Error("no request context");
    });
    await expect(updateProfile({ name: "新昵称" })).resolves.toEqual({
      ok: false,
      error: "请先登录",
    });
  });

  it("auth() 返回 null（无 session）→ 未登录拒绝", async () => {
    authMock.mockResolvedValue(null as never);
    await expect(updateProfile({ name: "新昵称" })).resolves.toEqual({
      ok: false,
      error: "请先登录",
    });
  });

  it("name 31 字 → 拒绝（中文错误，触库前）", async () => {
    loginAs(RANDOM_UUID);
    await expect(updateProfile({ name: "昵".repeat(31) })).resolves.toEqual({
      ok: false,
      error: "昵称不能超过 30 字",
    });
  });

  it("image 非 http(s) URL → 拒绝（触库前）", async () => {
    loginAs(RANDOM_UUID);
    await expect(
      updateProfile({ image: "javascript:alert(1)" }),
    ).resolves.toEqual({
      ok: false,
      error: "头像地址无效",
    });
    await expect(updateProfile({ image: "ftp://example.com/a.png" })).resolves.toEqual({
      ok: false,
      error: "头像地址无效",
    });
    await expect(updateProfile({ image: "example.com/a.png" })).resolves.toEqual({
      ok: false,
      error: "头像地址无效",
    });
  });
});

/* ---------------------------------------------------------------- */
/* 连库：合法更新生效                                                   */
/* ---------------------------------------------------------------- */

describe.skipIf(!process.env.DATABASE_URL)("updateProfile 连库更新", () => {
  const uniq = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  let userId: string;

  beforeAll(async () => {
    const [user] = await db
      .insert(users)
      .values({
        name: `设置用户-${uniq}`,
        email: `p3a-settings-${uniq}@test.local`,
      })
      .returning({ id: users.id });
    userId = user.id;
  });

  afterAll(async () => {
    await db.delete(users).where(eq(users.id, userId));
  });

  beforeEach(() => {
    authMock.mockReset();
  });

  it("合法更新：name trim 落库、image 落库、notifyEmail 翻转", async () => {
    loginAs(userId);
    await expect(
      updateProfile({
        name: `  新昵称-${uniq}  `,
        image: "https://example.com/new-avatar.png",
        notifyEmailEnabled: false,
      }),
    ).resolves.toEqual({ ok: true });

    const [row] = await db
      .select({
        name: users.name,
        image: users.image,
        notifyEmail: users.notifyEmail,
      })
      .from(users)
      .where(eq(users.id, userId));
    expect(row.name).toBe(`新昵称-${uniq}`); // trim 生效
    expect(row.image).toBe("https://example.com/new-avatar.png");
    expect(row.notifyEmail).toBe(false);
  });

  it("image 空串 → 清空头像（null）", async () => {
    loginAs(userId);
    await expect(updateProfile({ image: "   " })).resolves.toEqual({ ok: true });

    const [row] = await db
      .select({ image: users.image })
      .from(users)
      .where(eq(users.id, userId));
    expect(row.image).toBeNull();
  });

  it("空输入（无字段）→ ok 且不改动任何列", async () => {
    loginAs(userId);
    await expect(updateProfile({})).resolves.toEqual({ ok: true });

    const [row] = await db
      .select({ name: users.name, image: users.image })
      .from(users)
      .where(eq(users.id, userId));
    expect(row.name).toBe(`新昵称-${uniq}`);
    expect(row.image).toBeNull();
  });
});
