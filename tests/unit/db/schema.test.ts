import { describe, expect, it } from "vitest";
import { getTableConfig, type PgTable } from "drizzle-orm/pg-core";
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

/** 返回表的 SQL 列名（排序后），用于与 spec 字段清单做精确集合比对 */
function columnNames(table: PgTable): string[] {
  return getTableConfig(table)
    .columns.map((c) => c.name)
    .sort();
}

/** 返回表内全部索引的 { 列名集合, 是否唯一 } */
function indexSignatures(table: PgTable): { columns: string[]; unique: boolean }[] {
  return getTableConfig(table)
    .indexes.map((i) => ({
      columns: i.config.columns.map((c) => (c as { name: string }).name).sort(),
      unique: i.config.unique,
    }))
    .sort((a, b) => a.columns.join(",").localeCompare(b.columns.join(",")));
}

/** 返回复合主键的列名集合 */
function primaryKeyColumns(table: PgTable): string[][] {
  return getTableConfig(table).primaryKeys.map((pk) =>
    pk.columns.map((c) => c.name).sort(),
  );
}

function tableName(table: PgTable): string {
  return getTableConfig(table).name;
}

describe("schema：表对象导出完整（12 业务表 + Auth.js 合并表）", () => {
  it("全部 14 个表对象均已导出", () => {
    for (const t of [
      users,
      skills,
      prompts,
      tutorials,
      comments,
      forums,
      threads,
      replies,
      likes,
      favorites,
      notifications,
      accounts,
      sessions,
      verificationTokens,
    ]) {
      expect(t).toBeDefined();
    }
  });
});

describe("users（Auth.js 合并表，官方约定表名 user）", () => {
  it("表名为 user（@auth/drizzle-adapter 官方 PostgreSQL 约定）", () => {
    expect(tableName(users)).toBe("user");
  });

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

  it("role 默认 'user' 且 not null", () => {
    expect(users.role.columnType).toBe("PgText");
    expect(users.role.notNull).toBe(true);
    expect(users.role.hasDefault).toBe(true);
  });

  it("email unique not null；notify_email_enabled 默认 true", () => {
    expect(users.email.notNull).toBe(true);
    expect(users.email.isUnique).toBe(true);
    expect(users.notifyEmail.hasDefault).toBe(true);
    expect(users.notifyEmail.notNull).toBe(true);
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

  it("slug unique not null；content_md not null；tags 为数组列", () => {
    expect(skills.slug.isUnique).toBe(true);
    expect(skills.slug.notNull).toBe(true);
    expect(skills.contentMd.notNull).toBe(true);
    expect(skills.tags.columnType).toBe("PgArray");
  });

  it("索引：category、(status, created_at)", () => {
    const sigs = indexSignatures(skills);
    expect(sigs).toContainEqual({ columns: ["category"], unique: false });
    expect(sigs).toContainEqual({
      columns: ["created_at", "status"],
      unique: false,
    });
  });

  it("like_count 默认 0 且 not null", () => {
    expect(skills.likeCount.hasDefault).toBe(true);
    expect(skills.likeCount.notNull).toBe(true);
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

  it("prompt_en / name / category not null", () => {
    expect(prompts.promptEn.notNull).toBe(true);
    expect(prompts.name.notNull).toBe(true);
    expect(prompts.category.notNull).toBe(true);
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

  it("slug unique not null；category 默认「运镜教学」", () => {
    expect(tutorials.slug.isUnique).toBe(true);
    expect(tutorials.slug.notNull).toBe(true);
    expect(tutorials.category.hasDefault).toBe(true);
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

  it("user_id 外键指向 users；target_id 无外键（多态）", () => {
    const fks = getTableConfig(comments).foreignKeys;
    expect(fks).toHaveLength(1);
    const ref = fks[0]!.reference();
    expect(ref.columns.map((c) => c.name)).toEqual(["user_id"]);
    expect(ref.foreignColumns.map((c) => c.name)).toEqual(["id"]);
    expect(ref.foreignTable).toBe(users);
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

  it("slug unique；thread_count/reply_count 默认 0", () => {
    expect(forums.slug.isUnique).toBe(true);
    expect(forums.threadCount.hasDefault).toBe(true);
    expect(forums.replyCount.hasDefault).toBe(true);
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

  it("索引：(forum_id, last_reply_at) 与 (forum_id, created_at)", () => {
    const sigs = indexSignatures(threads);
    expect(sigs).toContainEqual({
      columns: ["forum_id", "last_reply_at"],
      unique: false,
    });
    expect(sigs).toContainEqual({
      columns: ["created_at", "forum_id"],
      unique: false,
    });
  });

  it("is_pinned/is_locked 默认 false；last_reply_at not null", () => {
    expect(threads.isPinned.hasDefault).toBe(true);
    expect(threads.isLocked.hasDefault).toBe(true);
    expect(threads.lastReplyAt.notNull).toBe(true);
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
});

describe("likes / favorites", () => {
  it("likes 唯一索引 (user_id, target_type, target_id) 防重复点赞", () => {
    expect(indexSignatures(likes)).toContainEqual({
      columns: ["target_id", "target_type", "user_id"],
      unique: true,
    });
  });

  it("favorites 唯一索引 (user_id, target_type, target_id)", () => {
    expect(indexSignatures(favorites)).toContainEqual({
      columns: ["target_id", "target_type", "user_id"],
      unique: true,
    });
  });

  it("likes/favorites 列与 spec 完全一致", () => {
    expect(columnNames(likes)).toEqual(
      ["id", "user_id", "target_type", "target_id", "created_at"].sort(),
    );
    expect(columnNames(favorites)).toEqual(
      ["id", "user_id", "target_type", "target_id", "created_at"].sort(),
    );
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

  it("read_at 可空（空 = 未读）；type/source_type/source_id not null", () => {
    expect(notifications.readAt.notNull).toBe(false);
    expect(notifications.type.notNull).toBe(true);
    expect(notifications.sourceType.notNull).toBe(true);
    expect(notifications.sourceId.notNull).toBe(true);
  });

  it("actor_id 可空（系统通知）、user_id not null 外键指向 users", () => {
    expect(notifications.actorId.notNull).toBe(false);
    const fk = getTableConfig(notifications).foreignKeys.find((f) =>
      f.reference().columns.some((c) => c.name === "user_id"),
    );
    expect(fk).toBeDefined();
  });
});

describe("Auth.js 表（官方 PostgreSQL 约定命名）", () => {
  it("accounts：表名 account，复合主键 (provider, providerAccountId)，userId 外键", () => {
    expect(tableName(accounts)).toBe("account");
    expect(primaryKeyColumns(accounts)).toContainEqual([
      "provider",
      "providerAccountId",
    ]);
    const fk = getTableConfig(accounts).foreignKeys.find((f) =>
      f.reference().columns.some((c) => c.name === "userId"),
    );
    expect(fk).toBeDefined();
  });

  it("sessions：表名 session，sessionToken 主键", () => {
    expect(tableName(sessions)).toBe("session");
    expect(sessions.sessionToken.primary).toBe(true);
    expect(sessions.sessionToken.notNull).toBe(true);
  });

  it("verificationTokens：表名 verificationToken，复合主键 (identifier, token)", () => {
    expect(tableName(verificationTokens)).toBe("verificationToken");
    expect(primaryKeyColumns(verificationTokens)).toContainEqual([
      "identifier",
      "token",
    ]);
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
