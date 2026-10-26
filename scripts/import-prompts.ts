/**
 * 运镜提示词批量导入脚本（Task 13b，Phase 1 Step 4）。
 *
 * 用法：
 *
 *   npx tsx scripts/import-prompts.ts
 *
 * 语义要点：
 * - 幂等：schema 的 prompts 表没有 (source_doc, sort_order) 复合唯一
 *   约束，无法用 onConflictDoUpdate——改为逐条 select（source_doc +
 *   sort_order，均 null-safe）存在则 update、否则 insert，幂等目标等价。
 * - prompt_en 为空的条目（如纯中文提示词）原样入库为空串；前端展示/
 *   复制的回退由 components/prompt-card.tsx 处理（promptEn || promptZh）。
 * - image_url 非空时把 content-source/extracted/images/<file> 复制到
 *   public/tutorials/<file>（已存在则跳过覆盖），DB 存公网路径
 *   /tutorials/<file>。
 * - 单条失败不中断整体，结尾汇总统计；全部失败才退出码 1。
 */
import { access, copyFile, mkdir, readFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { connectScriptDb } from "@/scripts/d1";
import { prompts } from "@/lib/db/schema";

type ImportStats = {
  inserted: number;
  updated: number;
  skipped: number;
  failed: number;
};

/** prompts.json 的单条种子（蛇形键，入库时映射为 schema 驼峰键） */
type PromptSeed = {
  name: string;
  category: string;
  prompt_en: string | null;
  prompt_zh: string | null;
  notes: string | null;
  image_url: string | null;
  source_doc: string | null;
  sort_order: number | null;
};

const PROMPTS_JSON = join(
  process.cwd(),
  "content-source",
  "extracted",
  "prompts.json",
);
const IMAGES_SRC_DIR = join(
  process.cwd(),
  "content-source",
  "extracted",
  "images",
);
const IMAGES_DEST_DIR = join(process.cwd(), "public", "tutorials");

/**
 * 本地图片落盘并返回 DB 应存的公网路径：
 * image_url 形如 "images/特效运镜-1.png"，取 basename 复制到
 * public/tutorials/ 下（已存在则跳过覆盖），返回 "/tutorials/<file>"。
 */
async function resolveImage(imageUrl: string | null): Promise<string | null> {
  if (!imageUrl) return null;
  const file = basename(imageUrl);
  const dest = join(IMAGES_DEST_DIR, file);
  try {
    await access(dest); // 已存在：跳过覆盖（幂等）
  } catch {
    await mkdir(dirname(dest), { recursive: true });
    await copyFile(join(IMAGES_SRC_DIR, file), dest); // 源缺失会抛错，由调用方计 failed
  }
  return `/tutorials/${file}`;
}

/** 幂等键匹配：(source_doc, sort_order)，两者都可能为 null */
function idempotencyWhere(seed: PromptSeed) {
  return and(
    seed.source_doc == null
      ? isNull(prompts.sourceDoc)
      : eq(prompts.sourceDoc, seed.source_doc),
    seed.sort_order == null
      ? isNull(prompts.sortOrder)
      : eq(prompts.sortOrder, seed.sort_order),
  );
}

async function upsertPrompt(seed: PromptSeed): Promise<"inserted" | "updated"> {
  const [existing] = await db
    .select({ id: prompts.id })
    .from(prompts)
    .where(idempotencyWhere(seed))
    .limit(1);

  const values = {
    name: seed.name,
    category: seed.category,
    promptEn: seed.prompt_en ?? "",
    promptZh: seed.prompt_zh,
    notes: seed.notes,
    imageUrl: await resolveImage(seed.image_url),
    sourceDoc: seed.source_doc,
    sortOrder: seed.sort_order,
  };

  if (existing) {
    await db.update(prompts).set(values).where(eq(prompts.id, existing.id));
    return "updated";
  }
  await db.insert(prompts).values(values);
  return "inserted";
}

function formatStats(stats: ImportStats): string {
  return `新增 ${stats.inserted} · 更新 ${stats.updated} · 跳过 ${stats.skipped} · 失败 ${stats.failed}`;
}

async function main(): Promise<number> {
  const raw: unknown = JSON.parse(await readFile(PROMPTS_JSON, "utf8"));
  if (!Array.isArray(raw)) {
    console.error(`prompts.json 内容不是数组：${PROMPTS_JSON}`);
    return 1;
  }
  const seeds = raw as PromptSeed[];
  console.log(`读取 ${PROMPTS_JSON}（${seeds.length} 条）…`);

  const stats: ImportStats = { inserted: 0, updated: 0, skipped: 0, failed: 0 };
  for (const [index, seed] of seeds.entries()) {
    const label = `#${index + 1} ${seed.name ?? "(无名)"}`;
    try {
      const outcome = await upsertPrompt(seed);
      stats[outcome] += 1;
      console.log(`[${outcome === "inserted" ? "新增" : "更新"}] ${label}`);
    } catch (error) {
      stats.failed += 1;
      console.error(
        `[失败] ${label}：`,
        error instanceof Error ? error.message : error,
      );
    }
  }

  console.log(`导入完成：${formatStats(stats)}`);
  const total = stats.inserted + stats.updated + stats.skipped + stats.failed;
  return total > 0 && stats.failed === total ? 1 : 0;
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
