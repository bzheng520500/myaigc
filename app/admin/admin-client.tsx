"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  setCommentStatus,
  setSkillStatus,
  type AdminActionResult,
  type AdminCommentRow,
  type AdminSkillRow,
} from "@/lib/actions/admin";

/**
 * 管理后台主体（Task 12，client）。
 *
 * - Tabs 两列表：Skill 管理 / 评论管理（shadcn base-nova Tabs）
 * - 表格：项目无 table 组件，手写 tailwind 简单表格
 * - 操作：调 setSkillStatus / setCommentStatus 后 router.refresh()
 *   拉取最新数据；pending 期间禁用全部操作按钮（防重复提交）
 * - 失败：错误码映射中文，行内提示在对应行的操作按钮下方
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

/** 表格容器 + 表头的通用样式（手写简单表格） */
const TABLE_WRAPPER = "overflow-x-auto rounded-lg border border-border";
const TABLE = "w-full text-sm";
const TH = "px-3 py-2 text-left font-medium whitespace-nowrap";
const TD = "px-3 py-2 align-top";

export function AdminClient({
  skills,
  comments,
}: {
  skills: AdminSkillRow[];
  comments: AdminCommentRow[];
}) {
  const router = useRouter();
  /** 正在操作的行 key（skill:<id> / comment:<id>），操作期间禁用全部按钮 */
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  /** 最近一次失败操作的行 key 与中文提示 */
  const [rowError, setRowError] = useState<{
    key: string;
    message: string;
  } | null>(null);

  async function run(
    key: string,
    action: () => Promise<AdminActionResult>,
  ): Promise<void> {
    if (pendingKey) return;
    setPendingKey(key);
    setRowError(null);
    try {
      const result = await action();
      if (result.ok) {
        router.refresh();
      } else {
        setRowError({
          key,
          message: ERROR_MESSAGES[result.error] ?? FALLBACK_ERROR,
        });
      }
    } catch {
      // server action 网络异常 / 意外 reject：兜底行内中文提示
      setRowError({ key, message: FALLBACK_ERROR });
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

  return (
    <div className="pb-16">
      <Tabs defaultValue="skills">
        <TabsList aria-label="管理列表切换">
          <TabsTrigger value="skills">Skill 管理</TabsTrigger>
          <TabsTrigger value="comments">评论管理</TabsTrigger>
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
      </Tabs>
    </div>
  );
}
