/**
 * 论坛初始板块 seed 脚本（Phase 2 Task 1）。
 *
 * 用法：
 *
 *   npx tsx --env-file=.env scripts/seed-forums.ts
 *
 * 语义要点：
 * - 幂等：onConflictDoUpdate by slug，重复执行只更新
 *   name / description / sortOrder，不重置 threadCount / replyCount
 *   （计数由发帖/回复 action 维护，seed 不得覆盖）
 * - 无 DATABASE_URL：打印提示并退出码 1（与 import-prompts.ts 同模式）
 */
import { sql } from "drizzle-orm";
import { pathToFileURL } from "node:url";
import { db } from "@/lib/db";
import { forums } from "@/lib/db/schema";

type ForumSeed = {
  slug: string;
  name: string;
  description: string;
  sortOrder: number;
};

/** spec 固定的初始 5 板块 */
const SEED_FORUMS: ForumSeed[] = [
  {
    slug: "creation",
    name: "创作交流",
    description: "小说与剧本创作心得、工具与技巧讨论",
    sortOrder: 1,
  },
  {
    slug: "camera",
    name: "运镜与视频生成",
    description: "镜头语言、AI 视频生成经验分享",
    sortOrder: 2,
  },
  {
    slug: "qa",
    name: "求助问答",
    description: "遇到问题来这里提问",
    sortOrder: 3,
  },
  {
    slug: "showcase",
    name: "作品展示",
    description: "晒出你的 AI 影视作品",
    sortOrder: 4,
  },
  {
    slug: "meta",
    name: "站务公告",
    description: "站点公告与反馈",
    sortOrder: 5,
  },
];

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error(
      "请先配置 DATABASE_URL（如 npx tsx --env-file=.env scripts/seed-forums.ts）",
    );
    process.exit(1);
  }

  await db
    .insert(forums)
    .values(SEED_FORUMS)
    .onConflictDoUpdate({
      target: forums.slug,
      // set 引用 excluded（本次拟插入值）实现逐行动态 upsert
      set: {
        name: sql`excluded.name`,
        description: sql`excluded.description`,
        sortOrder: sql`excluded.sort_order`,
      },
    });

  console.log(`论坛板块 seed 完成：${SEED_FORUMS.length} 个板块已 upsert`);
}

// tsx 直跑时才执行 main
const invokedDirectly =
  process.argv[1] != null &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  main().catch((error) => {
    console.error("执行失败：", error);
    process.exit(1);
  });
}
