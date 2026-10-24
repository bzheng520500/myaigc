"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  createForum,
  deleteForum,
  setCommentStatus,
  setSkillStatus,
  setThreadFlags,
  updateForum,
  type AdminCommentRow,
  type AdminForumRow,
  type AdminSkillRow,
  type AdminThreadRow,
} from "@/lib/actions/admin";

/**
 * 管理后台主体（Task 12，client；Phase 2 Task 4 追加论坛 Tab）。
 *
 * - Tabs 三列表：Skill 管理 / 评论管理 / 论坛管理（shadcn base-nova Tabs）
 * - 表格：项目无 table 组件，手写 tailwind 简单表格
 * - 操作：调对应 server action 后 router.refresh() 拉取最新数据；
 *   pending 期间禁用全部操作按钮（防重复提交）
 * - 失败：错误码映射中文，业务文案（如「slug 已存在」）原样行内提示
 *   （layout 未挂 Toaster，与上传表单 / 评论区同理不用 toast）
 */

/** action 错误码 → 中文文案 */
const ERROR_MESSAGES: Record<string, string> = {
  forbidden: "无权限执行此操作",
  invalid: "参数无效",
  not_found: "目标不存在或已被删除",
};

const FALLBACK_ERROR = "操作失败，请稍后再试";

const SKILL_STATUS_LABELS: Record<string, string> = {
  published: "已发布",
  removed: "已下架",
};

const COMMENT_STATUS_LABELS: Record<string, string> = {
  visible: "显示中",
  hidden: "已隐藏",
};

const SOURCE_LABELS: Record<string, string> = {
  builtin: "内置",
  user: "用户上传",
};

const TARGET_TYPE_LABELS: Record<string, string> = {
  skill: "Skill",
  tutorial: "教程",
};

const THREAD_STATUS_LABELS: Record<string, string> = {
  published: "已发布",
  hidden: "已隐藏",
};

/** 表格容器 + 表头的通用样式（手写简单表格） */
const TABLE_WRAPPER = "overflow-x-auto rounded-lg border border-border";
const TABLE = "w-full text-sm";
const TH = "px-3 py-2 text-left font-medium whitespace-nowrap";
const TD = "px-3 py-2 align-top";

export function AdminClient({
  skills,
  comments,
  forums,
  threads,
}: {
  skills: AdminSkillRow[];
  comments: AdminCommentRow[];
  forums: AdminForumRow[];
  threads: AdminThreadRow[];
}) {
  const router = useRouter();
  /** 正在操作的行 key（skill:<id> / comment:<id> / forum:<id> / thread:<id>），操作期间禁用全部按钮 */
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  /** 最近一次失败操作的行 key 与中文提示 */
  const [rowError, setRowError] = useState<{
    key: string;
    message: string;
  } | null>(null);

  /** 新建板块表单（sortOrder 留空 → action 内取 max+1） */
  const [newForum, setNewForum] = useState({
    slug: "",
    name: "",
    description: "",
    sortOrder: "",
  });
  /** 正在编辑的板块 id（null = 无）；表单值预填当前行 */
  const [editingForumId, setEditingForumId] = useState<string | null>(null);
  const [editForum, setEditForum] = useState({
    name: "",
    description: "",
    sortOrder: "",
  });

  /**
   * 统一执行操作：成功 → router.refresh() 并返回 true（调用方可联动
   * 清表单 / 收起编辑行）；失败 → 行内中文提示，返回 false。
   * 论坛 action 的 error 可能是业务中文文案（非错误码），原样展示。
   */
  async function run(
    key: string,
    action: () => Promise<{ ok: boolean; error?: string }>,
  ): Promise<boolean> {
    if (pendingKey) return false;
    setPendingKey(key);
    setRowError(null);
    try {
      const result = await action();
      if (result.ok) {
        router.refresh();
        return true;
      }
      setRowError({
        key,
        message:
          ERROR_MESSAGES[result.error ?? ""] ?? result.error ?? FALLBACK_ERROR,
      });
      return false;
    } catch {
      // server action 网络异常 / 意外 reject：兜底行内中文提示
      setRowError({ key, message: FALLBACK_ERROR });
      return false;
    } finally {
      setPendingKey(null);
    }
  }

  /** 行内错误（仅当前失败行渲染） */
  function rowErrorMessage(key: string) {
    if (rowError?.key !== key) return null;
    return (
      <span className="text-xs text-destructive" role="alert">
        {rowError.message}
      </span>
    );
  }

  /** sortOrder 输入 → 数字（留空返回 undefined 走缺省逻辑；非法数字 NaN 由 PG 校验兜底） */
  function parseSortOrder(value: string): number | undefined {
    const trimmed = value.trim();
    if (trimmed === "") return undefined;
    const parsed = Number(trimmed);
    return Number.isNaN(parsed) ? undefined : parsed;
  }

  async function submitNewForum(): Promise<void> {
    const ok = await run("forum:new", () =>
      createForum({
        slug: newForum.slug.trim(),
        name: newForum.name,
        description: newForum.description.trim() || undefined,
        sortOrder: parseSortOrder(newForum.sortOrder),
      }),
    );
    if (ok) {
      setNewForum({ slug: "", name: "", description: "", sortOrder: "" });
    }
  }

  function startEditForum(forum: AdminForumRow): void {
    setEditingForumId(forum.id);
    setEditForum({
      name: forum.name,
      description: forum.description ?? "",
      sortOrder: forum.sortOrder?.toString() ?? "",
    });
  }

  async function submitEditForum(id: string): Promise<void> {
    const ok = await run(`forum:${id}`, () =>
      updateForum(id, {
        name: editForum.name,
        // 空串传给 action → 内部转 null（清空描述）；name 空串由 action 拒绝
        description: editForum.description.trim(),
        sortOrder: parseSortOrder(editForum.sortOrder),
      }),
    );
    if (ok) {
      setEditingForumId(null);
    }
  }

  return (
    <div className="pb-16">
      <Tabs defaultValue="skills">
        <TabsList aria-label="管理列表切换">
          <TabsTrigger value="skills">Skill 管理</TabsTrigger>
          <TabsTrigger value="comments">评论管理</TabsTrigger>
          <TabsTrigger value="forum">论坛管理</TabsTrigger>
        </TabsList>

        {/* Skill 管理：名称 / 分类 / 来源 / 状态 + 下架 / 恢复 */}
        <TabsContent value="skills" className="mt-4">
          {skills.length === 0 ? (
            <p className="py-12 text-center text-sm text-fg-muted">
              暂无 Skill 数据
            </p>
          ) : (
            <div className={TABLE_WRAPPER}>
              <table className={TABLE}>
                <thead>
                  <tr className="border-b border-border bg-muted/50 text-fg-muted">
                    <th className={TH}>名称</th>
                    <th className={TH}>分类</th>
                    <th className={TH}>来源</th>
                    <th className={TH}>状态</th>
                    <th className={TH}>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {skills.map((skill) => {
                    const key = `skill:${skill.id}`;
                    const removed = skill.status === "removed";
                    return (
                      <tr
                        key={skill.id}
                        className="border-b border-border last:border-b-0"
                      >
                        <td className={`${TD} font-medium`}>{skill.name}</td>
                        <td className={TD}>{skill.category}</td>
                        <td className={TD}>
                          {skill.source
                            ? (SOURCE_LABELS[skill.source] ?? skill.source)
                            : "—"}
                        </td>
                        <td className={TD}>
                          {SKILL_STATUS_LABELS[skill.status] ?? skill.status}
                        </td>
                        <td className={TD}>
                          <div className="flex flex-col items-start gap-1">
                            <Button
                              size="sm"
                              variant={removed ? "outline" : "destructive"}
                              disabled={pendingKey !== null}
                              onClick={() =>
                                run(key, () =>
                                  setSkillStatus(
                                    skill.id,
                                    removed ? "published" : "removed",
                                  ),
                                )
                              }
                            >
                              {pendingKey === key
                                ? "处理中…"
                                : removed
                                  ? "恢复"
                                  : "下架"}
                            </Button>
                            {rowErrorMessage(key)}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </TabsContent>

        {/* 评论管理：内容摘要 / 作者 / 目标类型 + 隐藏 / 恢复 */}
        <TabsContent value="comments" className="mt-4">
          {comments.length === 0 ? (
            <p className="py-12 text-center text-sm text-fg-muted">
              暂无评论数据
            </p>
          ) : (
            <div className={TABLE_WRAPPER}>
              <table className={TABLE}>
                <thead>
                  <tr className="border-b border-border bg-muted/50 text-fg-muted">
                    <th className={TH}>内容摘要</th>
                    <th className={TH}>作者</th>
                    <th className={TH}>目标类型</th>
                    <th className={TH}>状态</th>
                    <th className={TH}>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {comments.map((comment) => {
                    const key = `comment:${comment.id}`;
                    const hidden = comment.status === "hidden";
                    return (
                      <tr
                        key={comment.id}
                        className="border-b border-border last:border-b-0"
                      >
                        <td className={`${TD} max-w-md text-fg-muted`}>
                          {comment.content}
                        </td>
                        <td className={TD}>
                          {comment.authorName ?? "未命名用户"}
                        </td>
                        <td className={TD}>
                          {TARGET_TYPE_LABELS[comment.targetType] ??
                            comment.targetType}
                        </td>
                        <td className={TD}>
                          {COMMENT_STATUS_LABELS[comment.status] ??
                            comment.status}
                        </td>
                        <td className={TD}>
                          <div className="flex flex-col items-start gap-1">
                            <Button
                              size="sm"
                              variant={hidden ? "outline" : "destructive"}
                              disabled={pendingKey !== null}
                              onClick={() =>
                                run(key, () =>
                                  setCommentStatus(
                                    comment.id,
                                    hidden ? "visible" : "hidden",
                                  ),
                                )
                              }
                            >
                              {pendingKey === key
                                ? "处理中…"
                                : hidden
                                  ? "恢复"
                                  : "隐藏"}
                            </Button>
                            {rowErrorMessage(key)}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </TabsContent>

        {/* 论坛管理：板块表 + 新建/编辑表单 + 帖子标志操作 */}
        <TabsContent value="forum" className="mt-4 flex flex-col gap-6">
          {/* 板块区：新建（折叠 details）+ 列表 */}
          <section className="flex flex-col gap-3">
            <details className="rounded-lg border border-border px-4 py-3">
              <summary className="cursor-pointer text-sm font-medium">
                新建板块
              </summary>
              <form
                className="mt-3 flex flex-col gap-3"
                onSubmit={(event) => {
                  event.preventDefault();
                  void submitNewForum();
                }}
              >
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="flex flex-col gap-1 text-sm">
                    slug（小写字母 / 数字 / 连字符，2-32 位）
                    <Input
                      value={newForum.slug}
                      onChange={(event) =>
                        setNewForum((prev) => ({
                          ...prev,
                          slug: event.target.value,
                        }))
                      }
                      placeholder="new-board"
                      required
                    />
                  </label>
                  <label className="flex flex-col gap-1 text-sm">
                    名称
                    <Input
                      value={newForum.name}
                      onChange={(event) =>
                        setNewForum((prev) => ({
                          ...prev,
                          name: event.target.value,
                        }))
                      }
                      placeholder="板块名称"
                      required
                    />
                  </label>
                  <label className="flex flex-col gap-1 text-sm">
                    描述（可选）
                    <Input
                      value={newForum.description}
                      onChange={(event) =>
                        setNewForum((prev) => ({
                          ...prev,
                          description: event.target.value,
                        }))
                      }
                      placeholder="一句话介绍"
                    />
                  </label>
                  <label className="flex flex-col gap-1 text-sm">
                    排序（留空自动排到最后）
                    <Input
                      type="number"
                      value={newForum.sortOrder}
                      onChange={(event) =>
                        setNewForum((prev) => ({
                          ...prev,
                          sortOrder: event.target.value,
                        }))
                      }
                      placeholder="自动"
                    />
                  </label>
                </div>
                <div className="flex items-start gap-2">
                  <Button
                    type="submit"
                    size="sm"
                    disabled={pendingKey !== null}
                  >
                    {pendingKey === "forum:new" ? "创建中…" : "创建板块"}
                  </Button>
                  {rowErrorMessage("forum:new")}
                </div>
              </form>
            </details>

            {forums.length === 0 ? (
              <p className="py-8 text-center text-sm text-fg-muted">
                暂无板块数据
              </p>
            ) : (
              <div className={TABLE_WRAPPER}>
                <table className={TABLE}>
                  <thead>
                    <tr className="border-b border-border bg-muted/50 text-fg-muted">
                      <th className={TH}>slug</th>
                      <th className={TH}>名称</th>
                      <th className={TH}>描述</th>
                      <th className={TH}>排序</th>
                      <th className={TH}>帖数</th>
                      <th className={TH}>回复数</th>
                      <th className={TH}>操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {forums.map((forum) => {
                      const key = `forum:${forum.id}`;
                      const editing = editingForumId === forum.id;
                      return (
                        <tr
                          key={forum.id}
                          className="border-b border-border last:border-b-0"
                        >
                          <td className={`${TD} font-mono text-xs`}>
                            {forum.slug}
                          </td>
                          <td className={`${TD} font-medium`}>{forum.name}</td>
                          <td
                            className={`${TD} max-w-[200px] truncate text-fg-muted`}
                          >
                            {forum.description ?? "—"}
                          </td>
                          <td className={TD}>{forum.sortOrder ?? "—"}</td>
                          <td className={TD}>{forum.threadCount}</td>
                          <td className={TD}>{forum.replyCount}</td>
                          <td className={TD}>
                            <div className="flex flex-col items-start gap-1">
                              <div className="flex flex-wrap gap-2">
                                <Button
                                  size="sm"
                                  variant="outline"
                                  disabled={pendingKey !== null}
                                  onClick={() =>
                                    editing
                                      ? setEditingForumId(null)
                                      : startEditForum(forum)
                                  }
                                >
                                  {editing ? "收起" : "编辑"}
                                </Button>
                                <Button
                                  size="sm"
                                  variant="destructive"
                                  disabled={pendingKey !== null}
                                  onClick={() =>
                                    void run(key, () => deleteForum(forum.id))
                                  }
                                >
                                  {pendingKey === key ? "删除中…" : "删除"}
                                </Button>
                              </div>
                              {rowErrorMessage(key)}
                              {editing && (
                                <form
                                  className="mt-2 flex w-56 flex-col gap-2"
                                  onSubmit={(event) => {
                                    event.preventDefault();
                                    void submitEditForum(forum.id);
                                  }}
                                >
                                  <Input
                                    value={editForum.name}
                                    onChange={(event) =>
                                      setEditForum((prev) => ({
                                        ...prev,
                                        name: event.target.value,
                                      }))
                                    }
                                    placeholder="板块名称"
                                    required
                                  />
                                  <Input
                                    value={editForum.description}
                                    onChange={(event) =>
                                      setEditForum((prev) => ({
                                        ...prev,
                                        description: event.target.value,
                                      }))
                                    }
                                    placeholder="描述（留空清除）"
                                  />
                                  <Input
                                    type="number"
                                    value={editForum.sortOrder}
                                    onChange={(event) =>
                                      setEditForum((prev) => ({
                                        ...prev,
                                        sortOrder: event.target.value,
                                      }))
                                    }
                                    placeholder="排序"
                                  />
                                  <Button
                                    type="submit"
                                    size="sm"
                                    disabled={pendingKey !== null}
                                  >
                                    {pendingKey === key ? "保存中…" : "保存"}
                                  </Button>
                                </form>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {/* 帖子区：hidden 帖包含（管理台可见并恢复） */}
          <section className="flex flex-col gap-3">
            <h2 className="text-sm font-medium">帖子管理（最近 100 条）</h2>
            {threads.length === 0 ? (
              <p className="py-8 text-center text-sm text-fg-muted">
                暂无帖子数据
              </p>
            ) : (
              <div className={TABLE_WRAPPER}>
                <table className={TABLE}>
                  <thead>
                    <tr className="border-b border-border bg-muted/50 text-fg-muted">
                      <th className={TH}>标题</th>
                      <th className={TH}>板块</th>
                      <th className={TH}>作者</th>
                      <th className={TH}>状态</th>
                      <th className={TH}>标志</th>
                      <th className={TH}>回复</th>
                      <th className={TH}>浏览</th>
                      <th className={TH}>操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {threads.map((thread) => {
                      const key = `thread:${thread.id}`;
                      const hidden = thread.status === "hidden";
                      return (
                        <tr
                          key={thread.id}
                          className="border-b border-border last:border-b-0"
                        >
                          <td
                            className={`${TD} max-w-[240px] truncate font-medium`}
                            title={thread.title}
                          >
                            {thread.title}
                          </td>
                          <td className={TD}>{thread.forumName}</td>
                          <td className={TD}>
                            {thread.authorName ?? "未命名用户"}
                          </td>
                          <td className={TD}>
                            {THREAD_STATUS_LABELS[thread.status] ??
                              thread.status}
                          </td>
                          <td
                            className={`${TD} whitespace-nowrap text-xs text-fg-muted`}
                          >
                            {[
                              thread.isPinned && "置顶",
                              thread.isLocked && "锁定",
                            ]
                              .filter(Boolean)
                              .join(" / ") || "—"}
                          </td>
                          <td className={TD}>{thread.replyCount}</td>
                          <td className={TD}>{thread.viewCount}</td>
                          <td className={TD}>
                            <div className="flex flex-col items-start gap-1">
                              <div className="flex flex-wrap gap-2">
                                <Button
                                  size="sm"
                                  variant="outline"
                                  disabled={pendingKey !== null}
                                  onClick={() =>
                                    void run(key, () =>
                                      setThreadFlags(thread.id, {
                                        pinned: !thread.isPinned,
                                      }),
                                    )
                                  }
                                >
                                  {pendingKey === key
                                    ? "处理中…"
                                    : thread.isPinned
                                      ? "取消置顶"
                                      : "置顶"}
                                </Button>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  disabled={pendingKey !== null}
                                  onClick={() =>
                                    void run(key, () =>
                                      setThreadFlags(thread.id, {
                                        locked: !thread.isLocked,
                                      }),
                                    )
                                  }
                                >
                                  {pendingKey === key
                                    ? "处理中…"
                                    : thread.isLocked
                                      ? "解锁"
                                      : "锁定"}
                                </Button>
                                <Button
                                  size="sm"
                                  variant={hidden ? "outline" : "destructive"}
                                  disabled={pendingKey !== null}
                                  onClick={() =>
                                    void run(key, () =>
                                      setThreadFlags(thread.id, {
                                        status: hidden ? "published" : "hidden",
                                      }),
                                    )
                                  }
                                >
                                  {pendingKey === key
                                    ? "处理中…"
                                    : hidden
                                      ? "恢复"
                                      : "隐藏"}
                                </Button>
                              </div>
                              {rowErrorMessage(key)}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </TabsContent>
      </Tabs>
    </div>
  );
}
