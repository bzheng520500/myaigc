import { CopyButton } from "@/components/copy-button";
import { incrementPromptCopy } from "@/lib/actions/prompt-interactions";
import type { PromptRow } from "@/lib/queries/prompts";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * 运镜提示词卡片（Task 8，/prompts 列表页消费）。
 *
 * - prompt_en：等宽字体代码块（--paper 色系底 = bg-muted token），pre-wrap 换行
 * - 复制按钮：复制 prompt_en 并 fire-and-forget 上报 copy_count
 * - imageUrl：外链展示图，Card 自带 first-child img 贴顶圆角样式；
 *   referrerPolicy 防外链图床的 referer 防盗链
 */

export type PromptCardProps = {
  prompt: PromptRow;
};

export function PromptCard({ prompt }: PromptCardProps) {
  return (
    <Card className="gap-3">
      {prompt.imageUrl && (
        // eslint-disable-next-line @next/next/no-img-element -- 外链图床不可枚举，next/image 需改 next.config（本任务不动）
        <img
          src={prompt.imageUrl}
          alt={`${prompt.name} 效果示意`}
          loading="lazy"
          referrerPolicy="no-referrer"
          className="h-36 w-full object-cover"
        />
      )}
      <CardHeader>
        <div className="flex items-start justify-between gap-2">
          <CardTitle className="font-serif-display text-base leading-snug">
            {prompt.name}
          </CardTitle>
          <Badge variant="secondary" className="shrink-0">
            {prompt.category}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col gap-3">
        <pre className="rounded-lg bg-muted p-3 font-mono text-xs leading-relaxed whitespace-pre-wrap break-words">
          {prompt.promptEn}
        </pre>
        {prompt.promptZh && (
          <p className="text-sm leading-relaxed text-fg-muted">
            {prompt.promptZh}
          </p>
        )}
        {prompt.notes && (
          <p className="text-xs leading-relaxed text-fg-muted/80">
            提示：{prompt.notes}
          </p>
        )}
        <div className="mt-auto flex justify-end pt-1">
          <CopyButton
            text={prompt.promptEn}
            reportCopy={incrementPromptCopy.bind(null, prompt.id)}
          />
        </div>
      </CardContent>
    </Card>
  );
}
