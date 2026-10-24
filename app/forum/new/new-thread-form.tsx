"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { MdEditor } from "@/components/md-editor";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { createThread } from "@/lib/actions/forum";

/**
 * 发帖表单（Phase 2 Task 3，client）。
 *
 * - 标题 Input（maxlength 100 + 计数提示，native required）
 * - 板块 Select：默认取页面传入的 preselectSlug（不在列表时回退首个）
 * - MdEditor 受控持有 Markdown 全文（初始值为简短示例模板；
 *   帖子无 frontmatter，与 Skill 上传不同）
 * - 提交：createThread server action；成功以提交时已知的 forumSlug
 *   拼帖子页 URL router.push；失败行内中文错误（layout 未挂 Toaster，
 *   与上传表单同理不用 toast）
 * - submitting 态禁用防重复提交；空标题/正文前端校验 + 服务端双保险
 */

const TITLE_MAX_LENGTH = 100;

/** 初始示例模板（纯提示用，用户直接覆盖即可） */
const CONTENT_TEMPLATE = "# 标题示例\n\n正文支持 Markdown…";

export type NewThreadFormProps = {
  forums: { slug: string; name: string }[];
  /** searchParams ?forum= 预选板块；无效/缺省时回退第一个板块 */
  preselectSlug?: string;
};

export function NewThreadForm({ forums, preselectSlug }: NewThreadFormProps) {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [forumSlug, setForumSlug] = useState(
    forums.some((f) => f.slug === preselectSlug)
      ? (preselectSlug as string)
      : (forums[0]?.slug ?? ""),
  );
  const [content, setContent] = useState(CONTENT_TEMPLATE);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;

    // native required 只拦空值，空格串在此与服务端同语义（trim）收口
    const trimmedTitle = title.trim();
    const trimmedContent = content.trim();
    if (!trimmedTitle) {
      setError("标题不能为空");
      return;
    }
    if (!trimmedContent) {
      setError("正文不能为空");
      return;
    }

    setError(null);
    setSubmitting(true);
    try {
      const result = await createThread({
        forumSlug,
        title: trimmedTitle,
        contentMd: trimmedContent,
      });
      if (result.ok) {
        // createThread 只返回 id，URL 用提交时已知的 forumSlug 拼
        router.push(`/forum/${forumSlug}/${result.id}`);
      } else {
        setError(result.error);
      }
    } catch {
      // server action 网络异常 / 意外 reject：兜底行内提示
      setError("发帖失败，请稍后再试");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4 pb-16">
      {/* 标题 + 字数计数 */}
      <div className="flex flex-col gap-2">
        <div className="flex items-baseline justify-between">
          <label htmlFor="thread-title" className="text-sm text-fg-muted">
            帖子标题
          </label>
          <span className="text-xs text-fg-muted">
            {title.length}/{TITLE_MAX_LENGTH}
          </span>
        </div>
        <Input
          id="thread-title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={TITLE_MAX_LENGTH}
          required
          placeholder="一句话概括你的帖子"
        />
      </div>

      {/* 板块选择 */}
      <div className="flex items-center gap-3">
        <span className="text-sm text-fg-muted">板块</span>
        <Select
          value={forumSlug}
          onValueChange={(v) => setForumSlug(v ?? forums[0]?.slug ?? "")}
        >
          <SelectTrigger aria-label="选择板块">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {forums.map((f) => (
              <SelectItem key={f.slug} value={f.slug}>
                {f.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* 编辑器（含 .md 导入 + 实时预览） */}
      <MdEditor value={content} onChange={setContent} />

      {error && (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      )}

      <div className="flex justify-end">
        <Button type="submit" disabled={submitting}>
          {submitting ? "发布中…" : "发布帖子"}
        </Button>
      </div>
    </form>
  );
}
