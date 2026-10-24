# AI影视工坊 部署手册

从零到生产的完整部署流程。技术栈：Next.js 16 + Drizzle ORM + Neon（PostgreSQL）+ Resend（邮件）+ Vercel（托管与 Cron）。

> 所有命令默认在仓库根目录 `ai-film-workshop/` 下执行。

## 1. Neon 建库并获取连接串

1. 注册 / 登录 [Neon](https://neon.tech)，创建 Project（区域建议选距离用户最近的，如 Singapore）。
2. 在 Project Dashboard 的 **Connection Details** 中复制连接串，形如：
   ```
   postgresql://user:password@ep-xxx-pooler.region.aws.neon.tech/neondb?sslmode=require
   ```
   建议使用带 `-pooler` 的 pooled connection string（serverless 场景连接复用更好）。

## 2. 本地 .env 配置

```bash
cp .env.example .env
```

填入各变量：

| 变量 | 说明 |
| --- | --- |
| `DATABASE_URL` | 上一步复制的 Neon 连接串 |
| `AUTH_SECRET` | Auth.js 加密密钥，`openssl rand -base64 32` 生成 |
| `AUTH_DEV_MODE` | 本地开发填 `1`（验证链接打印到 console，不真发邮件）；**生产禁止设置** |
| `RESEND_API_KEY` | Resend API 密钥（本地可留空，DEV 模式不发送） |
| `AUTH_EMAIL_FROM` | 发件人地址，如 `AI影视工坊 <noreply@your-domain.com>` |
| `CRON_SECRET` | 每日摘要 cron 端点鉴权密钥，`openssl rand -base64 32` 生成 |
| `NEXT_PUBLIC_BASE_URL` | 摘要邮件链接基地址，本地填 `http://localhost:3000`，生产填正式域名 |

## 3. 初始化数据库结构

```bash
npx drizzle-kit push
```

drizzle-kit 会自动读取 `.env` 中的 `DATABASE_URL`，把 `lib/db/schema.ts` 的全部表与索引推到 Neon。

## 4. 初始化内容数据

```bash
# 论坛初始板块（幂等，可重复执行）
npx tsx --env-file=.env scripts/seed-forums.ts

# 三个内置内容导入（均幂等）
npx tsx --env-file=.env scripts/import-skills.ts      # 内置 Skill 库
npx tsx --env-file=.env scripts/import-prompts.ts     # 运镜提示词条目
npx tsx --env-file=.env scripts/import-tutorials.ts   # 运镜教学
```

## 5. 提升管理员

> **重要**：必须先用你的邮箱在网站上**注册并登录一次**（魔法链接登录时 Auth.js 才会创建用户行），然后再执行：

```bash
npx tsx --env-file=.env scripts/promote-admin.ts <你的邮箱>
```

脚本按邮箱把 `users.role` 置为 `admin`。若提示用户不存在，说明还没登录过，先去登录再来。

## 6. 推送到 GitHub

```bash
git add -A
git commit -m "chore: ready for production"
git push origin main
```

## 7. Vercel 部署

1. [Vercel](https://vercel.com) → **Add New Project** → 导入 GitHub 仓库（框架预设自动识别 Next.js，无需改动构建配置）。
2. **Environment Variables** 逐个添加（Production + Preview 环境）：

| 变量 | 必填 | 说明 |
| --- | --- | --- |
| `DATABASE_URL` | 是 | Neon 连接串（与本地相同） |
| `AUTH_SECRET` | 是 | 与本地一致的 Auth.js 密钥（或重新生成后只用于生产） |
| `AUTH_EMAIL_FROM` | 是 | 发件人，如 `AI影视工坊 <noreply@your-domain.com>` |
| `RESEND_API_KEY` | 是 | Resend API 密钥（缺失时每日摘要快速失败，failed=-1） |
| `CRON_SECRET` | 是 | cron 端点鉴权密钥；**未设置时 /api/cron/digest 直接返回 500（fail-closed）** |
| `NEXT_PUBLIC_BASE_URL` | 是 | `https://your-domain.com`（摘要邮件内的链接基地址） |

3. **`AUTH_DEV_MODE` 生产环境一律不设置**：设置后魔法链接不真发邮件、验证链接打印到日志，等于放开登录。
4. Deploy。`vercel.json` 已配置每日摘要 Cron（`0 0 * * *` UTC，即北京时间每天 8 点调用 `/api/cron/digest`；Vercel 检测到 `CRON_SECRET` 后自动携带 `Authorization: Bearer <secret>`）。

## 8. Resend 域名与 DNS

1. [Resend](https://resend.com) → **Domains** → Add Domain，填你的自定义域名。
2. 按提示到域名 DNS 服务商添加记录（通常 1 条 SPF TXT + 1 条 DKIM CNAME）。
3. 等待验证通过（Verified）。未验证前只能用 `onboarding@resend.dev` 测试发件。
4. `AUTH_EMAIL_FROM` 使用该域名下的地址（如 `noreply@your-domain.com`）。

## 9. 生产验收清单

部署完成后逐项验证：

- [ ] **注册/登录**：输入邮箱收到魔法链接邮件（检查发件人、非垃圾邮件），点击后登录成功落回原页面
- [ ] **上传 Skill**：登录后在 Skill 库上传文档，列表与详情页可见
- [ ] **评论**：在 Skill / 教程详情页发评论，乐观插入并刷新后仍在
- [ ] **发帖/回复**：论坛选板块发帖、进帖回复，楼层号连续
- [ ] **点赞**：帖子 / 回复 / 评论点赞，计数 +1，重复点赞不叠加
- [ ] **通知**：用另一个账号回复 / 点赞你的内容，铃铛出现未读，通知中心可标读
- [ ] **每日摘要 cron**：手动触发验证（返回 `{"sent":N,"skipped":N,"failed":N}`；配置缺失时 `failed:-1`）：
  ```bash
  curl -H "Authorization: Bearer $CRON_SECRET" https://your-domain.com/api/cron/digest
  ```
- [ ] **管理后台**：promote-admin 的账号登录后可访问管理页

## 常见问题

- **收不到登录邮件**：检查 Resend 域名是否 Verified、`AUTH_EMAIL_FROM` / `RESEND_API_KEY` 是否配置、生产是否误设了 `AUTH_DEV_MODE=1`。
- **cron 返回 500**：`CRON_SECRET` 未在 Vercel 环境变量设置（fail-closed 设计）。
- **cron 返回 401**：请求未带 `Authorization: Bearer <CRON_SECRET>` 或值不匹配。
- **drizzle 结构变更**：修改 `lib/db/schema.ts` 后重新 `npx drizzle-kit push`。
