/**
 * 提升管理员脚本（Task 12）。
 *
 * 用法（自动连接 wrangler 本地 D1，见 scripts/d1.ts）：
 *
 *   npx tsx scripts/promote-admin.ts <email>
 *
 * 按 email 查 users 表：不存在 → 提示先用该邮箱登录一次（魔法链接
 * 登录时由 Auth.js adapter 创建用户行），存在 → 置 role="admin"。
 * 直接用 db + schema，不经过 auth()。
 */
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { connectScriptDb } from "@/scripts/d1";
import { users } from "@/lib/db/schema";

async function main(): Promise<number> {
  const email = process.argv[2]?.trim().toLowerCase();
  if (!email || !email.includes("@")) {
    console.error("用法：npx tsx scripts/promote-admin.ts <email>");
    return 1;
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
    return 1;
  }

  await db.update(users).set({ role: "admin" }).where(eq(users.id, user.id));
  console.log(`已将 ${user.email}（${user.id}）提升为管理员（原角色：${user.role}）。`);
  return 0;
}

/** 建立本地 D1 绑定并保证 dispose（tsx 无 Workers 运行时上下文） */
async function run(): Promise<number> {
  const d1 = await connectScriptDb();
  try {
    return await main();
  } finally {
    await d1.dispose();
  }
}

run()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error) => {
    console.error("执行失败：", error);
    process.exitCode = 1;
  });
