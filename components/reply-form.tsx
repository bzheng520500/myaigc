"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { createReply } from "@/lib/actions/forum";

/**
 * 帖子回复表单（Phase 2 Task 3，client）。
 *
 * - locked：不渲染（帖子页已显示锁定卡，此处组件层再防御一次）
 * - 未登录：表单替换为「登录后回复」链接（returnUrl 带回当前路径，
 *   isLoggedIn 由服务端页在 Suspense 内取 session 传入——client
 *   组件无法直接调 auth()，参照 CommentSection 模式）
 * - 提交：createReply server action；成功后 router.refresh() 让
 *   服务端重取楼层列表（楼层号由服务端分配，不做 optimistic），
 *   并清空输入；失败行内中文错误照实展示（含 30s 限流文案）
 * - submitting 态禁用防重复提交
 */

export type ReplyFormProps = {
  threadId: string;
  locked: boolean;
  isLoggedIn: boolean;
};

export function ReplyForm({ threadId, locked, isLoggedIn }: ReplyFormProps) {
  const router = useRouter();
  const pathname = usePathname();
  const [content, setContent] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // 页面层已用锁定卡替换本组件，这里防御性再判一次
  if (locked) return null;

  if (!isLoggedIn) {
    return (
      <Link
        href={`/login?returnUrl=${encodeURIComponent(pathname)}`}
        className="self-start rounded-full border border-border px-4 py-2 text-sm text-fg-muted transition-colors hover:bg-accent-soft hover:text-accent-soft-fg"
      >
        登录后回复
      </Link>
    );
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;

    const trimmed = content.trim();
    if (!trimmed) {
      setError("回复内容不能为空");
      return;
    }

    setError(null);
    setSubmitting(true);
    try {
      const result = await createReply(threadId, trimmed);
      if (result.ok) {
        setContent("");
        // 服务端重取楼层列表（revalidatePath 已失效缓存，refresh 最简单可靠）
        router.refresh();
      } else {
        setError(result.error);
      }
    } catch {
      // server action 网络异常 / 意外 reject：兜底行内提示
      setError("回复失败，请稍后再试");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3">
      <textarea
        value={content}
        onChange={(e) => setContent(e.target.value)}
        placeholder="写下你的回复…（支持 Markdown）"
        rows={5}
        maxLength={10000}
        disabled={submitting}
        aria-label="回复内容"
        className="w-full resize-y rounded-lg border border-border bg-background px-3 py-2 text-sm leading-relaxed outline-none transition-colors placeholder:text-fg-muted focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50"
      />
      {error && (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      )}
      <div className="flex justify-end">
        <Button type="submit" size="sm" disabled={submitting}>
          {submitting ? "发布中…" : "发布回复"}
        </Button>
      </div>
    </form>
  );
}
