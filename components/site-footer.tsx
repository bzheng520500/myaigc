import Link from "next/link";

/**
 * 全站页脚（Task 5）。
 *
 * 注：不用 <nav> 元素——避免与 SiteHeader 导航重复 navigation role，
 * 干扰 E2E 的 getByRole("navigation") 定位。
 */
export function SiteFooter() {
  return (
    <footer className="border-t border-border bg-card">
      <div className="mx-auto flex w-full max-w-5xl flex-col items-center justify-between gap-2 px-4 py-8 text-sm text-fg-muted sm:flex-row">
        <p>© 2026 AI影视工坊 · AI 影视制作学习社区</p>
        <div className="flex items-center gap-4">
          <Link href="/skills" className="transition-colors hover:text-fg">
            Skill库
          </Link>
          <Link href="/tutorials" className="transition-colors hover:text-fg">
            教程
          </Link>
        </div>
      </div>
    </footer>
  );
}
