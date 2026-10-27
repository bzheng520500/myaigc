import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CopyButton } from "@/components/copy-button";
import { incrementSkillCopy } from "@/lib/actions/skill-interactions";

/**
 * Skill 卡片（Task 5，首页 /skills 列表页复用）。
 *
 * 整卡可点：绝对定位的 stretched Link 覆盖卡片（Card 组件自带
 * overflow-hidden rounded-xl，链接圆角与其对齐）。
 *
 * 复制按钮（右下角，与提示词库一致）：必须压在 stretched Link 之上才
 * 可点击，因此外层 relative + z-10；Link 不带 z-index（z-auto），
 * 同层里 z-10 的元素绘制在其上并优先接收点击。
 * contentMd 为空时不渲染按钮（避免复制空串）。
 */

export type SkillCardProps = {
  name: string;
  description: string | null;
  category: string;
  slug: string;
  /** 全文 markdown（列表查询已带出）；为空则不显示复制按钮 */
  contentMd?: string | null;
  /** 是否显示复制按钮（首页紧凑卡片可传 false） */
  showCopy?: boolean;
};

export function SkillCard({
  name,
  description,
  category,
  slug,
  contentMd,
  showCopy = true,
}: SkillCardProps) {
  return (
    <Card className="group relative gap-2 transition-shadow hover:shadow-card-hover">
      <CardHeader>
        <div className="flex items-start justify-between gap-2">
          <CardTitle className="font-serif-display text-base leading-snug">
            {name}
          </CardTitle>
          <Badge variant="secondary" className="shrink-0">
            {category}
          </Badge>
        </div>
      </CardHeader>
      <CardContent>
        <p className="line-clamp-2 min-h-10 text-sm leading-relaxed text-fg-muted">
          {description ?? "暂无简介"}
        </p>
        {showCopy && contentMd ? (
          <div className="relative z-10 mt-3 flex justify-end">
            <CopyButton
              text={contentMd}
              reportCopy={incrementSkillCopy.bind(null, slug)}
            />
          </div>
        ) : null}
      </CardContent>
      <Link
        href={`/skills/${slug}`}
        aria-label={`查看 ${name}`}
        className="absolute inset-0 rounded-xl"
      >
        <span className="sr-only">{name}</span>
      </Link>
    </Card>
  );
}
