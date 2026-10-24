import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";

/**
 * 设计 token 演示页（临时，Phase 4 删除）
 * 访问路径：/tokens
 * 展示：六锁定色 + 派生阶、双字体、shadcn 组件形态
 */

const coreColors = [
  { name: "页面底 bg", token: "--bg", hex: "#FAF9F5", cssVar: "var(--bg)" },
  { name: "卡片 card", token: "--card", hex: "#FFFFFF", cssVar: "var(--card)" },
  { name: "正文 fg", token: "--fg", hex: "#1F1E1D", cssVar: "var(--fg)" },
  {
    name: "次级文字 fg-muted",
    token: "--fg-muted",
    hex: "#6B6A66",
    cssVar: "var(--fg-muted)",
  },
  {
    name: "强调 accent",
    token: "--accent",
    hex: "#D97757",
    cssVar: "var(--accent)",
  },
  {
    name: "边框 border",
    token: "--border",
    hex: "#E8E6E0",
    cssVar: "var(--border)",
  },
];

const derivedColors = [
  { name: "陶土 hover", token: "--accent-hover", hex: "#C96442", cssVar: "var(--accent-hover)" },
  { name: "陶土 active 文字", token: "--clay-700", hex: "#A84B2E", cssVar: "var(--clay-700)" },
  { name: "浅陶土底", token: "--accent-soft", hex: "#F8ECE3", cssVar: "var(--accent-soft)" },
  { name: "弱填充 muted", token: "--muted", hex: "#F2F0EA", cssVar: "var(--muted)" },
  { name: "次级按钮底", token: "--secondary", hex: "#ECE9E1", cssVar: "var(--secondary)" },
  { name: "危险 destructive", token: "--destructive", hex: "#C7361F", cssVar: "var(--destructive)" },
];

function Swatch({
  name,
  token,
  hex,
  cssVar,
}: {
  name: string;
  token: string;
  hex: string;
  cssVar: string;
}) {
  return (
    <div className="overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--card)]">
      <div className="h-16 w-full" style={{ background: cssVar }} />
      <div className="space-y-0.5 px-3 py-2">
        <p className="text-xs font-medium text-[var(--fg)]">{name}</p>
        <p className="font-mono text-[11px] text-[var(--fg-muted)]">{token}</p>
        <p className="font-mono text-[11px] text-[var(--fg-muted)]">{hex}</p>
      </div>
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="font-serif-display mt-16 mb-6 text-2xl text-[var(--fg)]">
      {children}
    </h2>
  );
}

export default function TokensPage() {
  return (
    <main className="mx-auto w-full max-w-3xl px-6 py-16 sm:py-24">
      {/* 页头 */}
      <p className="text-sm text-[var(--fg-muted)]">设计系统 · token 演示</p>
      <h1 className="font-serif-display mt-2 text-4xl text-[var(--fg)] sm:text-5xl">
        AI影视工坊
      </h1>
      <p className="mt-4 max-w-xl leading-relaxed text-[var(--fg-muted)]">
        Claude 官网风格：米白纸面、大量留白、衬线标题与克制的陶土橙强调。
        本页展示全站消费的颜色、字体与组件 token。
      </p>

      {/* 颜色 */}
      <SectionTitle>颜色 · 核心六色（锁定）</SectionTitle>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
        {coreColors.map((c) => (
          <Swatch key={c.token} {...c} />
        ))}
      </div>

      <h3 className="mt-8 mb-4 text-sm font-medium text-[var(--fg)]">
        派生色阶
      </h3>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
        {derivedColors.map((c) => (
          <Swatch key={c.token} {...c} />
        ))}
      </div>

      {/* 字体 */}
      <SectionTitle>字体</SectionTitle>
      <div className="space-y-6 rounded-xl border border-[var(--border)] bg-[var(--card)] p-6 sm:p-8">
        <div>
          <p className="mb-2 font-mono text-[11px] text-[var(--fg-muted)]">
            --font-serif · Noto Serif SC（标题 / .font-serif-display）
          </p>
          <p className="font-serif-display text-4xl text-[var(--fg)]">
            AI影视工坊
          </p>
          <p className="font-serif-display mt-2 text-2xl text-[var(--fg)]">
            从分镜到成片，学会用 AI 讲故事
          </p>
        </div>
        <div className="border-t border-[var(--border)] pt-6">
          <p className="mb-2 font-mono text-[11px] text-[var(--fg-muted)]">
            --font-sans · Inter + 系统黑体栈（正文）
          </p>
          <p className="leading-relaxed text-[var(--fg)]">
            欢迎来到 AI影视工坊——一个面向中文创作者的 AI
            影视制作学习社区。在这里，你可以跟随实战教程学习提示词编写、分镜设计与剪辑思路，
            也可以分享自己的作品，与志同道合的伙伴交流打磨。
          </p>
          <p className="mt-3 text-sm leading-relaxed text-[var(--fg-muted)]">
            次级说明文字使用 --fg-muted（#6B6A66），用于辅助信息、摘要与占位内容。
          </p>
        </div>
      </div>

      {/* 组件 */}
      <SectionTitle>组件形态</SectionTitle>

      <div className="space-y-8">
        {/* Button */}
        <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-6">
          <p className="mb-4 text-sm font-medium text-[var(--fg)]">
            Button（primary = --accent 陶土橙，全圆 pill）
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <Button>开始学习</Button>
            <Button variant="secondary">次级操作</Button>
            <Button variant="outline">描边按钮</Button>
            <Button variant="ghost">幽灵按钮</Button>
            <Button variant="link">文字链接</Button>
            <Button size="sm">小尺寸</Button>
            <Button size="lg">大尺寸</Button>
          </div>
        </div>

        {/* Badge */}
        <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-6">
          <p className="mb-4 text-sm font-medium text-[var(--fg)]">Badge</p>
          <div className="flex flex-wrap items-center gap-3">
            <Badge>默认（陶土橙）</Badge>
            <Badge variant="secondary">教程</Badge>
            <Badge variant="outline">案例</Badge>
          </div>
        </div>

        {/* Input */}
        <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-6">
          <p className="mb-4 text-sm font-medium text-[var(--fg)]">
            Input（focus 环 = --ring 陶土橙）
          </p>
          <Input placeholder="搜索教程、案例、提示词…" className="max-w-sm" />
        </div>

        {/* Card */}
        <Card>
          <CardHeader>
            <CardTitle>卡片标题（衬线 · --font-heading）</CardTitle>
            <CardDescription>
              卡片：白底 #FFFFFF、16px 圆角、1px 边框、无阴影
            </CardDescription>
            <CardAction>
              <Badge variant="secondary">实战</Badge>
            </CardAction>
          </CardHeader>
          <CardContent className="text-sm leading-relaxed text-[var(--fg-muted)]">
            卡片正文区。CardTitle 自动使用衬线标题字族（--font-heading =
            Noto Serif SC），描述文字使用次级色。
          </CardContent>
          <CardFooter className="justify-end gap-2">
            <Button variant="ghost" size="sm">
              稍后再看
            </Button>
            <Button size="sm">立即开始</Button>
          </CardFooter>
        </Card>
      </div>

      <p className="mt-16 border-t border-[var(--border)] pt-6 font-mono text-[11px] text-[var(--fg-muted)]">
        app/(design)/tokens/page.tsx · 临时演示页，Phase 4 移除
      </p>
    </main>
  );
}
