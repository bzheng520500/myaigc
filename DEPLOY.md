# AI影视工坊 部署手册

从零到生产的完整部署流程。技术栈：Next.js 16 + Drizzle ORM + Cloudflare D1（SQLite）+ SMTP 邮件（163 企业/个人授权码，Resend 备用）+ Cloudflare Workers（托管与 Cron）。

> 所有命令默认在仓库根目录 `ai-film-workshop/` 下执行。
>
> **Windows 中文路径注意**：Node 在含非 ASCII 字符的路径下执行 OpenNext 打包（`fs.cpSync`/`fs.rmSync` recursive）会让进程直接终止。`npm run build:cf / preview / deploy` 已内置规避：自动切换到纯 ASCII 工作区（默认 `M:\afw-build\ws`，可用环境变量 `CF_BUILD_WORKSPACE` 覆盖）完成构建与部署，日常开发（`npm run dev`）不受影响。

## 0. 前置条件

1. 注册 / 登录 [Cloudflare](https://dash.cloudflare.com)，本机 CLI 已登录（`npx wrangler whoami` 能看到账号即就绪）。
2. 创建 D1 数据库与 KV 命名空间（首次部署才需要）：

```bash
npx wrangler d1 create ai-film-workshop
npx wrangler kv namespace create NEXT_INC_CACHE_KV
```

把返回的 `database_id` / KV `id` 填入 `wrangler.jsonc` 对应字段。

## 1. 本地开发环境

```bash
npm install

# 初始化本地 D1（.wrangler/state 下的 sqlite）
npm run db:migrate:local

# 导入初始内容（均幂等，直接连本地 D1，不需要 .env）
npx tsx scripts/seed-forums.ts       # 论坛 5 板块
npx tsx scripts/import-skills.ts     # 内置 Skill 库
npx tsx scripts/import-prompts.ts    # 运镜提示词库
npx tsx scripts/import-tutorials.ts  # 运镜教程
```

本地 `.env` 只需要这几项（`.env` 不入库）：

| 变量 | 说明 |
| --- | --- |
| `AUTH_SECRET` | Auth.js 加密密钥，`openssl rand -base64 32` 生成 |
| `AUTH_DEV_MODE` | 本地开发填 `1`（验证链接打印到 console 并落盘，不真发邮件）；**生产禁止设置** |
| `SMTP_HOST` / `SMTP_PORT` | SMTP 服务器（如 `smtp.163.com` / `465`，隐式 TLS） |
| `SMTP_USER` / `SMTP_PASS` | 发信邮箱与授权码（163 在「POP3/SMTP/IMAP」设置里开启服务并生成授权码） |
| `AUTH_EMAIL_FROM` | 发件人，如 `AI影视工坊 <aigc202610@163.com>`；**163 要求 MAIL FROM 与认证账号一致** |
| `RESEND_API_KEY` | 备用通道；`SMTP_*` 三项齐全时才会走 SMTP，否则回落 Resend（可留空） |
| `CRON_SECRET` | 本地测 cron 用（生产用 `wrangler secret put` 配置） |

>SMTP 优先：`lib/mailer/index.ts` 先探测 `SMTP_HOST/SMTP_USER/SMTP_PASS`，齐全走 SMTP（Workers 上经 `cloudflare:sockets` 的 465 隐式 TLS，本地 Node 经 `node:tls`）；缺任一项回落 Resend（`RESEND_API_KEY`）；两者都未配置时登录会明确报「邮件服务未配置」。

```bash
npm run dev   # http://localhost:3000，next dev 会注入 wrangler.jsonc 的 D1/KV 绑定
```

## 2. 生产数据库（远程 D1）

```bash
# 应用 drizzle 迁移建表
npm run db:migrate:remote
```

### 导入内容数据（导出/导入法）

导入脚本（`scripts/import-*.ts`）通过 `getPlatformProxy()` 只能连本地库；远程库用「本地导出 SQL → 远程执行」：

```bash
# 1) 先把内容导入本地库（见第 1 节），再导出数据（不含 schema）
npx wrangler d1 export ai-film-workshop --local --no-schema \
  --table skills --table prompts --table tutorials --table forums \
  --output=content-data.sql -y

# 2) 执行到远程
npx wrangler d1 execute ai-film-workshop --remote --file=content-data.sql -y

# 3) 核对
npx wrangler d1 execute ai-film-workshop --remote \
  --command "SELECT (SELECT COUNT(*) FROM skills) AS skills, (SELECT COUNT(*) FROM prompts) AS prompts, (SELECT COUNT(*) FROM tutorials) AS tutorials, (SELECT COUNT(*) FROM forums) AS forums" -y
```

## 3. 部署 Worker

```bash
npm run deploy   # = OpenNext 构建（ASCII 工作区）+ wrangler deploy
```

部署成功输出站点地址：`https://<worker-name>.<子域>.workers.dev`。

`wrangler.jsonc` 关键配置一览：

- `main: worker.ts` —— 自定义 Worker 入口，转发 OpenNext handler 与 cron 的 `scheduled`
- `d1_databases` / `kv_namespaces` —— `DB` 与 `NEXT_INC_CACHE_KV` 绑定
- `triggers.crons: ["0 0 * * *"]` —— 每日摘要（UTC 0 点 = 北京时间 8 点）
- `vars.NEXT_PUBLIC_BASE_URL` —— 摘要邮件里链接的基地址，首次部署后按实际域名回填再部署一次

## 4. 生产 Secrets

secrets 一律用 CLI 上传（**绝不写入 `wrangler.jsonc` 或代码库**）：

```bash
printf '%s' "<AUTH_SECRET 值>"    | npx wrangler secret put AUTH_SECRET
printf '%s' "smtp.163.com"       | npx wrangler secret put SMTP_HOST
printf '%s' "465"                | npx wrangler secret put SMTP_PORT
printf '%s' "你的发信邮箱"         | npx wrangler secret put SMTP_USER
printf '%s' "<SMTP授权码>"        | npx wrangler secret put SMTP_PASS
printf '%s' "<发件人地址>"         | npx wrangler secret put AUTH_EMAIL_FROM
openssl rand -hex 32              | npx wrangler secret put CRON_SECRET
```

| Secret | 说明 |
| --- | --- |
| `AUTH_SECRET` | Auth.js 会话签名密钥（与本地一致即可） |
| `SMTP_HOST` / `SMTP_PORT` | SMTP 服务器地址与端口（`smtp.163.com` / `465`） |
| `SMTP_USER` / `SMTP_PASS` | 发信邮箱账号与授权码（不是邮箱登录密码） |
| `AUTH_EMAIL_FROM` | 发件人显示名+地址，如 `AI影视工坊 <aigc202610@163.com>` |
| `CRON_SECRET` | cron 端点鉴权；**未配置时 `/api/cron/digest` 直接 500（fail-closed）** |

> SMTP 与 Resend 是互为备用：`SMTP_HOST/SMTP_USER/SMTP_PASS` 任一缺失就回落 Resend（`RESEND_API_KEY`），两者都没有时登录页报「邮件服务未配置」。`SMTP_*` 三项齐全时无需配置 Resend。

> **`AUTH_DEV_MODE` 生产一律不设置**：设置后魔法链接不真发邮件、直接落日志，等于放开登录。本地 `.env` 里的该变量不会被 `wrangler deploy` 带上线。

cron 手动验证：

```bash
# 无密钥 → 401；带密钥 → {"sent":N,"skipped":N,"failed":N}
curl -H "Authorization: Bearer $CRON_SECRET" https://<域名>/api/cron/digest
```

## 5. 提升管理员

1. 先用你的邮箱在网站上**魔法链接登录一次**（Auth.js 才会创建用户行）。
2. 然后对远程 D1 执行：

```bash
npx wrangler d1 execute ai-film-workshop --remote \
  --command "UPDATE user SET role='admin' WHERE email='你的邮箱'" -y
```

（本地开发等价命令：`npx tsx scripts/promote-admin.ts <邮箱>`）

## 6. SMTP 发件配置（163 示例）

1. 登录 163 邮箱网页版 → **设置** → **POP3/SMTP/IMAP**，开启 `IMAP/SMTP 服务`并按提示获取**授权码**（不是邮箱登录密码）。
2. `SMTP_HOST=smtp.163.com`，`SMTP_PORT=465`（隐式 TLS）。
3. `SMTP_USER` 填邮箱地址，`SMTP_PASS` 填授权码。
4. `AUTH_EMAIL_FROM` 的地址必须与 `SMTP_USER` 一致——163 校验 MAIL FROM 与认证账号一致，不一致直接拒信。
5. **163 特有**：同账号「自发自收」可能被反垃圾延迟投递或进其他文件夹；验证时可用第二个邮箱做收件测试。另外 163 对同一邮箱有 ~60s 的重发冷却，连续触发登录会收到 `AccessDenied`，属预期频控。

（Resend 备用通道）若要切换回 Resend：把 `SMTP_HOST/SMTP_USER/SMTP_PASS` 任一项从 secrets 删除后 `wrangler deploy`，配置 `RESEND_API_KEY` 并参考其 Domains 页面添加自定义域名 SPF/DKIM 记录后 Verified。

## 7. 生产验收清单（本手册对应环境已逐项验证）

- [x] 首页 `/`：站点统计（Skill/提示词/教程数）与精选列表来自远程 D1
- [x] `/skills`、`/prompts`、`/tutorials`、`/forum` 四个内容页 200 且内容正确
- [x] Skill 详情页正文 markdown 渲染正常
- [x] `/login` 魔法链接页 200，提交后收到 SMTP 邮件
- [x] 未登录访问受保护页面（`/upload`、`/forum/new`、`/notifications`、`/profile`）307 跳登录
- [x] `/api/cron/digest`：无密钥 401，带 `CRON_SECRET` 返回统计 JSON
- [x] 登录全流程：邮件magic链接 → 点击 → session 建立、身份为登录邮箱（线上已验证 aigc202610@163.com）
- [ ] 发帖 / 回复 / 点赞 / 收藏 / 通知——需要两个账号交互验证

## 常见问题

- **部署时进程无声退出（exit 127/1）**：项目路径含中文导致，`npm run deploy` 已自动切换 ASCII 工作区；若手动跑 OpenNext CLI 请设 `CF_BUILD_WORKSPACE`。
- **收不到登录邮件**：① 检查 `SMTP_HOST/SMTP_USER/SMTP_PASS` 三项是否都已 put（缺任一即回落 Resend）；② 163 自发自收有反垃圾延迟/可能进其他文件夹；③ 连续触发登录会因 60s 频控返回 `AccessDenied`（等 1 分钟）；④ 生产误设 `AUTH_DEV_MODE=1` 会跳过真实发信，须确保未设置。
- **cron 返回 500**：`CRON_SECRET` 未上传（fail-closed 设计），`wrangler secret put CRON_SECRET` 后自动生效。
- **cron 返回 401**：请求未带 `Authorization: Bearer <CRON_SECRET>` 或值不匹配。
- **本地测试连库**：`D1_LOCAL_TEST=1 npx vitest run`（自动经 `getPlatformProxy()` 连本地 D1，文件串行执行）。
- **远程 D1 结构变更**：修改 `lib/db/schema.ts` → `npm run db:generate` 生成迁移 → `npm run db:migrate:remote`。
