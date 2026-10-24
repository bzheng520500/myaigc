import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";

/**
 * 路由保护（Task 4）：/upload 需登录。
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
  // /upload 与 /upload/**；:path* 允许零段（即 /upload 本身）
  matcher: ["/upload/:path*"],
};
