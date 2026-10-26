#!/usr/bin/env node
/**
 * OpenNext Cloudflare CLI 包装（build / preview / deploy）。
 *
 * 背景：Node（22 / 24 均已实测）在含非 ASCII 字符的路径下调用
 * `fs.cpSync(recursive)` / `fs.rmSync(recursive)` 会让进程直接终止——不是可捕获的
 * 异常，而是 exit 127/1 且无堆栈。OpenNext 打包阶段（initOutputDir、
 * copyPackageTemplateFiles、createAssets 等）必然调用这两个 API，且部分路径来自
 * `require.resolve` 的真实路径，因此无法靠 junction 规避。
 *
 * 处理方式：在项目同卷建一个纯 ASCII 的工作区（默认 M:\afw-build\ws）：
 * - 源码每次 `robocopy /MIR` 增量同步（排除 node_modules/.git/.next/.open-next/.wrangler）
 * - node_modules 按 package-lock.json 哈希一次性同步
 * - 以工作区为 cwd 运行真正的 CLI，产物与部署都在工作区内完成
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const projectRoot = process.cwd();
const args = process.argv.slice(2);
if (args.length === 0) args.push("build");

const wsRoot = process.env.CF_BUILD_WORKSPACE
  ? path.resolve(process.env.CF_BUILD_WORKSPACE)
  : path.join(path.parse(projectRoot).root, "afw-build", "ws");

const EXCLUDED_DIRS = [
  "node_modules",
  ".git",
  ".next",
  ".open-next",
  ".wrangler",
  "coverage",
  "test-results",
  "playwright-report",
];

const needsWorkspace =
  process.platform === "win32" && /[^\x00-\x7F]/.test(projectRoot);

if (!needsWorkspace) {
  runCli(projectRoot);
} else {
  prepareWorkspace();
  runCli(wsRoot);
}

function runCli(cwd) {
  const cliPath = path.join(
    cwd,
    "node_modules",
    "@opennextjs",
    "cloudflare",
    "dist",
    "cli",
    "index.js",
  );
  if (!fs.existsSync(cliPath)) {
    console.error(`[cf-build] 找不到 OpenNext CLI：${cliPath}（先执行 npm install）`);
    process.exit(1);
  }
  const result = spawnSync(process.execPath, [cliPath, ...args], {
    cwd,
    stdio: "inherit",
    env: process.env,
  });
  if (result.error) {
    console.error("[cf-build] 启动 CLI 失败：", result.error);
    process.exit(1);
  }
  process.exit(result.status ?? 1);
}

function prepareWorkspace() {
  if (path.resolve(wsRoot) === path.resolve(projectRoot)) {
    console.error("[cf-build] 工作区不能与项目根相同");
    process.exit(1);
  }
  console.log(`[cf-build] 项目路径含非 ASCII 字符，构建改在 ASCII 工作区：${wsRoot}`);
  fs.mkdirSync(wsRoot, { recursive: true });

  const sourceSync = robocopy(
    projectRoot,
    wsRoot,
    ["/MIR", "/XD", ...EXCLUDED_DIRS, "/XF", ".dev.vars", ".dev.vars.*"],
    "同步源码",
  );
  if (!sourceSync.ok) process.exit(1);

  syncNodeModules();
}

function syncNodeModules() {
  const targetModules = path.join(wsRoot, "node_modules");
  const lockHash = fileHash(path.join(projectRoot, "package-lock.json"));
  const stampPath = path.join(wsRoot, ".node-modules-stamp");

  let stamped = "";
  try {
    stamped = fs.readFileSync(stampPath, "utf8").trim();
  } catch {
    // 首次构建没有 stamp
  }

  if (lockHash && stamped === lockHash && fs.existsSync(targetModules)) return;

  console.log("[cf-build] 同步 node_modules（仅在依赖变化时执行）…");
  const result = robocopy(
    path.join(projectRoot, "node_modules"),
    targetModules,
    ["/MIR", "/MT:32"],
    "同步依赖",
  );
  if (!result.ok) process.exit(1);
  fs.writeFileSync(stampPath, lockHash || "unknown");
}

function robocopy(src, dest, flags, label) {
  const result = spawnSync("robocopy", [src, dest, ...flags], {
    stdio: ["ignore", "ignore", "inherit"],
  });
  // robocopy 退出码 0-7 表示成功（1=已复制, 2=有多余文件, 3=1+2 等）
  const code = result.status;
  if (result.error || code === null || code >= 8) {
    console.error(`[cf-build] ${label}失败（robocopy 退出码 ${code}）`);
    return { ok: false };
  }
  return { ok: true };
}

function fileHash(file) {
  try {
    return createHash("sha1").update(fs.readFileSync(file)).digest("hex");
  } catch {
    return "";
  }
}
