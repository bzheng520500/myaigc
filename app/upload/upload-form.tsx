"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { MdEditor } from "@/components/md-editor";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { uploadSkill } from "@/lib/actions/upload";

/**
 * 上传表单（Task 11，client）。
 *
 * - category Select：小说创作 / 影视制作 / 其他
 * - MdEditor：受控持有 .md 全文（初始值为 SKILL_TEMPLATE，由
 *   server 壳传入，避免 client bundle 引入 gray-matter）
 * - 提交：uploadSkill server action；成功 router.push 详情页；
 *   失败行内中文错误（layout 未挂 Toaster，与评论区同理不用 toast）
 * - submitting 态禁用防重复提交
 */

const CATEGORIES = ["小说创作", "影视制作", "其他"] as const;

export function UploadForm({ initialValue }: { initialValue: string }) {
  const router = useRouter();
  const [content, setContent] = useState(initialValue);
  const [category, setCategory] = useState<string>(CATEGORIES[0]);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;

    setError(null);
    setSubmitting(true);
    try {
      const result = await uploadSkill(content, category);
      if (result.ok) {
        router.push(`/skills/${result.slug}`);
      } else {
        setError(result.error);
      }
    } catch {
      // server action 网络异常 / 意外 reject：兜底行内提示，不让
      // 用户停留在无反馈状态（文案与 uploadSkill 的通用错误一致）
      setError("上传失败，请稍后再试");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4 pb-16">
      {/* 分类选择 */}
      <div className="flex items-center gap-3">
        <span className="text-sm text-fg-muted">分类</span>
        <Select value={category} onValueChange={(v) => setCategory(v ?? "其他")}>
          <SelectTrigger aria-label="选择分类">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {CATEGORIES.map((c) => (
              <SelectItem key={c} value={c}>
                {c}
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
          {submitting ? "发布中…" : "发布 Skill"}
        </Button>
      </div>
    </form>
  );
}
