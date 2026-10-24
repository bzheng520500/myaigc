"use client";

import { useRef, useState, type DragEvent } from "react";
import { MarkdownPreview } from "@/components/markdown-preview";

/**
 * Markdown 编辑器（Task 11 上传页）。
 *
 * - 左：等宽字体 textarea（受控，value/onChange 由父组件持有）
 * - 右：实时预览（MarkdownPreview，与详情页同一消毒 schema）
 * - .md 导入：选择文件或拖拽到编辑区，FileReader.readAsText
 *   读入后整体替换内容并提示文件名（不做工具栏，YAGNI）
 *
 * 注意：不直接 import SKILL_TEMPLATE（lib/frontmatter.ts 依赖
 * gray-matter，避免拖进 client bundle）；初始模板由上传页 server
 * 端以 initialValue 传入，placeholder 用模板摘要。
 */

export type MdEditorProps = {
  value: string;
  onChange: (v: string) => void;
};

/** SKILL_TEMPLATE 摘要（仅提示用） */
const PLACEHOLDER = [
  "---",
  "name: 我的技能名称",
  "description: 一句话介绍这个 Skill 的用途与适用场景",
  "category: 小说创作",
  "---",
  "",
  "## 使用场景",
  "…",
].join("\n");

export function MdEditor({ value, onChange }: MdEditorProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [readError, setReadError] = useState<string | null>(null);

  function loadFile(file: File | null | undefined) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      onChange(String(reader.result ?? ""));
      setFileName(file.name);
      setReadError(null);
    };
    reader.onerror = () => {
      setReadError("文件读取失败，请重试");
    };
    reader.readAsText(file);
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);
    loadFile(event.dataTransfer.files?.[0]);
  }

  return (
    <div
      onDragOver={(event) => {
        event.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={handleDrop}
      className={`flex flex-col gap-3 rounded-xl border p-3 transition-colors ${
        dragging ? "border-ring bg-accent-soft" : "border-border"
      }`}
    >
      {/* 工具行：.md 导入 + 文件名提示 */}
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <input
          ref={fileInputRef}
          type="file"
          accept=".md,.markdown,.txt"
          className="hidden"
          onChange={(event) => {
            loadFile(event.target.files?.[0]);
            // 允许重复选择同一文件（否则第二次选择不触发 change）
            event.target.value = "";
          }}
        />
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          className="rounded-full border border-border px-3 py-1.5 text-fg-muted transition-colors hover:bg-accent-soft hover:text-accent-soft-fg"
        >
          导入 .md 文件
        </button>
        <span className="text-xs text-fg-muted">
          {dragging
            ? "松开即可导入文件"
            : fileName
              ? `已导入：${fileName}`
              : "也可以把 .md / .txt 文件拖到这里"}
        </span>
        {readError && (
          <span className="text-xs text-destructive" role="alert">
            {readError}
          </span>
        )}
      </div>

      {/* 编辑区 + 预览区 */}
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <textarea
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={PLACEHOLDER}
          aria-label="Markdown 源码"
          spellCheck={false}
          className="min-h-[480px] w-full resize-y rounded-lg border border-border bg-background p-3 font-mono text-sm leading-relaxed outline-none transition-colors placeholder:text-fg-muted focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
        />
        <div className="min-h-[480px] overflow-y-auto rounded-lg border border-border bg-background p-3">
          <MarkdownPreview content={value} />
        </div>
      </div>
    </div>
  );
}
