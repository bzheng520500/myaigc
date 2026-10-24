import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * Skill 卡片（Task 5，首页 /skills 列表页复用）。
 *
 * 整卡可点：绝对定位的 stretched Link 覆盖卡片（Card 组件自带
 * overflow-hidden rounded-xl，链接圆角与其对齐）。
 */

export type SkillCardProps = {
  name: string;
  description: string | null;
  category: string;
  slug: string;
};

export function SkillCard({ name, description, category, slug }: SkillCardProps) {
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
