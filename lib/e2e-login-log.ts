import { appendFile } from "node:fs/promises";

/**
 * E2E 魔法链接落盘（Task 14）。
 *
 * Playwright 读不到 dev server 控制台：lib/auth.ts 的 DEV 分支在
 * NEXT_RUNTIME === "nodejs" 时动态 import 本模块，把魔法链接追加
 * 写入 E2E_TOKEN_URL_FILE（默认 .next/e2e-login-url.txt），
 * tests/e2e/phase1.spec.ts 轮询取用后 truncate 防串用例。
 *
 * 本模块只被 Node.js runtime 引用（lib/auth.ts 同时进入 Edge
 * middleware 图，故以 NEXT_RUNTIME 守卫 + 动态 import 隔离，
 * Edge 构建不解析本文件），可安全静态使用 node:fs。
 */

/** 追加写入一条魔法链接（未设置 E2E_TOKEN_URL_FILE 时 no-op） */
export async function appendLoginUrl(url: string): Promise<void> {
  const urlFile = process.env.E2E_TOKEN_URL_FILE;
  if (!urlFile) return;
  // 写失败只影响测试取链，不阻断登录流程
  await appendFile(urlFile, `${url}\n`, "utf8").catch(() => {});
}
