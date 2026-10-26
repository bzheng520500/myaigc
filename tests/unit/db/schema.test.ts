import { describe, expect, it } from "vitest";
import { is, SQL } from "drizzle-orm";
import {
  getTableConfig,
  SQLiteTable,
  type AnySQLiteTable,
  type SQLiteColumn,
} from "drizzle-orm/sqlite-core";
import {
  accounts,
  comments,
  favorites,
  forums,
  likes,
  notifications,
  prompts,
  replies,
  sessions,
  skills,
  threads,
  tutorials,
  users,
  verificationTokens,
  // 类型导出（编译期校验存在性）
  type Comment,
  type Favorite,
  type Forum,
  type Like,
  type NewComment,
  type NewFavorite,
  type NewForum,
  type NewLike,
  type NewNotification,
  type NewPrompt,
  type NewReply,
  type NewSkill,
  type NewThread,
  type NewTutorial,
  type NewUser,
  type Notification,
  type Prompt,
  type Reply,
  type Skill,
  type Thread,
  type Tutorial,
  type User,
} from "@/lib/db/schema";

/**
 * schema 契约测试（Cloudflare D1 / SQLite 架构）。
 *
 * PostgreSQL(Neon) → D1 迁移后，schema 由 drizzle-orm/sqlite-core 定义：
 * - id 为 text（`$defaultFn` 生成 uuid）
 * - 时间列为 integer + `timestamp_ms`（Unix 毫秒）
 * - 布尔列为 integer + boolean mode（存 0/1）
 * - tags 为 text + json mode
 *
 * 本文件不连库：全部断言基于 drizzle 列对象属性与 `getTableConfig()`，
 * 既验证表名 / 列名 / 索引 / 外键 / 复合主键的名字不变，也验证列类型契约。
 */

/** 返回表配置（sqlite-core 版本，含 indexes / foreignKeys / primaryKeys） */
function config(table: AnySQLiteTable) {
  return getTableConfig(table);
}

/** 返回表的 SQL 列名（排序后），用于与 spec 字段清单做精确集合比对 */
function columnNames(table: AnySQLiteTable): string[] {
  return config(table)
    .columns.map((c) => c.name)
    .sort();
}

/**
 * 索引列 → SQL 列名。
 *
 * sqlite-core 的 `IndexColumn` 是 `SQLiteColumn | SQL`（支持表达式索引），
 * 本 schema 只用普通列；遇到表达式直接抛错，避免断言悄悄漏检。
 */
function indexColumnName(column: unknown): string {
  const name = (column as { name?: unknown }).name;
  if (typeof name !== "string") {
    throw new Error("索引列必须是具名表列（schema 不应使用表达式索引）");
  }
  return name;
}

/** 返回表内全部索引的 { 名字, 列名集合, 是否唯一 }（按索引名排序） */
function indexSignatures(
  table: AnySQLiteTable,
): { name: string; columns: string[]; unique: boolean }[] {
  return config(table)
    .indexes.map((i) => ({
      name: i.config.name,
      columns: i.config.columns.map(indexColumnName).sort(),
      unique: i.config.unique,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** 返回复合主键的列名集合 */
function primaryKeyColumns(table: AnySQLiteTable): string[][] {
  return config(table).primaryKeys.map((pk) =>
    pk.columns.map((c) => c.name).sort(),
  );
}

function tableName(table: AnySQLiteTable): string {
  return config(table).name;
}

/** 按列名取列对象（断言列类型契约时用） */
function column(table: AnySQLiteTable, name: string): SQLiteColumn {
  const found = config(table).columns.find((c) => c.name === name);
  if (!found) throw new Error(`列 ${name} 不存在`);
  return found;
}

/** 时间列（integer + timestamp_ms）契约 */
function expectTimestampColumn(col: SQLiteColumn, opts?: { nullable?: boolean }) {
  // drizzle sqlite-core 的 timestamp 列：columnType=SQLiteTimestamp、dataType=date
  expect(col.columnType).toBe("SQLiteTimestamp");
  expect(col.dataType).toBe("date");
  // DDL 里必须是 integer 而不是 PG 的 timestamptz
  expect(col.getSQLType()).toBe("integer");
  expect((col as SQLiteColumn & { mode?: string }).mode).toBe("timestamp_ms");
  // 存储契约：Unix 毫秒（D1 integer 列）
  const ms = 1_700_000_000_123;
  expect(col.mapToDriverValue(new Date(ms))).toBe(ms);
  const back = col.mapFromDriverValue(ms);
  expect(back).toBeInstanceOf(Date);
  expect((back as Date).getTime()).toBe(ms);
  if (opts?.nullable) {
    expect(col.notNull).toBe(false);
  } else {
    expect(col.notNull).toBe(true);
  }
}

/** 布尔列（integer + boolean mode）契约 */
function expectBooleanColumn(col: SQLiteColumn, defaultValue: boolean) {
  expect(col.columnType).toBe("SQLiteBoolean");
  expect(col.dataType).toBe("boolean");
  expect(col.getSQLType()).toBe("integer");
  expect((col as SQLiteColumn & { mode?: string }).mode).toBe("boolean");
  expect(col.notNull).toBe(true);
  expect(col.hasDefault).toBe(true);
  expect(col.default).toBe(defaultValue);
  // 存储契约：true → 1、false → 0
  expect(col.mapToDriverValue(true)).toBe(1);
  expect(col.mapToDriverValue(false)).toBe(0);
  expect(col.mapFromDriverValue(1)).toBe(true);
  expect(col.mapFromDriverValue(0)).toBe(false);
}

/** id 主键列契约：sqlite text + $defaultFn 生成 uuid */
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function expectUuidIdColumn(col: SQLiteColumn) {
  expect(col.columnType).toBe("SQLiteText");
  expect(col.dataType).toBe("string");
  expect(col.getSQLType()).toBe("text");
  expect(col.primary).toBe(true);
  expect(col.notNull).toBe(true); // primaryKey 隐式 not null
  expect(col.hasDefault).toBe(true);
  expect(typeof col.defaultFn).toBe("function");
  const first = col.defaultFn?.();
  const second = col.defaultFn?.();
  expect(typeof first).toBe("string");
  expect(first).toMatch(UUID_RE);
  expect(first).not.toBe(second); // 每次生成新 uuid
}

describe("schema：14 个表对象（12 业务表 + Auth.js 三表 + users 合并表）", () => {
  it("全部表对象均来自 sqliteTable，且表名与迁移前一致", () => {
    const expected: [AnySQLiteTable, string][] = [
      [users, "user"],
      [skills, "skills"],
      [prompts, "prompts"],
      [tutorials, "tutorials"],
      [comments, "comments"],
      [forums, "forums"],
      [threads, "threads"],
      [replies, "replies"],
      [likes, "likes"],
      [favorites, "favorites"],
      [notifications, "notifications"],
      [accounts, "account"],
      [sessions, "session"],
      [verificationTokens, "verificationToken"],
    ];
    expect(expected).toHaveLength(14);
    for (const [table, name] of expected) {
      // 表对象必须是 sqlite-core 的 SQLiteTable（而非 pg-core）
      expect(is(table, SQLiteTable)).toBe(true);
      expect(tableName(table)).toBe(name);
    }
  });
});

describe("users（Auth.js 合并表，官方约定表名 user）", () => {
  it("列与 spec 第 5 节 + Auth.js 必需字段完全一致", () => {
    expect(columnNames(users)).toEqual(
      [
        "id",
        "name",
        "email",
        "emailVerified", // Auth.js 官方 schema 必需
        "image",
        "role",
        "notify_email_enabled", // spec likes 节追加
        "created_at",
      ].sort(),
    );
  });

  it("id 为 sqlite text 主键且 $defaultFn 生成 uuid", () => {
    expectUuidIdColumn(users.id);
  });

  it("role 为 text 默认 'user' 且 not null", () => {
    const col = column(users, "role");
    expect(col.columnType).toBe("SQLiteText");
    expect(col.notNull).toBe(true);
    expect(col.hasDefault).toBe(true);
    expect(col.default).toBe("user");
  });

  it("email unique not null；notify_email_enabled 为 boolean 列默认 true", () => {
    const email = column(users, "email");
    expect(email.notNull).toBe(true);
    expect(email.isUnique).toBe(true);
    expectBooleanColumn(users.notifyEmail, true);
  });

  it("emailVerified 可空；created_at 为 integer timestamp_ms 且 not null", () => {
    expectTimestampColumn(users.emailVerified, { nullable: true });
    expectTimestampColumn(users.createdAt);
    expect(is(users.createdAt.default, SQL)).toBe(true);
  });
});

describe("skills", () => {
  it("列与 spec 完全一致（含 like_count 冗余计数）", () => {
    expect(columnNames(skills)).toEqual(
      [
        "id",
        "slug",
        "name",
        "description",
        "content_md",
        "category",
        "tags",
        "author_id",
        "source",
        "status",
        "view_count",
        "copy_count",
        "like_count",
        "created_at",
        "updated_at",
      ].sort(),
    );
  });

  it("id/uuid 主键；slug unique not null；content_md not null", () => {
    expectUuidIdColumn(skills.id);
    expect(skills.slug.isUnique).toBe(true);
    expect(skills.slug.notNull).toBe(true);
    expect(skills.contentMd.notNull).toBe(true);
  });

  it("tags 为 sqlite text 的 json 模式（读写自动 JSON 序列化）", () => {
    const tags = skills.tags;
    expect(tags.columnType).toBe("SQLiteTextJson");
    expect(tags.dataType).toBe("json");
    expect(tags.getSQLType()).toBe("text");
    expect(tags.notNull).toBe(false); // 可空
    expect(tags.mapToDriverValue(["运镜", "测试"])).toBe('["运镜","测试"]');
    expect(tags.mapFromDriverValue('["运镜","测试"]')).toEqual(["运镜", "测试"]);
  });

  it("索引命名不变：category、(status, created_at)、view_count（终审 F5 热度排序）", () => {
    expect(indexSignatures(skills)).toEqual([
      { name: "skills_category_idx", columns: ["category"], unique: false },
      {
        name: "skills_status_created_at_idx",
        columns: ["created_at", "status"],
        unique: false,
      },
      {
        name: "skills_view_count_idx",
        columns: ["view_count"],
        unique: false,
      },
    ]);
  });

  it("时间列均为 integer timestamp_ms；like_count 默认 0 且 not null", () => {
    expectTimestampColumn(skills.createdAt);
    expectTimestampColumn(skills.updatedAt);
    expect(skills.likeCount.hasDefault).toBe(true);
    expect(skills.likeCount.notNull).toBe(true);
    expect(skills.likeCount.default).toBe(0);
  });

  it("author_id 外键指向 user.id（可空：内置内容无作者）", () => {
    expect(columnNames(skills)).toContain("author_id");
    expect(skills.authorId.notNull).toBe(false);
    expect(config(skills).foreignKeys.map((fk) => fk.getName())).toEqual([
      "skills_author_id_user_id_fk",
    ]);
  });
});

describe("prompts（运镜提示词条目）", () => {
  it("列与 spec 完全一致", () => {
    expect(columnNames(prompts)).toEqual(
      [
        "id",
        "name",
        "category",
        "prompt_en",
        "prompt_zh",
        "notes",
        "image_url",
        "source_doc",
        "sort_order",
        "copy_count",
        "created_at",
      ].sort(),
    );
  });

  it("id/uuid 主键；prompt_en / name / category not null；created_at timestamp_ms", () => {
    expectUuidIdColumn(prompts.id);
    expect(prompts.promptEn.notNull).toBe(true);
    expect(prompts.name.notNull).toBe(true);
    expect(prompts.category.notNull).toBe(true);
    expectTimestampColumn(prompts.createdAt);
  });
});

describe("tutorials", () => {
  it("列与 spec 完全一致", () => {
    expect(columnNames(tutorials)).toEqual(
      [
        "id",
        "slug",
        "title",
        "summary",
        "content_md",
        "category",
        "sort_order",
        "created_at",
      ].sort(),
    );
  });

  it("id/uuid 主键；slug unique not null；category 默认「运镜教学」", () => {
    expectUuidIdColumn(tutorials.id);
    expect(tutorials.slug.isUnique).toBe(true);
    expect(tutorials.slug.notNull).toBe(true);
    expect(tutorials.category.hasDefault).toBe(true);
    expect(tutorials.category.default).toBe("运镜教学");
    expectTimestampColumn(tutorials.createdAt);
  });
});

describe("comments（多态关联，无目标外键）", () => {
  it("列与 spec 完全一致（含 like_count）", () => {
    expect(columnNames(comments)).toEqual(
      [
        "id",
        "user_id",
        "target_type",
        "target_id",
        "content",
        "status",
        "like_count",
        "created_at",
      ].sort(),
    );
  });

  it("id/uuid 主键；user_id 外键指向 user.id（名字不变）", () => {
    expectUuidIdColumn(comments.id);
    const fks = config(comments).foreignKeys;
    expect(fks.map((fk) => fk.getName())).toEqual([
      "comments_user_id_user_id_fk",
    ]);
    const ref = fks[0]!.reference();
    expect(ref.columns.map((c) => c.name)).toEqual(["user_id"]);
    expect(ref.foreignColumns.map((c) => c.name)).toEqual(["id"]);
    expect(ref.foreignTable).toBe(users);
  });

  it("索引命名不变：(target_type, target_id)（终审 F5，评论区多态目标拉取路径）", () => {
    expect(indexSignatures(comments)).toEqual([
      {
        name: "comments_target_idx",
        columns: ["target_id", "target_type"],
        unique: false,
      },
    ]);
  });

  it("created_at 为 integer timestamp_ms；like_count 默认 0", () => {
    expectTimestampColumn(comments.createdAt);
    expect(comments.likeCount.default).toBe(0);
  });
});

describe("forums", () => {
  it("列与 spec 完全一致", () => {
    expect(columnNames(forums)).toEqual(
      [
        "id",
        "slug",
        "name",
        "description",
        "sort_order",
        "thread_count",
        "reply_count",
        "created_at",
      ].sort(),
    );
  });

  it("id/uuid 主键；slug unique；thread_count/reply_count 默认 0", () => {
    expectUuidIdColumn(forums.id);
    expect(forums.slug.isUnique).toBe(true);
    expect(forums.threadCount.hasDefault).toBe(true);
    expect(forums.replyCount.hasDefault).toBe(true);
    expect(forums.threadCount.default).toBe(0);
    expect(forums.replyCount.default).toBe(0);
    expectTimestampColumn(forums.createdAt);
  });
});

describe("threads", () => {
  it("列与 spec 完全一致（含 like_count）", () => {
    expect(columnNames(threads)).toEqual(
      [
        "id",
        "forum_id",
        "author_id",
        "title",
        "content_md",
        "status",
        "is_pinned",
        "is_locked",
        "reply_count",
        "view_count",
        "like_count",
        "last_reply_at",
        "created_at",
        "updated_at",
      ].sort(),
    );
  });

  it("id/uuid 主键；forum_id / author_id 外键名字不变", () => {
    expectUuidIdColumn(threads.id);
    expect(config(threads).foreignKeys.map((fk) => fk.getName()).sort()).toEqual([
      "threads_author_id_user_id_fk",
      "threads_forum_id_forums_id_fk",
    ]);
  });

  it("索引命名不变：(forum_id, last_reply_at) 与 (forum_id, created_at)", () => {
    expect(indexSignatures(threads)).toEqual([
      {
        name: "threads_forum_created_at_idx",
        columns: ["created_at", "forum_id"],
        unique: false,
      },
      {
        name: "threads_forum_last_reply_idx",
        columns: ["forum_id", "last_reply_at"],
        unique: false,
      },
    ]);
  });

  it("is_pinned/is_locked 为 boolean 列默认 false；last_reply_at not null", () => {
    expectBooleanColumn(threads.isPinned, false);
    expectBooleanColumn(threads.isLocked, false);
    expectTimestampColumn(threads.lastReplyAt);
    expectTimestampColumn(threads.createdAt);
    expectTimestampColumn(threads.updatedAt);
  });
});

describe("replies", () => {
  it("列与 spec 完全一致（含 like_count）", () => {
    expect(columnNames(replies)).toEqual(
      [
        "id",
        "thread_id",
        "author_id",
        "content_md",
        "floor_number",
        "status",
        "like_count",
        "created_at",
      ].sort(),
    );
  });

  it("id/uuid 主键；thread_id / author_id 外键名字不变；floor_number not null", () => {
    expectUuidIdColumn(replies.id);
    expect(config(replies).foreignKeys.map((fk) => fk.getName()).sort()).toEqual([
      "replies_author_id_user_id_fk",
      "replies_thread_id_threads_id_fk",
    ]);
    expect(replies.floorNumber.notNull).toBe(true);
    expectTimestampColumn(replies.createdAt);
  });
});

describe("likes / favorites", () => {
  it("likes 唯一索引 (user_id, target_type, target_id) 防重复点赞（名字不变）", () => {
    expect(indexSignatures(likes)).toEqual([
      {
        name: "likes_user_target_unique",
        columns: ["target_id", "target_type", "user_id"],
        unique: true,
      },
    ]);
  });

  it("favorites 唯一索引 (user_id, target_type, target_id)（名字不变）", () => {
    expect(indexSignatures(favorites)).toEqual([
      {
        name: "favorites_user_target_unique",
        columns: ["target_id", "target_type", "user_id"],
        unique: true,
      },
    ]);
  });

  it("likes/favorites 列与 spec 完全一致", () => {
    expect(columnNames(likes)).toEqual(
      ["id", "user_id", "target_type", "target_id", "created_at"].sort(),
    );
    expect(columnNames(favorites)).toEqual(
      ["id", "user_id", "target_type", "target_id", "created_at"].sort(),
    );
    expectUuidIdColumn(likes.id);
    expectUuidIdColumn(favorites.id);
    expectTimestampColumn(likes.createdAt);
    expectTimestampColumn(favorites.createdAt);
  });
});

describe("notifications", () => {
  it("列与 spec 完全一致", () => {
    expect(columnNames(notifications)).toEqual(
      [
        "id",
        "user_id",
        "actor_id",
        "type",
        "source_type",
        "source_id",
        "read_at",
        "created_at",
      ].sort(),
    );
  });

  it("id/uuid 主键；read_at 可空（空 = 未读）；type/source_type/source_id not null", () => {
    expectUuidIdColumn(notifications.id);
    expectTimestampColumn(notifications.readAt, { nullable: true });
    expectTimestampColumn(notifications.createdAt);
    expect(notifications.type.notNull).toBe(true);
    expect(notifications.sourceType.notNull).toBe(true);
    expect(notifications.sourceId.notNull).toBe(true);
  });

  it("actor_id 可空（系统通知）、user_id not null 外键指向 users", () => {
    expect(notifications.actorId.notNull).toBe(false);
    const fks = config(notifications).foreignKeys;
    expect(fks.map((fk) => fk.getName()).sort()).toEqual([
      "notifications_actor_id_user_id_fk",
      "notifications_user_id_user_id_fk",
    ]);
    const userFk = fks.find((f) =>
      f.reference().columns.some((c) => c.name === "user_id"),
    );
    expect(userFk?.reference().foreignTable).toBe(users);
  });

  it("索引命名不变：(user_id, read_at)（终审 F5，本人未读计数与列表的高频路径）", () => {
    expect(indexSignatures(notifications)).toEqual([
      {
        name: "notifications_user_read_idx",
        columns: ["read_at", "user_id"],
        unique: false,
      },
    ]);
  });
});

describe("Auth.js 表（官方 SQLite 约定命名）", () => {
  it("accounts：表名 account，复合主键 (provider, providerAccountId) 名字不变，userId 外键级联删除", () => {
    expect(tableName(accounts)).toBe("account");
    const pks = config(accounts).primaryKeys;
    expect(primaryKeyColumns(accounts)).toEqual([["provider", "providerAccountId"]]);
    expect(pks[0]!.getName()).toBe("account_provider_providerAccountId_pk");

    const fk = config(accounts).foreignKeys.find((f) =>
      f.reference().columns.some((c) => c.name === "userId"),
    );
    expect(fk?.getName()).toBe("account_userId_user_id_fk");
    expect(fk?.onDelete).toBe("cascade");
  });

  it("sessions：表名 session，sessionToken 主键，expires 为 integer timestamp_ms", () => {
    expect(tableName(sessions)).toBe("session");
    expect(sessions.sessionToken.primary).toBe(true);
    expect(sessions.sessionToken.notNull).toBe(true);
    expect(sessions.sessionToken.getSQLType()).toBe("text");
    expect(primaryKeyColumns(sessions)).toEqual([]); // 列级主键，非复合
    expectTimestampColumn(sessions.expires);
    const fk = config(sessions).foreignKeys[0];
    expect(fk?.getName()).toBe("session_userId_user_id_fk");
    expect(fk?.onDelete).toBe("cascade");
  });

  it("verificationTokens：表名 verificationToken，复合主键 (identifier, token) 名字不变", () => {
    expect(tableName(verificationTokens)).toBe("verificationToken");
    expect(primaryKeyColumns(verificationTokens)).toEqual([
      ["identifier", "token"],
    ]);
    expect(
      config(verificationTokens).primaryKeys[0]!.getName(),
    ).toBe("verificationToken_identifier_token_pk");
    expectTimestampColumn(verificationTokens.expires);
  });
});

describe("类型导出（编译期存在性）", () => {
  it("Select/Insert 类型可被引用且结构一致", () => {
    const selectUser: User = { } as unknown as User;
    const insertUser: NewUser = { } as NewUser;
    const selectSkill: Skill = { } as unknown as Skill;
    const insertSkill: NewSkill = { } as NewSkill;
    const selectPrompt: Prompt = { } as unknown as Prompt;
    const insertPrompt: NewPrompt = { } as NewPrompt;
    const selectTutorial: Tutorial = { } as unknown as Tutorial;
    const insertTutorial: NewTutorial = { } as NewTutorial;
    const selectComment: Comment = { } as unknown as Comment;
    const insertComment: NewComment = { } as NewComment;
    const selectForum: Forum = { } as unknown as Forum;
    const insertForum: NewForum = { } as NewForum;
    const selectThread: Thread = { } as unknown as Thread;
    const insertThread: NewThread = { } as NewThread;
    const selectReply: Reply = { } as unknown as Reply;
    const insertReply: NewReply = { } as NewReply;
    const selectLike: Like = { } as unknown as Like;
    const insertLike: NewLike = { } as NewLike;
    const selectFavorite: Favorite = { } as unknown as Favorite;
    const insertFavorite: NewFavorite = { } as NewFavorite;
    const selectNotification: Notification = { } as unknown as Notification;
    const insertNotification: NewNotification = { } as NewNotification;
    // 引用即校验（未用变量以 void 消除 lint 噪音）
    void [selectUser, insertUser, selectSkill, insertSkill, selectPrompt, insertPrompt, selectTutorial, insertTutorial, selectComment, insertComment, selectForum, insertForum, selectThread, insertThread, selectReply, insertReply, selectLike, insertLike, selectFavorite, insertFavorite, selectNotification, insertNotification];
    expect(true).toBe(true);
  });
});
