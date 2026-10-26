/**
 * AI影视工坊全站数据层 schema（唯一权威来源：docs spec 第 5 节数据模型）。
 *
 * 共 12 张业务表（6 内容 + 6 社区）+ Auth.js 适配器所需的
 * accounts / sessions / verificationTokens（users 与业务字段合并为一张）。
 *
 * Auth.js 四表按 @auth/drizzle-adapter 官方 SQLite 约定：
 * 数据库表名 user / account / session / verificationToken，导出对象名用复数。
 * 时间列统一存 Unix 毫秒（integer timestamp_ms），布尔列存 0/1。
 */
import { sql } from "drizzle-orm";
import {
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import type { AdapterAccountType } from "next-auth/adapters";

/* ------------------------------------------------------------------ */
/* users —— Auth.js 合并表（官方字段 + 业务字段 role / notify_email_enabled） */
/* ------------------------------------------------------------------ */

export const users = sqliteTable("user", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  name: text("name"), // 默认取邮箱前缀（应用层处理）
  email: text("email").unique().notNull(),
  emailVerified: integer("emailVerified", { mode: "timestamp_ms" }),
  image: text("image"),
  role: text("role").default("user").notNull(), // user / admin
  notifyEmail: integer("notify_email_enabled", { mode: "boolean" })
    .default(true)
    .notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .default(sql`(unixepoch() * 1000)`)
    .notNull(),
});

/* ------------------------------------------------------------------ */
/* skills —— 技能文档（内置导入 + 用户上传）                              */
/* ------------------------------------------------------------------ */

export const skills = sqliteTable(
  "skills",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    slug: text("slug").unique().notNull(),
    name: text("name").notNull(),
    description: text("description"),
    contentMd: text("content_md").notNull(),
    category: text("category").notNull(),
    tags: text("tags", { mode: "json" }).$type<string[]>(),
    authorId: text("author_id").references(() => users.id), // 内置内容无作者，可空
    source: text("source"), // builtin / user
    status: text("status").default("published").notNull(), // published / removed
    viewCount: integer("view_count").default(0).notNull(),
    copyCount: integer("copy_count").default(0).notNull(),
    likeCount: integer("like_count").default(0).notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .default(sql`(unixepoch() * 1000)`)
      .notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .default(sql`(unixepoch() * 1000)`)
      .notNull(),
  },
  (t) => [
    index("skills_category_idx").on(t.category),
    index("skills_status_created_at_idx").on(t.status, t.createdAt),
    // 终审 F5：最热排序（view_count desc）走索引，避免全表排序
    index("skills_view_count_idx").on(t.viewCount),
  ],
);

/* ------------------------------------------------------------------ */
/* prompts —— 运镜提示词条目                                             */
/* ------------------------------------------------------------------ */

export const prompts = sqliteTable("prompts", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  name: text("name").notNull(),
  category: text("category").notNull(), // 基础运镜 / 组合运镜 / 特效运镜 / 电影级组合
  promptEn: text("prompt_en").notNull(),
  promptZh: text("prompt_zh"),
  notes: text("notes"),
  imageUrl: text("image_url"),
  sourceDoc: text("source_doc"),
  sortOrder: integer("sort_order"),
  copyCount: integer("copy_count").default(0).notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .default(sql`(unixepoch() * 1000)`)
    .notNull(),
});

/* ------------------------------------------------------------------ */
/* tutorials —— 运镜教学                                                 */
/* ------------------------------------------------------------------ */

export const tutorials = sqliteTable("tutorials", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  slug: text("slug").unique().notNull(),
  title: text("title").notNull(),
  summary: text("summary"),
  contentMd: text("content_md").notNull(),
  category: text("category").default("运镜教学").notNull(),
  sortOrder: integer("sort_order"),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .default(sql`(unixepoch() * 1000)`)
    .notNull(),
});

/* ------------------------------------------------------------------ */
/* comments —— 内容评论（skill / tutorial 多态，无目标外键）               */
/* ------------------------------------------------------------------ */

export const comments = sqliteTable(
  "comments",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    targetType: text("target_type").notNull(), // skill / tutorial
    targetId: text("target_id").notNull(), // 多态目标，应用层保证存在
    content: text("content").notNull(), // 限 2000 字（应用层校验）
    status: text("status").default("visible").notNull(), // visible / hidden
    likeCount: integer("like_count").default(0).notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .default(sql`(unixepoch() * 1000)`)
      .notNull(),
  },
  (t) => [
    // 终审 F5：评论区按 (target_type, target_id) 拉取（无目标外键，靠此索引）
    index("comments_target_idx").on(t.targetType, t.targetId),
  ],
);

/* ------------------------------------------------------------------ */
/* forums / threads / replies —— 论坛（Phase 2）                         */
/* ------------------------------------------------------------------ */

export const forums = sqliteTable("forums", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  slug: text("slug").unique().notNull(),
  name: text("name").notNull(),
  description: text("description"),
  sortOrder: integer("sort_order"),
  threadCount: integer("thread_count").default(0).notNull(),
  replyCount: integer("reply_count").default(0).notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .default(sql`(unixepoch() * 1000)`)
    .notNull(),
});

export const threads = sqliteTable(
  "threads",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    forumId: text("forum_id")
      .notNull()
      .references(() => forums.id),
    authorId: text("author_id")
      .notNull()
      .references(() => users.id),
    title: text("title").notNull(), // 限 100 字（应用层校验）
    contentMd: text("content_md").notNull(), // 限 50KB（应用层校验）
    status: text("status").default("published").notNull(), // published / hidden（先发后审）
    isPinned: integer("is_pinned", { mode: "boolean" }).default(false).notNull(),
    isLocked: integer("is_locked", { mode: "boolean" }).default(false).notNull(),
    replyCount: integer("reply_count").default(0).notNull(),
    viewCount: integer("view_count").default(0).notNull(),
    likeCount: integer("like_count").default(0).notNull(),
    lastReplyAt: integer("last_reply_at", { mode: "timestamp_ms" })
      .default(sql`(unixepoch() * 1000)`)
      .notNull(), // 板块页排序依据，发帖时等于 created_at
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .default(sql`(unixepoch() * 1000)`)
      .notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .default(sql`(unixepoch() * 1000)`)
      .notNull(),
  },
  (t) => [
    index("threads_forum_last_reply_idx").on(t.forumId, t.lastReplyAt),
    index("threads_forum_created_at_idx").on(t.forumId, t.createdAt),
  ],
);

export const replies = sqliteTable("replies", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  threadId: text("thread_id")
    .notNull()
    .references(() => threads.id),
  authorId: text("author_id")
    .notNull()
    .references(() => users.id),
  contentMd: text("content_md").notNull(), // 限 10KB（应用层校验）
  floorNumber: integer("floor_number").notNull(), // 楼层号，事务内自增（应用层生成）
  status: text("status").default("visible").notNull(), // visible / hidden
  likeCount: integer("like_count").default(0).notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .default(sql`(unixepoch() * 1000)`)
    .notNull(),
});

/* ------------------------------------------------------------------ */
/* likes / favorites —— 点赞与收藏（Phase 3）                             */
/* ------------------------------------------------------------------ */

export const likes = sqliteTable(
  "likes",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    targetType: text("target_type").notNull(), // thread / reply / comment / skill
    targetId: text("target_id").notNull(), // 多态目标，应用层保证存在
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .default(sql`(unixepoch() * 1000)`)
      .notNull(),
  },
  (t) => [
    uniqueIndex("likes_user_target_unique").on(
      t.userId,
      t.targetType,
      t.targetId,
    ),
  ],
);

export const favorites = sqliteTable(
  "favorites",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    targetType: text("target_type").notNull(), // skill / thread
    targetId: text("target_id").notNull(), // 多态目标，应用层保证存在
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .default(sql`(unixepoch() * 1000)`)
      .notNull(),
  },
  (t) => [
    uniqueIndex("favorites_user_target_unique").on(
      t.userId,
      t.targetType,
      t.targetId,
    ),
  ],
);

/* ------------------------------------------------------------------ */
/* notifications —— 通知（Phase 3）                                       */
/* ------------------------------------------------------------------ */

export const notifications = sqliteTable(
  "notifications",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    userId: text("user_id")
      .notNull()
      .references(() => users.id), // 接收者
    actorId: text("actor_id").references(() => users.id), // 触发者（系统通知可空）
    type: text("type").notNull(), // thread_reply / reply_reply / skill_comment / like
    sourceType: text("source_type").notNull(), // thread / reply / comment / skill
    sourceId: text("source_id").notNull(), // 跳转目标
    readAt: integer("read_at", { mode: "timestamp_ms" }), // 空 = 未读
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .default(sql`(unixepoch() * 1000)`)
      .notNull(),
  },
  (t) => [
    // 终审 F5：通知中心「本人 + 未读」计数与列表的高频查询路径
    index("notifications_user_read_idx").on(t.userId, t.readAt),
  ],
);

/* ------------------------------------------------------------------ */
/* Auth.js 表 —— 官方 SQLite schema（@auth/drizzle-adapter 约定）         */
/* ------------------------------------------------------------------ */

export const accounts = sqliteTable(
  "account",
  {
    userId: text("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: text("type").$type<AdapterAccountType>().notNull(),
    provider: text("provider").notNull(),
    providerAccountId: text("providerAccountId").notNull(),
    refresh_token: text("refresh_token"),
    access_token: text("access_token"),
    expires_at: integer("expires_at"),
    token_type: text("token_type"),
    scope: text("scope"),
    id_token: text("id_token"),
    session_state: text("session_state"),
  },
  (account) => [
    primaryKey({
      columns: [account.provider, account.providerAccountId],
    }),
  ],
);

export const sessions = sqliteTable("session", {
  sessionToken: text("sessionToken").primaryKey(),
  userId: text("userId")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  expires: integer("expires", { mode: "timestamp_ms" }).notNull(),
});

export const verificationTokens = sqliteTable(
  "verificationToken",
  {
    identifier: text("identifier").notNull(),
    token: text("token").notNull(),
    expires: integer("expires", { mode: "timestamp_ms" }).notNull(),
  },
  (vt) => [primaryKey({ columns: [vt.identifier, vt.token] })],
);

/* ------------------------------------------------------------------ */
/* 类型导出（每表 Select / Insert 两个类型）                                */
/* ------------------------------------------------------------------ */

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Skill = typeof skills.$inferSelect;
export type NewSkill = typeof skills.$inferInsert;
export type Prompt = typeof prompts.$inferSelect;
export type NewPrompt = typeof prompts.$inferInsert;
export type Tutorial = typeof tutorials.$inferSelect;
export type NewTutorial = typeof tutorials.$inferInsert;
export type Comment = typeof comments.$inferSelect;
export type NewComment = typeof comments.$inferInsert;
export type Forum = typeof forums.$inferSelect;
export type NewForum = typeof forums.$inferInsert;
export type Thread = typeof threads.$inferSelect;
export type NewThread = typeof threads.$inferInsert;
export type Reply = typeof replies.$inferSelect;
export type NewReply = typeof replies.$inferInsert;
export type Like = typeof likes.$inferSelect;
export type NewLike = typeof likes.$inferInsert;
export type Favorite = typeof favorites.$inferSelect;
export type NewFavorite = typeof favorites.$inferInsert;
export type Notification = typeof notifications.$inferSelect;
export type NewNotification = typeof notifications.$inferInsert;
