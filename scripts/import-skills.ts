/**
 * 内置技能批量导入脚本（Task 13b，Phase 1 Step 3）。
 *
 * 用法（DATABASE_URL 需就位，.env 不会被 tsx 自动加载）：
 *
 *   npx tsx --env-file=.env scripts/import-skills.ts
 *
 * 语义要点（与用户上传不同）：
 * - 幂等：slug 由 slugify(name) 确定性生成——base 已存在且 source=
 *   'builtin' 则原位 update；被用户内容（source='user'）占用则落
 *   <base>-builtin。绝不用 ensureUniqueSlug（随机后缀会让重复导入
 *   不断产生新行，破坏幂等）。
 * - 宽松：缺 frontmatter 的文件「跳过并统计」，不报错中断。
 * - 单条失败不中断整体，结尾汇总统计；全部失败才退出码 1。
 */
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { eq } from "drizzle-orm";
import matter from "gray-matter";
import { db } from "@/lib/db";
import { skills } from "@/lib/db/schema";
import { slugify } from "@/lib/slug";

export type ImportStats = {
  inserted: number;
  updated: number;
  skipped: number;
  failed: number;
};

export type ParsedSkillFile =
  | { ok: true; name: string; description: string; contentMd: string }
  | { ok: false; skip: string };

/** frontmatter 字段取值：trim 后非空字符串才有效，否则 undefined */
function stringValue(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

/**
 * 宽松解析单个技能 md（导入语义）：
 * - YAML 解析失败或缺 frontmatter → { ok:false }（调用方跳过并统计）
 * - name 缺失 → 回退文件名去扩展；description 缺失 → 空串，超 500 字截断
 * - contentMd 保留原文件全文（含 frontmatter）
 */
export function parseSkillFile(raw: string, filename: string): ParsedSkillFile {
  let parsed: ReturnType<typeof matter>;
  try {
    parsed = matter(raw);
  } catch {
    return { ok: false, skip: "frontmatter YAML 解析失败" };
  }

  const data = parsed.data ?? {};
  if (Object.keys(data).length === 0) {
    return { ok: false, skip: "缺少 frontmatter" };
  }

  const name = stringValue(data.name) ?? filename.replace(/\.md$/i, "");
  const description = (stringValue(data.description) ?? "").slice(0, 500);
  return { ok: true, name, description, contentMd: raw };
}

/** 统计摘要行：成功（新增/更新）、跳过、失败分列 */
export function formatStats(stats: ImportStats): string {
  return `新增 ${stats.inserted} · 更新 ${stats.updated} · 跳过 ${stats.skipped} · 失败 ${stats.failed}`;
}

type SkillRow = { name: string; description: string; contentMd: string };

/** 确定性 slug 的单条 upsert，返回「该 slug 导入前是否已有行」 */
async function upsertSkill(row: SkillRow): Promise<"inserted" | "updated"> {
  const base = slugify(row.name);
  if (!base) {
    throw new Error(`name「${row.name}」经 slugify 后为空，无法生成确定性 slug`);
  }

  let slug = base;
  let existed: boolean;

  const [baseRow] = await db
    .select({ source: skills.source })
    .from(skills)
    .where(eq(skills.slug, base))
    .limit(1);
  if (!baseRow) {
    existed = false;
  } else if (baseRow.source === "builtin") {
    // 上次导入留下的内置行：原位 update，slug 不变（幂等核心）
    existed = true;
  } else {
    // 被用户内容占用：内置内容落到 <base>-builtin（确定性后缀）
    slug = `${base}-builtin`;
    const [altRow] = await db
      .select({ source: skills.source })
      .from(skills)
      .where(eq(skills.slug, slug))
      .limit(1);
    if (altRow && altRow.source !== "builtin") {
      throw new Error(
        `slug「${slug}」也被 source=${altRow.source} 的行占用，无法幂等导入`,
      );
    }
    existed = altRow != null;
  }

  await db
    .insert(skills)
    .values({
      slug,
      name: row.name,
      description: row.description,
      contentMd: row.contentMd,
      category: "小说创作",
      tags: ["小说创作"],
      source: "builtin",
      status: "published",
    })
    .onConflictDoUpdate({
      target: skills.slug,
      set: {
        name: row.name,
        description: row.description,
        contentMd: row.contentMd,
        updatedAt: new Date(),
      },
    });

  return existed ? "updated" : "inserted";
}

/** 遍历目录下的 *.md 逐条导入（可参数化：main 用真实目录，测试用 fixtures） */
export async function importSkillsFromDir(dir: string): Promise<ImportStats> {
  const stats: ImportStats = { inserted: 0, updated: 0, skipped: 0, failed: 0 };
  const files = (await readdir(dir))
    .filter((f) => f.toLowerCase().endsWith(".md"))
    .sort();

  for (const file of files) {
    try {
      const raw = await readFile(join(dir, file), "utf8");
      const parsed = parseSkillFile(raw, file);
      if (!parsed.ok) {
        stats.skipped += 1;
        console.warn(`[跳过] ${file}：${parsed.skip}`);
        continue;
      }
      const outcome = await upsertSkill(parsed);
      stats[outcome] += 1;
      console.log(
        `[${outcome === "inserted" ? "新增" : "更新"}] ${file} → ${slugify(parsed.name)}`,
      );
    } catch (error) {
      stats.failed += 1;
      console.error(
        `[失败] ${file}：`,
        error instanceof Error ? error.message : error,
      );
    }
  }
  return stats;
}

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("请先配置 DATABASE_URL（如 npx tsx --env-file=.env scripts/import-skills.ts）");
    process.exit(1);
  }

  const dir = join(process.cwd(), "content-source", "skills");
  console.log(`读取 ${dir} …`);
  const stats = await importSkillsFromDir(dir);
  console.log(`导入完成：${formatStats(stats)}`);

  const total = stats.inserted + stats.updated + stats.skipped + stats.failed;
  process.exit(total > 0 && stats.failed === total ? 1 : 0);
}

// tsx 直跑时才执行 main；被测试 import 时不触发
const invokedDirectly =
  process.argv[1] != null &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  main().catch((error) => {
    console.error("执行失败：", error);
    process.exit(1);
  });
}
