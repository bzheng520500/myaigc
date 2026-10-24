import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";

/**
 * 路由保护（Task 4；Task 12 扩至 /admin；Phase 2 Task 3 扩至 /forum/new；
 * Phase 3 Task 2 扩至 /notifications）：
 * /upload、/admin、/forum/new、/notifications 需登录。
 * /admin 的管理员角色判定在页面层（app/admin/page.tsx 渲染无权限提示）；
 * /forum/new 的登录守卫在页面层另有双保险（app/forum/new/page.tsx）。
 *
 * v5 惯例：auth 作为 middleware wrapper（database session 下会真实查库校验）。
 * 未登录 → 302 到 /login?returnUrl=（用户登录成功后落回原页面）。
 *
 * 注：Next.js 16 已将 middleware 更名为 proxy（middleware.ts 仍向后兼容但弃用）。
 * 按 Phase 1 计划约定本文件沿用 middleware.ts，可后续随升级统一迁移为 proxy.ts。
 */
export default auth((req) => {
  if (!req.auth) {
    const loginUrl = new URL("/login", req.url);
    loginUrl.searchParams.set(
      "returnUrl",
      req.nextUrl.pathname + req.nextUrl.search,
    );
    return NextResponse.redirect(loginUrl);
  }
});

export const config = {
  // /upload 与 /upload/**；/admin 与 /admin/**（Task 12 管理后台）；
  // /forum/new 发帖页（Phase 2 Task 3，叶子页精确匹配，不带 :path*）；
  // /notifications 通知中心（Phase 3 Task 2，同样叶子页精确匹配）；
  // :path* 允许零段（即 /upload、/admin 本身）
  matcher: ["/upload/:path*", "/admin/:path*", "/forum/new", "/notifications"],
};
