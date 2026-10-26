"use server";

import { and, eq, ne, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import type { Session } from "next-auth";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { forums, replies, threads } from "@/lib/db/schema";
import { createNotification } from "@/lib/notify";
import { recentCount } from "@/lib/ratelimit";

/**
 * 论坛发帖 / 回复 server actions（Phase 2 Task 1）。
 *
 * createReply 楼层号方案（Review Focus #1，D1 等效实现）：
 * D1 不支持交互事务（db.transaction 不可用）与 data-modifying CTE，
 * 改用 db.batch 三条语句（整批一个事务、按数组顺序执行）：
 * 1) update threads 自增 reply_count（returning 新值即 floor）
 * 2) insert replies（id 在 JS 侧 crypto.randomUUID 预生成）
 * 3) update forums reply_count + 1
 * batch 的语句在发送前统一编译，后一条拿不到前一条 RETURNING 的 JS 值，
 * 因此 insert 的 floor_number 用「同批 update 之后表状态」的 SQL 子查询
 * 求值（同一事务内顺序执行，读到的是前一条 update 的结果），跨语句依赖
 * 不经 JS。并发回复同一帖时写事务串行化 + update 先行 → floor 连续不重。
 * is_locked / status 校验写进 update 的 where（Review Focus #2：不依赖
 * 预检结果，防「预检后被 admin 锁定」的 TOCTOU）；insert 的 floor 子查询
 * 复带同样条件，帖子被隐藏/锁定/删除时返回 NULL → floor_number NOT NULL
 * 违约 → 整批回滚，threads / replies / forums 三处零漂移（与原 CTE 空
 * bumped 时「无插入、无计数变化」等价）。
 *
 * 分支顺序：登录 → 长度校验 → 目标校验 → 限流 → 写库 → revalidate，
 * 前三步不触库，vitest 无库可测（与 upload.ts 同模式）。
 */

/** 标题字数上限（schema threads.title 注释：应用层校验） */
const TITLE_MAX_LENGTH = 100;

/** 帖子正文体积上限（50KB） */
const THREAD_CONTENT_MAX = 50 * 1024;

/** 回复正文体积上限（10KB） */
const REPLY_CONTENT_MAX = 10 * 1024;

/** 发帖限流窗口（秒）：同用户 5 分钟内只允许 1 帖 */
const THREAD_RATE_WINDOW_SEC = 5 * 60;

/** 回复限流窗口（秒）：同用户 30 秒内只允许 1 条 */
const REPLY_RATE_WINDOW_SEC = 30;

/** threads.id 为 uuid 文本：非法格式直接按不存在处理，省一次无谓查询（D1 不抛类型错） */
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 登录态：auth() 抛错（无请求上下文）按未登录处理（多重载类型显式注言 Session） */
async function currentUserId(): Promise<string | null> {
  let session: Session | null = null;
  try {
    session = await auth();
  } catch {
    session = null;
  }
  return (session?.user as { id?: string } | undefined)?.id ?? null;
}

export type CreateThreadResult =
  | { ok: true; id: string }
  | { ok: false; error: string };

export type CreateReplyResult =
  | { ok: true; floor: number }
  | { ok: false; error: string };

export async function createThread(input: {
  forumSlug: string;
  title: string;
  contentMd: string;
}): Promise<CreateThreadResult> {
  // 1. 登录态
  const userId = await currentUserId();
  if (!userId) {
    return { ok: false, error: "请先登录后再发帖" };
  }

  // 2. 标题校验（trim 语义在此收口）
  const title = input.title.trim();
  if (title.length === 0) {
    return { ok: false, error: "标题不能为空" };
  }
  if (title.length > TITLE_MAX_LENGTH) {
    return { ok: false, error: "标题不能超过 100 字" };
  }

  // 3. 正文校验
  const content = input.contentMd.trim();
  if (content.length === 0) {
    return { ok: false, error: "正文不能为空" };
  }
  if (content.length > THREAD_CONTENT_MAX) {
    return { ok: false, error: "正文超过 50KB 限制" };
  }

  // 4. 板块存在性
  const [forum] = await db
    .select({ id: forums.id })
    .from(forums)
    .where(eq(forums.slug, input.forumSlug))
    .limit(1);
  if (!forum) {
    return { ok: false, error: "板块不存在" };
  }

  // 5. 限流：5 分钟窗口内已有发帖 → 拒绝
  const recentThreads = await recentCount(
    "threads",
    userId,
    THREAD_RATE_WINDOW_SEC,
  );
  if (recentThreads >= 1) {
    return { ok: false, error: "发帖太频繁，请 5 分钟后再试" };
  }

  // 6. 插入（status published）。lastReplyAt 不显式传值：与 createdAt 同为
  //    PG 端 now() 默认值，同一条 INSERT 内两列严格相等（发帖时最后回复
  //    时间即发布时间，板块页排序依据），也避免 JS/PG 时钟差
  let threadId: string;
  try {
    const [row] = await db
      .insert(threads)
      .values({
        forumId: forum.id,
        authorId: userId,
        title,
        contentMd: content,
        status: "published",
      })
      .returning({ id: threads.id });
    threadId = row.id;
    await db
      .update(forums)
      .set({ threadCount: sql`${forums.threadCount} + 1` })
      .where(eq(forums.id, forum.id));
  } catch {
    return { ok: false, error: "发布失败，请稍后再试" };
  }

  // 7. 失效板块页与论坛首页（首页有最新帖列表）
  revalidatePath(`/forum/${input.forumSlug}`);
  revalidatePath("/forum");

  return { ok: true, id: threadId };
}

export async function createReply(
  threadId: string,
  contentMd: string,
): Promise<CreateReplyResult> {
  // 1. 登录态
  const userId = await currentUserId();
  if (!userId) {
    return { ok: false, error: "请先登录后再回复" };
  }

  // 2. 正文校验
  const content = contentMd.trim();
  if (content.length === 0) {
    return { ok: false, error: "回复内容不能为空" };
  }
  if (content.length > REPLY_CONTENT_MAX) {
    return { ok: false, error: "回复内容超过 10KB 限制" };
  }

  // 3. 非法 uuid 不触库（PG 会对无效 uuid 抛类型错误）
  if (!UUID_RE.test(threadId)) {
    return { ok: false, error: "帖子不存在或已隐藏" };
  }

  // 4. 帖子预检：存在性 / hidden / 锁定（拿板块 slug 与作者 id 备用）
  const [thread] = await db
    .select({
      id: threads.id,
      authorId: threads.authorId,
      status: threads.status,
      isLocked: threads.isLocked,
      forumId: threads.forumId,
      forumSlug: forums.slug,
    })
    .from(threads)
    .innerJoin(forums, eq(threads.forumId, forums.id))
    .where(eq(threads.id, threadId))
    .limit(1);
  if (!thread || thread.status === "hidden") {
    return { ok: false, error: "帖子不存在或已隐藏" };
  }
  if (thread.isLocked) {
    return { ok: false, error: "帖子已锁定，无法回复" };
  }

  // 5. 限流：30 秒窗口内已有回复 → 拒绝
  const recentReplies = await recentCount(
    "replies",
    userId,
    REPLY_RATE_WINDOW_SEC,
  );
  if (recentReplies >= 1) {
    return { ok: false, error: "回复太频繁，请稍后再试" };
  }

  // 6. 楼层号：db.batch（本文件头注释）。
  //    reply id 在 JS 侧预生成；floor_number 由「同批 update 之后表状态」的
  //    子查询求值，不依赖 RETURNING 结果回传 JS。
  //    where 复带 status / is_locked 条件：预检到执行之间被 admin 锁定/
  //    隐藏时 update 命中 0 行；insert 的 floor 子查询复带同样条件 → NULL
  //    → floor_number NOT NULL 违约 → 整批回滚（含 forums 计数），
  //    threads / replies / forums 三处零漂移。
  //    时间戳取同一个 Date 实例：两列严格相等，对应原 CTE 的单次 now()。
  const newReplyId = crypto.randomUUID();
  const now = new Date();
  let floor: number;
  try {
    const [bumped] = await db.batch([
      db
        .update(threads)
        .set({
          replyCount: sql`${threads.replyCount} + 1`,
          lastReplyAt: now,
          updatedAt: now,
        })
        .where(
          and(
            eq(threads.id, threadId),
            ne(threads.status, "hidden"),
            eq(threads.isLocked, false),
          ),
        )
        .returning({ replyCount: threads.replyCount }),
      db.insert(replies).values({
        id: newReplyId,
        threadId,
        authorId: userId,
        contentMd: content,
        // SQLite 布尔存 0/1：is_locked = 0 即 false
        floorNumber: sql`(select ${threads.replyCount} from ${threads} where ${threads.id} = ${threadId} and ${threads.status} <> 'hidden' and ${threads.isLocked} = 0)`,
        status: "visible",
      }),
      db
        .update(forums)
        .set({ replyCount: sql`${forums.replyCount} + 1` })
        .where(eq(forums.id, thread.forumId)),
    ]);
    const row = bumped[0];
    if (!row) {
      // 理论不可达：update 0 行时 insert 已因 floor_number NULL 违约回滚
      return { ok: false, error: "帖子已锁定，无法回复" };
    }
    floor = row.replyCount;
  } catch {
    // TOCTOU（整批因 floor_number 违约回滚）或真实故障：回查最新状态
    // 区分文案（原实现由 CTE 主 select 带回 status / is_locked）
    let current: { status: string; isLocked: boolean } | undefined;
    try {
      [current] = await db
        .select({ status: threads.status, isLocked: threads.isLocked })
        .from(threads)
        .where(eq(threads.id, threadId))
        .limit(1);
    } catch {
      // 回查也失败（连接层故障等）：落到通用失败文案
    }
    if (!current || current.status === "hidden") {
      return { ok: false, error: "帖子不存在或已隐藏" };
    }
    if (current.isLocked) {
      return { ok: false, error: "帖子已锁定，无法回复" };
    }
    return { ok: false, error: "回复失败，请稍后再试" };
  }

  // 7. 失效帖子页与板块页缓存
  revalidatePath(`/forum/${thread.forumSlug}/${threadId}`);
  revalidatePath(`/forum/${thread.forumSlug}`);

  // 8. 通知（Phase 3 实装）：通知帖主 thread_reply。createNotification
  //    内部静默 catch + 自通知跳过，调用方无需再包 try/catch
  await notifyReplied(userId, thread.authorId, threadId, userId);

  return { ok: true, floor };
}

/**
 * 回复触达通知（Phase 3 实装）。
 *
 * 简化 Ruling：楼层式论坛没有「回复某层」交互（ReplyForm 只传
 * threadId），所有回复统一通知帖主（thread_reply）；reply_reply
 * 类型保留在 schema / 文案映射中，本期不产生。签名保持不变
 * （replyAuthorId 参数留作未来嵌套回复），当前调用点
 * actorId === replyAuthorId 恒成立。
 */
export async function notifyReplied(
  actorId: string,
  threadAuthorId: string,
  threadId: string,
  replyAuthorId: string,
): Promise<void> {
  void replyAuthorId; // 见上：当前无嵌套回复，参数仅为签名兼容保留
  await createNotification({
    userId: threadAuthorId,
    actorId,
    type: "thread_reply",
    sourceType: "thread",
    sourceId: threadId,
  });
}
