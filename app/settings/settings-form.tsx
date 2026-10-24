"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { updateProfile } from "@/lib/actions/profile";

/**
 * 个人设置表单（Phase 3 Task 3，client）。
 *
 * - 昵称 Input（maxlength 30）/ 头像 URL Input / 邮件通知开关
 *   （base-nova 未安装 switch，用原生 checkbox + label，brief 预案）
 * - 提交：调 updateProfile server action；成功显示「已保存」并
 *   router.refresh()（设置页与用户主页查询均禁缓存，刷新即拉新）；
 *   失败显示行内中文错误
 * - submitting 态禁用防重复提交（与 CommentSection 同模式）
 */

export type SettingsFormProps = {
  initial: { name: string | null; image: string | null; notifyEmail: boolean };
};

export function SettingsForm({ initial }: SettingsFormProps) {
  const router = useRouter();
  const [name, setName] = useState(initial.name ?? "");
  const [image, setImage] = useState(initial.image ?? "");
  const [notifyEmail, setNotifyEmail] = useState(initial.notifyEmail);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;

    setError(null);
    setSaved(false);
    setSubmitting(true);
    try {
      const result = await updateProfile({
        name,
        image,
        notifyEmailEnabled: notifyEmail,
      });
      if (result.ok) {
        setSaved(true);
        router.refresh();
      } else {
        setError(result.error);
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-6 pb-16">
      <label className="flex flex-col gap-2 text-sm font-medium">
        昵称
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={30}
          placeholder="展示在帖子与评论中的名字"
          disabled={submitting}
          aria-label="昵称"
        />
        <span className="text-xs font-normal text-fg-muted">
          最多 30 字；留空则保持当前昵称
        </span>
      </label>

      <label className="flex flex-col gap-2 text-sm font-medium">
        头像地址
        <Input
          value={image}
          onChange={(e) => setImage(e.target.value)}
          type="url"
          placeholder="https://example.com/avatar.png"
          disabled={submitting}
          aria-label="头像地址"
        />
        <span className="text-xs font-normal text-fg-muted">
          仅支持 http(s) 链接；清空则恢复默认首字母头像
        </span>
      </label>

      <label className="flex items-center gap-2.5 text-sm">
        <input
          type="checkbox"
          checked={notifyEmail}
          onChange={(e) => setNotifyEmail(e.target.checked)}
          disabled={submitting}
          className="size-4 accent-blue-600"
        />
        接收互动通知邮件（回复 / 评论 / 点赞）
      </label>

      {error && (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      )}
      {saved && !error && (
        <p className="text-sm text-emerald-600" role="status">
          已保存
        </p>
      )}

      <div>
        <Button type="submit" disabled={submitting}>
          {submitting ? "保存中…" : "保存修改"}
        </Button>
      </div>
    </form>
  );
}
