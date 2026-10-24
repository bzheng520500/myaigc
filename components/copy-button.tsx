"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";

/**
 * 复制 / 下载按钮（Task 7）。
 *
 * toast 说明：components/ui/toast 为 base-ui ToastManager 方案，需要
 * <Toaster> 挂载到 layout 才有渲染出口——当前 layout 未挂载且本任务不改
 * layout，按 brief 降级为行内「已复制」状态切换。
 */

export type CopyButtonProps = {
  text: string;
  label?: string;
  /** 复制成功后的计数上报（server action：incrementSkillCopy.bind(null, slug)） */
  reportCopy?: () => Promise<void>;
};

export function CopyButton({ text, label = "复制", reportCopy }: CopyButtonProps) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      return; // 剪贴板不可用（如非安全上下文）：不进入成功态
    }
    setCopied(true);
    if (reportCopy) void reportCopy();
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <Button variant="outline" size="sm" onClick={handleCopy} aria-live="polite">
      {copied ? "已复制" : label}
    </Button>
  );
}

export type DownloadButtonProps = {
  text: string;
  filename: string;
  label?: string;
};

export function DownloadButton({
  text,
  filename,
  label = "下载 .md",
}: DownloadButtonProps) {
  function handleDownload() {
    const blob = new Blob([text], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <Button variant="outline" size="sm" onClick={handleDownload}>
      {label}
    </Button>
  );
}
