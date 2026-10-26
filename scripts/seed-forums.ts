/**
 * 论坛初始板块 seed 脚本（Phase 2 Task 1）。
 *
 * 用法：
 *
 *   npx tsx scripts/seed-forums.ts
 *
 * 语义要点：
 * - 幂等：onConflictDoUpdate by slug，重复执行只更新
 *   name / description / sortOrder，不重置 threadCount / replyCount
 *   （计数由发帖/回复 action 维护，seed 不得覆盖）
 * - 无本地 D1：connectScriptDb 抛错并退出码 1（见 scripts/d1.ts）
 */
import { sql } from "drizzle-orm";
import { pathToFileURL } from "node:url";
import { db } from "@/lib/db";
import { connectScriptDb } from "@/scripts/d1";
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

async function main(): Promise<number> {
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

// tsx 直跑时才执行 main
const invokedDirectly =
  process.argv[1] != null &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  run()
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error) => {
      console.error("执行失败：", error);
      process.exitCode = 1;
    });
}
