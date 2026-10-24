import type { Session } from "next-auth";

/**
 * 管理后台纯逻辑（Task 12）。
 *
 * 独立于 "use server" 文件的原因（与 comments-core.ts 同模式）：Next 只允许
 * "use server" 文件导出 async 函数，同步纯函数 requireAdmin 必须外置才能被
 * action 层复用与 vitest 直接单测。
 */

/**
 * 纯逻辑：session 是否为管理员。
 *
 * role 来自 lib/auth.ts 的 callbacks.session（database 策略下 user 即
 * users 表整行，默认 callback 不回填业务字段，由我们注入 role）。
 * 任何非 "admin" 值（含 undefined / "user"）一律视为非管理员。
 */
export function requireAdmin(
  session: Session | null | undefined,
): boolean {
  const role = (session?.user as { role?: unknown } | undefined)?.role;
  return role === "admin";
}
