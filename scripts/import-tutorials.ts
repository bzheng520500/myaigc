/**
 * 运镜教学批量导入脚本（Task 13b，Phase 1 Step 5）。
 *
 * 用法：
 *
 *   npx tsx scripts/import-tutorials.ts
 *
 * 语义要点：
 * - 幂等：slug = slugify(title)（确定性），冲突键 slug 的
 *   onConflictDoUpdate 更新 title/summary/contentMd/sortOrder
 *   （tutorials 表没有 updatedAt 字段）。
 * - 正文图片路径改写：extracted/images/xxx.png → /tutorials/xxx.png；
 *   同时把 content-source/extracted/images/ 全部复制到 public/tutorials/
 *   （已存在则跳过覆盖），正文引用与静态资源一一对应。
 * - 宽松：缺 frontmatter 或缺 title 的文件「跳过并统计」，不报错中断。
 * - 单条失败不中断整体，结尾汇总统计；全部失败才退出码 1。
 */
import {
  access,
  copyFile,
  mkdir,
  readdir,
  readFile,
} from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { eq } from "drizzle-orm";
import matter from "gray-matter";
import { db } from "@/lib/db";
import { connectScriptDb } from "@/scripts/d1";
import { tutorials } from "@/lib/db/schema";
import { slugify } from "@/lib/slug";

type ImportStats = {
  inserted: number;
  updated: number;
  skipped: number;
  failed: number;
};

const TUTORIALS_SRC_DIR = join(
  process.cwd(),
  "content-source",
  "extracted",
  "tutorials",
);
const IMAGES_SRC_DIR = join(
  process.cwd(),
  "content-source",
  "extracted",
  "images",
);
const IMAGES_DEST_DIR = join(process.cwd(), "public", "tutorials");

/** 正文图片路径改写：extracted/images/<file> → /tutorials/<file> */
export function rewriteImagePaths(markdown: string): string {
  return markdown.replaceAll("extracted/images/", "/tutorials/");
}

/** frontmatter 字段取值：仅对应类型的非空值有效 */
function stringValue(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}
function numberValue(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** 把 images 目录下的静态图全量复制到 public/tutorials（已存在则跳过） */
async function syncImages(): Promise<number> {
  await mkdir(IMAGES_DEST_DIR, { recursive: true });
  const files = (await readdir(IMAGES_SRC_DIR)).filter((f) =>
    /\.(png|jpe?g|gif|webp|svg)$/i.test(f),
  );
  let copied = 0;
  for (const file of files) {
    const dest = join(IMAGES_DEST_DIR, file);
    try {
      await access(dest); // 已存在：跳过覆盖（幂等）
    } catch {
      await copyFile(join(IMAGES_SRC_DIR, file), dest);
      copied += 1;
    }
  }
  return copied;
}

function formatStats(stats: ImportStats): string {
  return `新增 ${stats.inserted} · 更新 ${stats.updated} · 跳过 ${stats.skipped} · 失败 ${stats.failed}`;
}

async function main(): Promise<number> {
  // 先落静态图，再入库正文（正文会引用 /tutorials/ 路径）
  const copied = await syncImages();
  console.log(`图片同步：public/tutorials/ 本次新复制 ${copied} 张（已存在跳过）`);

  const files = (await readdir(TUTORIALS_SRC_DIR))
    .filter((f) => f.toLowerCase().endsWith(".md"))
    .sort();
  console.log(`读取 ${TUTORIALS_SRC_DIR}（${files.length} 个 md）…`);

  const stats: ImportStats = { inserted: 0, updated: 0, skipped: 0, failed: 0 };
  for (const file of files) {
    try {
      const raw = await readFile(join(TUTORIALS_SRC_DIR, file), "utf8");
      const parsed = matter(raw);
      const data = parsed.data ?? {};
      const title = stringValue(data.title);
      if (Object.keys(data).length === 0 || !title) {
        stats.skipped += 1;
        console.warn(`[跳过] ${file}：缺少 frontmatter 或 title`);
        continue;
      }

      const slug = slugify(title);
      if (!slug) {
        throw new Error(`title「${title}」经 slugify 后为空`);
      }
      const values = {
        slug,
        title,
        summary: stringValue(data.summary) ?? null,
        contentMd: rewriteImagePaths(parsed.content),
        category: "运镜教学",
        sortOrder: numberValue(data.sort_order),
      };

      // 幂等统计：upsert 前查一次该 slug 是否已有行
      const [existing] = await db
        .select({ id: tutorials.id })
        .from(tutorials)
        .where(eq(tutorials.slug, slug))
        .limit(1);

      await db
        .insert(tutorials)
        .values(values)
        .onConflictDoUpdate({
          target: tutorials.slug,
          set: {
            title: values.title,
            summary: values.summary,
            contentMd: values.contentMd,
            sortOrder: values.sortOrder,
          },
        });

      const outcome = existing ? "updated" : "inserted";
      stats[outcome] += 1;
      console.log(`[${existing ? "更新" : "新增"}] ${file} → ${slug}`);
    } catch (error) {
      stats.failed += 1;
      console.error(
        `[失败] ${file}：`,
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
