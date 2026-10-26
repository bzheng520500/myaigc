import { like, or, eq } from "drizzle-orm";
import { pinyin } from "pinyin-pro";
import { db, isDbAvailable } from "@/lib/db";
import { skills } from "@/lib/db/schema";

/**
 * 中文友好 slug 生成与冲突去重（Task 11，Review Focus #3 slug 冲突）。
 *
 * - slugify：中文名经 pinyin-pro 转无声调拼音（逐字数组 join，
 *   多字词的拼音直接相连），英文单词/数字原样保留，小写后把
 *   连续非 [a-z0-9] 字符压缩为单个连字符并去首尾
 * - ensureUniqueSlug：查 skills 表的 slug 前缀族冲突（base 本身或
 *   任何 base- 开头的 slug），冲突时追加 4 位随机后缀并复查，
 *   极小概率连续撞车时最多重试 5 次
 */

/** 随机后缀字符集（nanoid 风格小写字母数字） */
const SUFFIX_CHARS = "abcdefghijklmnopqrstuvwxyz0123456789";

function randomSuffix(length = 4): string {
  let out = "";
  for (let i = 0; i < length; i++) {
    out += SUFFIX_CHARS[Math.floor(Math.random() * SUFFIX_CHARS.length)];
  }
  return out;
}

export function slugify(name: string): string {
  const raw = pinyin(name, { toneType: "none", type: "array" }).join("");
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** LIKE 模式转义（base 含 % / _ 时按字面匹配） */
function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

/** slug 等于 base 或以 `base-` 开头的行是否存在 */
async function slugFamilyExists(slug: string): Promise<boolean> {
  const [row] = await db
    .select({ slug: skills.slug })
    .from(skills)
    .where(
      or(eq(skills.slug, slug), like(skills.slug, `${escapeLike(slug)}-%`)),
    )
    .limit(1);
  return row != null;
}

export async function ensureUniqueSlug(base: string): Promise<string> {
  // 空串兜底：拼音归一化后一个字符都不剩（如纯标点名）
  if (!base) {
    return `skill-${randomSuffix()}`;
  }
  // 无数据库环境（本地 vitest / 纯静态构建）：无法查重，原样返回
  if (!isDbAvailable()) {
    return base;
  }

  if (!(await slugFamilyExists(base))) {
    return base;
  }

  for (let attempt = 0; attempt < 5; attempt++) {
    const candidate = `${base}-${randomSuffix()}`;
    if (!(await slugFamilyExists(candidate))) {
      return candidate;
    }
  }
  // 连续 5 次撞车（概率 < 36^5 分之一族）：换更长的时间性后缀兜底
  return `${base}-${Date.now().toString(36)}`;
}
