import { and, eq, inArray, notInArray } from "drizzle-orm";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { GET as digestRoute } from "@/app/api/cron/digest/route";
import { db, setDbForTesting } from "@/lib/db";
import { notifications, users } from "@/lib/db/schema";
import {
  buildDigest,
  digestSince,
  DIGEST_WINDOW_MS,
  sendDailyDigests,
  sendDigestEmail,
} from "@/lib/digest";
import type { DigestNotification } from "@/lib/digest";
import { renderDailyDigestHtml } from "@/lib/emails/daily-digest";

/**
 * 每日邮件摘要（Phase 3 Task 4）。
 *
 * Review Focus #4（fail-closed）：CRON_SECRET 未设置时
 * /api/cron/digest 必须返回 500——宁拒勿裸奔，防止生产漏配
 * secret 后端点被任意调用刷邮件。
 *
 * - 纯逻辑（无库可跑）：邮件模板品牌风格 / XSS 转义 / 链接拼接 /
 *   空列表防御；route 鉴权 500 与 401（route handler 直接 import
 *   调用，与 interactions.test.ts 同模式）；24h 摘要窗口（终审 F3）；
 *   发信配置缺失快速失败 failed=-1（终审 F6，配置检查在触库之前；
 *   用 setDbForTesting 注入最小假实例模拟「有库」，不真触库）
 * - 连库（本地 D1）：`npm run db:migrate:local` 后设 `D1_LOCAL_TEST=1`；
 *   buildDigest 未读判定与字段、24h 窗口外的旧未读不计入（终审 F3）、
 *   sendDailyDigests 在 AUTH_DEV_MODE=1 下不真发（只 console.log）
 */

const BASE_URL = "https://example.com";

/* ---------------------------------------------------------------- */
/* 纯逻辑：邮件模板 renderDailyDigestHtml                            */
/* ---------------------------------------------------------------- */

describe("renderDailyDigestHtml 纯函数", () => {
  const items: DigestNotification[] = [
    {
      id: "n1",
      type: "thread_reply",
      actorName: "<script>alert(1)</script>",
      link: "/forum/tech/abc",
      createdAt: new Date(Date.now() - 5 * 60_000),
    },
    {
      id: "n2",
      type: "like",
      actorName: null,
      link: null, // 源已删：纯文本条目
      createdAt: new Date(Date.now() - 26 * 3600_000),
    },
  ];

  it("品牌风格：米白底 / 陶土橙按钮 / 衬线标题 + 站名", () => {
    const html = renderDailyDigestHtml({
      recipientName: "阿金",
      baseUrl: BASE_URL,
      items,
    });
    expect(html).toContain("#FAF9F5"); // 米白底
    expect(html).toContain("#D97757"); // 陶土橙按钮
    expect(html).toContain("Georgia"); // 衬线标题
    expect(html).toContain("AI影视工坊");
    expect(html).toContain("你好，阿金");
  });

  it("XSS：actorName 含 <script> 被转义", () => {
    const html = renderDailyDigestHtml({
      recipientName: "阿金",
      baseUrl: BASE_URL,
      items,
    });
    expect(html).not.toContain("<script");
    expect(html).toContain("&lt;script&gt;");
  });

  it("链接拼接：查看全部通知 → /notifications；退订提示 → /settings；条目 link 拼 baseUrl", () => {
    const html = renderDailyDigestHtml({
      recipientName: "阿金",
      baseUrl: BASE_URL,
      items,
    });
    expect(html).toContain(`href="${BASE_URL}/notifications"`);
    expect(html).toContain(`href="${BASE_URL}/settings"`);
    expect(html).toContain(`href="${BASE_URL}/forum/tech/abc"`);
    expect(html).toContain("查看全部通知");
    expect(html).toContain("可在设置中关闭邮件通知");
  });

  it("类型文案与相对时间渲染；actorName 为 null 时有兜底称呼", () => {
    const html = renderDailyDigestHtml({
      recipientName: "阿金",
      baseUrl: BASE_URL,
      items,
    });
    expect(html).toContain("回复了你的帖子"); // thread_reply 文案
    expect(html).toContain("赞了你的内容"); // like 文案
    expect(html).toContain("5 分钟前");
    expect(html).toContain("1 天前");
    expect(html).toContain("有人"); // null actorName 兜底
  });

  it("空 items 防御（正常不会发生）：不崩且有占位文案", () => {
    const html = renderDailyDigestHtml({
      recipientName: "阿金",
      baseUrl: BASE_URL,
      items: [],
    });
    expect(html).toContain("AI影视工坊");
    expect(html.length).toBeGreaterThan(0);
  });
});

/* ---------------------------------------------------------------- */
/* 纯逻辑：sendDigestEmail 直接调 Resend REST（无 SDK，mock fetch）   */
/* ---------------------------------------------------------------- */

describe("sendDigestEmail Resend REST 调用（mock fetch）", () => {
  const payload = {
    from: "noreply@example.com",
    to: "user@example.com",
    subject: "你在 AI影视工坊 有 2 条新通知",
    html: "<p>你好</p>",
  };

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("POST https://api.resend.com/emails：Bearer 鉴权 + JSON body + 超时信号", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(sendDigestEmail("re_test_key", payload)).resolves.toBe(true);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.resend.com/emails");
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual({
      Authorization: "Bearer re_test_key",
      "Content-Type": "application/json",
    });
    expect(JSON.parse(String(init.body))).toEqual(payload);
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("非 2xx（401）→ 返回 false，console.error 记录状态与响应体", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(new Response("invalid api key", { status: 401 })),
    );
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(sendDigestEmail("bad_key", payload)).resolves.toBe(false);
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("401"));
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("invalid api key"),
    );
  });
});

/* ---------------------------------------------------------------- */
/* 纯逻辑：cron route 鉴权（fail-closed，Review Focus #4）            */
/* ---------------------------------------------------------------- */

describe("GET /api/cron/digest 鉴权", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("CRON_SECRET 未设置 → 500 fail-closed（宁拒勿裸奔）", async () => {
    vi.stubEnv("CRON_SECRET", undefined);
    const res = await digestRoute(
      new Request("http://localhost:3000/api/cron/digest"),
    );
    expect(res.status).toBe(500);
  });

  it("错误 Bearer secret → 401", async () => {
    vi.stubEnv("CRON_SECRET", "right-secret");
    const res = await digestRoute(
      new Request("http://localhost:3000/api/cron/digest", {
        headers: { authorization: "Bearer wrong-secret" },
      }),
    );
    expect(res.status).toBe(401);
  });

  it("缺少 Authorization 头 → 401", async () => {
    vi.stubEnv("CRON_SECRET", "right-secret");
    const res = await digestRoute(
      new Request("http://localhost:3000/api/cron/digest"),
    );
    expect(res.status).toBe(401);
  });
});

/* ---------------------------------------------------------------- */
/* 纯逻辑：24h 摘要窗口（终审 F3）                                    */
/* ---------------------------------------------------------------- */

describe("digestSince 24h 摘要窗口（纯逻辑）", () => {
  it("窗口常量为 24 小时", () => {
    expect(DIGEST_WINDOW_MS).toBe(24 * 60 * 60 * 1000);
  });

  it("digestSince(now) = now 往前 24 小时", () => {
    const now = new Date("2026-10-24T08:00:00Z");
    expect(digestSince(now).getTime()).toBe(now.getTime() - DIGEST_WINDOW_MS);
    expect(digestSince(now).toISOString()).toBe("2026-10-23T08:00:00.000Z");
  });

  it("缺省以当前时刻为基准（返回 24h 前的 Date）", () => {
    const before = Date.now();
    const since = digestSince().getTime();
    const after = Date.now();
    expect(since).toBeLessThanOrEqual(after - DIGEST_WINDOW_MS);
    expect(since).toBeGreaterThanOrEqual(before - DIGEST_WINDOW_MS);
  });
});

/* ---------------------------------------------------------------- */
/* 纯逻辑：sendDailyDigests 配置缺失快速失败（终审 F6）                */
/* ---------------------------------------------------------------- */

describe("sendDailyDigests 配置缺失快速失败（纯逻辑，检查在触库之前）", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    setDbForTesting(null);
  });

  it("非 DEV 且缺 RESEND_API_KEY → failed:-1 哨兵 + console.error 提示", async () => {
    // 仅需 isDbAvailable() 为 true：配置检查早于任何 db 查询，注入空对象即可
    setDbForTesting({});
    vi.stubEnv("AUTH_DEV_MODE", undefined);
    vi.stubEnv("RESEND_API_KEY", undefined);
    vi.stubEnv("AUTH_EMAIL_FROM", "noreply@example.com");
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(sendDailyDigests(BASE_URL)).resolves.toEqual({
      sent: 0,
      skipped: 0,
      failed: -1,
    });
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("RESEND_API_KEY"));
  });

  it("非 DEV 且缺 AUTH_EMAIL_FROM → 同样快速失败 failed:-1", async () => {
    setDbForTesting({});
    vi.stubEnv("AUTH_DEV_MODE", undefined);
    vi.stubEnv("RESEND_API_KEY", "re_xxx");
    vi.stubEnv("AUTH_EMAIL_FROM", undefined);
    vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(sendDailyDigests(BASE_URL)).resolves.toEqual({
      sent: 0,
      skipped: 0,
      failed: -1,
    });
  });
});

/* ---------------------------------------------------------------- */
/* 连库：buildDigest / sendDailyDigests                              */
/* ---------------------------------------------------------------- */

describe.skipIf(!process.env.D1_LOCAL_TEST)("digest 连库", () => {
  const uniq = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  // A：开关开 + 2 条未读；B：开关开 + 无通知；C：开关关（不进摘要循环）
  let userIdA: string;
  let userIdB: string;
  let userIdC: string;

  beforeAll(async () => {
    // DEV 模式：不真发邮件（只 console.log），sent 正常计数
    vi.stubEnv("AUTH_DEV_MODE", "1");

    const inserted = await db
      .insert(users)
      .values([
        {
          name: `摘要A-${uniq}`,
          email: `p3t4-a-${uniq}@test.local`,
          notifyEmail: true,
        },
        {
          name: `摘要B-${uniq}`,
          email: `p3t4-b-${uniq}@test.local`,
          notifyEmail: true,
        },
        {
          name: `摘要C-${uniq}`,
          email: `p3t4-c-${uniq}@test.local`,
          notifyEmail: false,
        },
      ])
      .returning({ id: users.id });
    [userIdA, userIdB, userIdC] = inserted.map((u) => u.id);

    // A 的 2 条未读（sourceId 用不存在的 uuid → link 解析为 null，
    // 通知表不校验归属，无需真造 forum/thread 源）
    await db.insert(notifications).values([
      {
        userId: userIdA,
        actorId: userIdB,
        type: "thread_reply",
        sourceType: "thread",
        sourceId: "3f1c6d92-8b17-4e2a-9c4d-5a6b7c8d9e0f",
      },
      {
        userId: userIdA,
        actorId: userIdC,
        type: "like",
        sourceType: "thread",
        sourceId: "3f1c6d92-8b17-4e2a-9c4d-5a6b7c8d9e0f",
      },
    ]);
  });

  afterAll(async () => {
    // 清理顺序（外键依赖）：notifications → users
    await db
      .delete(notifications)
      .where(inArray(notifications.userId, [userIdA, userIdB, userIdC]));
    await db
      .delete(users)
      .where(inArray(users.id, [userIdA, userIdB, userIdC]));
    vi.unstubAllEnvs();
  });

  it("buildDigest：无未读 → null", async () => {
    await expect(buildDigest(userIdB)).resolves.toBeNull();
  });

  it("buildDigest：有未读 → items 字段正确（只含未读，link 解析失败为 null）", async () => {
    const digest = await buildDigest(userIdA);
    expect(digest).not.toBeNull();
    expect(digest?.unread).toHaveLength(2);

    const types = digest!.unread.map((n) => n.type).sort();
    expect(types).toEqual(["like", "thread_reply"]);
    for (const item of digest!.unread) {
      expect(item.id).toBeTruthy();
      expect(item.actorName).toMatch(/^摘要[BC]-/); // join users 取到 actor 名
      expect(item.link).toBeNull(); // 源不存在 → null（邮件渲染纯文本）
      expect(item.createdAt).toBeInstanceOf(Date);
    }
  });

  it("buildDigest 24h 窗口（终审 F3）：仅 25h 前的旧未读不计入 → 仍 null", async () => {
    // B 此前无通知（上一用例已断言 null）；插入一条 25h 前的未读
    // 通知：digestSince 窗口外 → buildDigest 仍视为无可摘要
    await db.insert(notifications).values({
      userId: userIdB,
      actorId: userIdA,
      type: "like",
      sourceType: "thread",
      sourceId: "3f1c6d92-8b17-4e2a-9c4d-5a6b7c8d9e0f",
      createdAt: new Date(Date.now() - 25 * 3600_000),
    });
    await expect(buildDigest(userIdB)).resolves.toBeNull();
  });

  it("sendDailyDigests（DEV 模式不真发）：A sent、B skipped、C 不计", async () => {
    // sendDailyDigests 扫描全库 notifyEmail=true 的用户：本地库里可能有
    // 其他测试/开发残留用户，会把计数抬高。先把非本次探针的用户临时
    // 关掉，让 sent/skipped 只反映 A/B/C，跑完恢复。
    const probeIds = [userIdA, userIdB, userIdC];
    const others = await db
      .select({ id: users.id })
      .from(users)
      .where(
        and(eq(users.notifyEmail, true), notInArray(users.id, probeIds)),
      );
    const otherIds = others.map((u) => u.id);

    if (otherIds.length > 0) {
      await db
        .update(users)
        .set({ notifyEmail: false })
        .where(inArray(users.id, otherIds));
    }

    try {
      const result = await sendDailyDigests(BASE_URL);
      expect(result.sent).toBe(1);
      expect(result.skipped).toBe(1);
      expect(result.failed).toBe(0);
    } finally {
      if (otherIds.length > 0) {
        await db
          .update(users)
          .set({ notifyEmail: true })
          .where(inArray(users.id, otherIds));
      }
    }
  });
});
