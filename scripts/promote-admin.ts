/**
 * 提升管理员脚本（Task 12）。
 *
 * 用法（DATABASE_URL 需就位，.env 不会被 tsx 自动加载，用 Node 的
 * --env-file 注入）：
 *
 *   npx tsx --env-file=.env scripts/promote-admin.ts <email>
 *
 * 按 email 查 users 表：不存在 → 提示先用该邮箱登录一次（魔法链接
 * 登录时由 Auth.js adapter 创建用户行），存在 → 置 role="admin"。
 * 直接用 db + schema，不经过 auth()。
 */
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";

async function main() {
  const email = process.argv[2]?.trim().toLowerCase();
  if (!email || !email.includes("@")) {
    console.error("用法：npx tsx --env-file=.env scripts/promote-admin.ts <email>");
    process.exit(1);
  }

  if (!process.env.DATABASE_URL) {
    console.error("缺少 DATABASE_URL：请用 --env-file=.env 传入环境变量");
    process.exit(1);
  }

  const [user] = await db
    .select({ id: users.id, email: users.email, role: users.role })
    .from(users)
    .where(eq(users.email, email))
    .limit(1);

  if (!user) {
    console.error(
      `未找到邮箱 ${email} 对应的用户：请先用该邮箱登录一次（登录会自动创建用户），再重新执行本脚本。`,
    );
    process.exit(1);
  }

  await db.update(users).set({ role: "admin" }).where(eq(users.id, user.id));
  console.log(`已将 ${user.email}（${user.id}）提升为管理员（原角色：${user.role}）。`);
  process.exit(0);
}

main().catch((error) => {
  console.error("执行失败：", error);
  process.exit(1);
});
