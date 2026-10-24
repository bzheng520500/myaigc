import Link from "next/link";

/**
 * 通用分页组件（Task 6，T8 提示词库 / T9 教程列表 / T2 板块页复用）。
 *
 * - 纯链接分页（server component）：上一页 / 页码窗口 / 下一页
 * - 保留既有 query 参数（q / category 等）；page=1 不写 page 参数，URL 干净
 * - total 为 0 或只有单页时渲染 null
 */

export type PaginationProps = {
  /** 当前页（1 起） */
  page: number;
  /** 符合筛选条件的总条数 */
  total: number;
  /** 每页条数 */
  pageSize: number;
  /** 不含 query 的基础路径，如 "/skills" */
  basePath: string;
  /** 需要保留的既有 query 参数（值为空字符串/undefined 的丢弃） */
  searchParams?: Record<string, string | undefined>;
};

/** 生成分页链接：保留既有参数，page=1 时省略 page */
function pageHref(
  page: number,
  basePath: string,
  searchParams: Record<string, string | undefined>,
): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(searchParams)) {
    if (value) params.set(key, value);
  }
  if (page > 1) params.set("page", String(page));
  const qs = params.toString();
  return qs ? `${basePath}?${qs}` : basePath;
}

const linkClass =
  "inline-flex h-8 min-w-8 items-center justify-center rounded-full px-3 text-sm text-fg-muted transition-colors hover:bg-accent-soft hover:text-accent-soft-fg";

const disabledClass =
  "inline-flex h-8 min-w-8 items-center justify-center rounded-full px-3 text-sm text-fg-muted/50 cursor-not-allowed";

const ellipsisClass = "px-1 text-sm text-fg-muted";

export function Pagination({
  page,
  total,
  pageSize,
  basePath,
  searchParams = {},
}: PaginationProps) {
  const totalPages = Math.ceil(total / pageSize);
  if (total <= 0 || totalPages <= 1) return null;

  // 滑动窗口：当前页尽量居中，最多 5 个页码
  const end = Math.min(totalPages, Math.max(1, page - 2) + 4);
  const start = Math.max(1, end - 4);
  const pages = Array.from({ length: end - start + 1 }, (_, i) => start + i);

  return (
    <nav aria-label="分页" className="flex flex-wrap items-center justify-center gap-1">
      {page > 1 ? (
        <Link href={pageHref(page - 1, basePath, searchParams)} rel="prev" className={linkClass}>
          上一页
        </Link>
      ) : (
        <span aria-disabled="true" className={disabledClass}>
          上一页
        </span>
      )}

      {start > 1 && <span className={ellipsisClass} aria-hidden="true">…</span>}

      {pages.map((p) =>
        p === page ? (
          <span
            key={p}
            aria-current="page"
            className="inline-flex h-8 min-w-8 items-center justify-center rounded-full bg-accent-soft px-3 text-sm font-medium text-accent-soft-fg"
          >
            {p}
          </span>
        ) : (
          <Link key={p} href={pageHref(p, basePath, searchParams)} className={linkClass}>
            {p}
          </Link>
        ),
      )}

      {end < totalPages && <span className={ellipsisClass} aria-hidden="true">…</span>}

      {page < totalPages ? (
        <Link href={pageHref(page + 1, basePath, searchParams)} rel="next" className={linkClass}>
          下一页
        </Link>
      ) : (
        <span aria-disabled="true" className={disabledClass}>
          下一页
        </span>
      )}
    </nav>
  );
}
