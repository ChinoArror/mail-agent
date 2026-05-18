# Mail Agent

[English](README.md) | 简体中文

Mail Agent 是一个基于 Cloudflare Workers 的全栈临时邮箱 WebApp。它支持用户在 `112327.xyz` 域名下创建临时邮箱，通过 Cloudflare Email Routing 收信，通过 Resend 发信，管理草稿和附件，并使用 Gemini Agent 辅助生成、润色和改写邮件。

当前线上自定义域：

```text
https://mail.112327.xyz
```

## 已实现功能

### 登录与权限

- 使用 Auth Center SSO 登录。
- 所有受保护的 `/api/*` 请求都由后端校验 token。
- 后端从 Auth Center verify 结果或 JWT payload 中解析 username。
- 用户信息保存在 D1 的 `users` 表中。
- 内置 admin 识别规则支持 `username === "admin"`。
- Admin API 使用后端 middleware 校验。
- 普通用户只能访问自己的邮箱、邮件、草稿、附件。
- 应用内“身份/权限”可控制：
  - 用户可见和可使用的页面，
  - 邮箱数量上限，
  - 每日发送数量上限，
  - 每日接收数量上限，
  - 附件总存储上限。
- Gemini/API tokens 用量限制不在本应用内实现策略，而是通过 Auth Center 用量限制服务进行使用前检测和使用后上报。

### 临时邮箱

- 邮箱根域名固定为：`112327.xyz`。
- 用户可创建类似以下地址：
  - `abc@112327.xyz`
  - `shop-test@112327.xyz`
  - `home_001@112327.xyz`
- local-part 校验规则：
  - 统一小写存储，
  - 允许 `a-z`、`0-9`、`.`、`-`、`_`，
  - 长度 3-64，
  - 禁止点号开头或结尾，
  - 禁止连续点号，
  - 禁止保留名，
  - D1 唯一索引防止并发重复创建。
- 邮箱卡片显示状态、收件数量、发件数量、附件占用。
- 添加邮箱只保留 `+` 按钮，点击后弹出悬浮窗口填写邮箱信息。
- 用户可修改邮箱别名、状态，并软删除自己的邮箱。
- 管理员可查看和管理全部邮箱。

### 收件

收件链路：

```text
外部发件人
-> Cloudflare Email Routing catch-all: *@112327.xyz
-> Mail Agent Email Worker
-> 校验 D1 邮箱、状态、用户、配额
-> 原始 .eml 存入 R2
-> 邮件 metadata 写入 D1
-> 投递 mail-parse-queue
-> Queue Consumer 使用 postal-mime 解析 MIME
-> 附件存 R2
-> 邮件状态更新为 parsed 或 failed
```

注意：动态邮箱地址不是逐个在 Cloudflare Email Routing 中创建的。必须配置 catch-all 到 Worker。否则邮件会在进入 Worker 前被 Cloudflare 拒收，发送方可能看到：

```text
550 5.1.1 Address does not exist
```

### 发件

发件链路：

```text
用户点击发送
-> 后端校验 JWT
-> 校验 from 邮箱属于当前用户
-> 检查发送数量和附件限制
-> 邮件 payload 和附件写入 D1/R2
-> 投递 mail-send-queue
-> Queue Consumer 调 Resend
-> 状态更新为 sent/retrying/failed
-> send_logs 和 audit_logs 记录
```

前端不会直接调用 Resend。必须将 `RESEND_API_KEY` 配置为 Worker secret。

### 草稿

- 写邮件时自动创建草稿。
- 内容变化后 2 秒 debounce 自动保存。
- 草稿保存：
  - 发件邮箱，
  - to，
  - cc，
  - bcc，
  - subject，
  - text body，
  - html body，
  - attachments。
- 刷新页面后可恢复草稿。
- 草稿历史保存在 `draft_versions`。
- 草稿箱支持搜索。
- 草稿箱支持左侧勾选和批量删除。
- 个人设置中可配置草稿定时删除：
  - 1 天，
  - 3 天，
  - 1 周，
  - 1 月。
- 草稿发送后标记为 sent。

### 附件

- 附件文件存储在私有 R2 bucket。
- D1 只保存 metadata 和 `r2_key`。
- 下载附件必须经过 Worker 鉴权。
- 禁止危险扩展名，例如 `.exe`、`.bat`、`.cmd`、`.js`、`.vbs`、`.scr`。
- 后端检查单文件大小和用户附件总量。
- 可选的恶意文件扫描适配器：`MALWARE_SCAN_URL`。
- 附件页支持：
  - 搜索，
  - 类型筛选，
  - 排序，
  - 左右两列 4:3 卡片，
  - 创建时间，
  - 文件大小，
  - 下载按钮，
  - 快捷跳转到对应邮件或草稿，
  - 图片缩略图，
  - PDF、文档、压缩包、图片、普通文件图标。

### Gemini Agent

Agent 链路：

```text
用户请求 AI 生成
-> 后端校验 JWT
-> 后端调用 Auth Center quota check
-> 创建 agent_jobs 记录
-> 投递 agent-generate-queue
-> Queue Consumer 调 Gemini API
-> 向 Auth Center 上报实际 tokens
-> 本地记录 tokens 和 agent counter
-> 前端轮询展示结果
```

支持的 AI 功能：

- 生成邮件，
- 生成回复草稿，
- 翻译为英文，
- 回复邮件，
- 润色，
- 改写语气，
- 总结邮件，
- 生成主题，
- 生成回复建议。

前端不会直接调用 Gemini。必须将 `GEMINI_API_KEY` 配置为 Worker secret。

### 用户界面

当前 UI 是紧凑 SaaS 邮箱工作台风格：

- 深色左侧栏，
- 紧凑顶栏，
- 更小的搜索框和控件，
- 浅色内容区，
- 响应式布局，
- 支持浅色/暗色模式，
- 邮箱工作台左侧邮箱卡片、右侧邮件列表，
- 紧凑写邮件编辑器，
- AI 助手侧栏，
- 附件卡片网格，
- 用量说明和趋势，
- 个人设置页，
- 管理员表格和弹窗，
- 审计日志长内容自动换行。

### 管理员功能

管理员页面包括：

- 分析统计，
- 用户列表，
- 邮箱列表，
- 权限控制，
- 系统设置，
- 审计日志。

用户管理支持：

- 查看用户，
- 搜索和筛选用户，
- 冻结/恢复用户，
- 查看用户用量，
- 重置今日发送/接收 counter，
- 修改用户身份。

权限控制支持：

- 查看身份列表，
- 新增自定义身份，
- 修改身份名称、描述、排序，
- 设置默认身份，
- 配置页面权限，
- 配置本地配额，
- 删除 custom 身份。

身份被修改后，使用该身份的用户会同步对应配额。custom 身份被删除后，对应用户会回落到默认身份。

系统设置目前只保留落地页背景相关配置：

- 上传自定义落地页背景图，
- 调节透明度，
- 删除已上传背景图并恢复默认背景。

### 用量与限制逻辑

本应用有两套用量逻辑：

1. Auth Center 控制 Gemini/API tokens。
   - 本应用只做使用前检测和使用后上报。
   - tokens 限制策略不在本应用中实现。

2. Mail Agent 本地控制邮箱资源。
   - 邮箱数量，
   - 每日发送数量，
   - 每日接收数量，
   - 附件总大小，
   - 附件统计。

管理员不受本地资源限制，但管理员的用量仍会记录并展示在 Analysis 页面。

## 技术栈

- Cloudflare Workers
- Cloudflare Workers Assets
- Cloudflare Email Worker
- Cloudflare D1
- Cloudflare R2
- Cloudflare Queues
- Hono
- React
- Vite
- Resend
- Gemini API
- Auth Center SSO 和用量限制服务
- `postal-mime`
- `lucide-react`

## 项目结构

```text
workers_mail_app_package/
  src/
    client/
      main.tsx
      styles.css
    server/
      worker.ts
  migrations/
    0001_initial.sql
    0002_iteration2.sql
    0003_cloud_mail_ui.sql
    0004_compact_permissions_settings.sql
  docs/
    auth-center-sso.md
    auth-center-usage-limit.md
  checklists/
    FILLED_CHECKLIST.md
  wrangler.toml
  package.json
  README.md
  README_zh.md
```

## 本地开发

安装依赖：

```bash
npm install
```

启动本地开发服务：

```bash
npm run dev -- --host 127.0.0.1 --port 5299 --strictPort
```

类型检查和构建：

```bash
npm run typecheck
npm run build
```

预览生产构建：

```bash
npm run preview -- --host 127.0.0.1 --port 5300
```

## Cloudflare 资源

当前配置资源：

```text
D1 database name: mail-agent-db
D1 database id:   730603a4-3b9f-45b9-bc03-311d116f3c49
R2 bucket name:   mail-agent-save
Worker name:      mail-agent
Custom domain:    mail.112327.xyz
```

如需从零创建资源：

```bash
npx wrangler d1 create mail-agent-db
npx wrangler r2 bucket create mail-agent-save
npx wrangler queues create mail-parse-queue
npx wrangler queues create mail-send-queue
npx wrangler queues create agent-generate-queue
```

执行 D1 migrations：

```bash
npx wrangler d1 migrations apply mail-agent-db --remote --config wrangler.toml
```

## Worker Secrets

不要把真实 API key 写入源码、前端、README 示例或 `wrangler.toml`。

必须配置：

```bash
npx wrangler secret put RESEND_API_KEY
npx wrangler secret put GEMINI_API_KEY
npx wrangler secret put AUTH_APP_SECRET
```

用途：

- `RESEND_API_KEY`：发送队列 Consumer 调 Resend。
- `GEMINI_API_KEY`：Agent 队列 Consumer 调 Gemini。
- `AUTH_APP_SECRET`：Auth Center 用量限制服务的 app secret，用于 quota check/consume。

## Wrangler 配置

`wrangler.toml` 中的重要环境变量：

```toml
APP_ID = "mail-agent"
APP_UUID = "357a4032-ce5b-49bd-8ab4-24b06d5a7e5b"
AUTH_CENTER_URL = "https://accounts.aryuki.com"
CALLBACK_URL = "https://mail.112327.xyz/sso-callback"
MAIL_DOMAIN = "112327.xyz"
DEFAULT_MAX_MAILBOXES = "5"
DEFAULT_MAX_SEND_PER_DAY = "50"
DEFAULT_MAX_RECEIVE_PER_DAY = "200"
DEFAULT_MAX_ATTACHMENT_TOTAL_BYTES = "104857600"
GEMINI_MODEL = "gemini-3-flash-preview"
```

自定义域：

```toml
routes = [
  { pattern = "mail.112327.xyz", custom_domain = true }
]
```

绑定：

- `DB`：D1 数据库。
- `MAIL_BUCKET`：私有 R2 bucket。
- `MAIL_PARSE_QUEUE`：收件 MIME 解析队列。
- `MAIL_SEND_QUEUE`：发件 Resend 队列。
- `AGENT_GENERATE_QUEUE`：Gemini Agent 队列。
- `ASSETS`：React SPA 静态资源。

## Auth Center 配置

预留文档：

- [docs/auth-center-sso.md](docs/auth-center-sso.md)
- [docs/auth-center-usage-limit.md](docs/auth-center-usage-limit.md)

当前应用配置值：

```text
APP_ID=mail-agent
APP_UUID=357a4032-ce5b-49bd-8ab4-24b06d5a7e5b
CALLBACK_URL=https://mail.112327.xyz/sso-callback
```

退出登录行为：

- 清理本地 token。
- 跳转 Auth Center logout，并携带返回当前应用 origin 的 redirect。

## Email Routing 配置

Cloudflare Dashboard 配置：

1. 打开 Cloudflare Dashboard。
2. 进入 `112327.xyz` 站点。
3. 进入 `Email` / `Email Routing`。
4. 启用 Email Routing。
5. 确认 Cloudflare 要求的 MX 记录存在且状态正常。
6. 进入 `Routing rules` / `Routes`。
7. 启用或新增 `Catch-all address`。
8. Action 选择 `Send to Worker`。
9. Worker 选择 `mail-agent`。
10. 保存。

Wrangler CLI 配置：

```bash
npx wrangler email routing enable 112327.xyz
npx wrangler email routing rules update 112327.xyz catch-all --enabled true --action-type worker --action-value mail-agent
```

当前登录 token 必须具备 Email Routing 写权限，例如 `email_routing:write` / Email Routing Rules Write。如果 CLI 返回 `Authentication error [code: 10000]`，请重新执行：

```bash
npx wrangler login
```

或直接在 Cloudflare Dashboard 配置。

## Resend 配置

1. 在 Resend 中验证发信域名。
2. 创建 Resend API key。
3. 写入 Worker secret：

```bash
npx wrangler secret put RESEND_API_KEY
```

Worker 只会在 Queue Consumer 中调用 Resend。

## Gemini 配置

1. 创建 Gemini API key。
2. 写入 Worker secret：

```bash
npx wrangler secret put GEMINI_API_KEY
```

模型配置：

```toml
GEMINI_MODEL = "gemini-3-flash-preview"
```

## 部署

构建并部署：

```bash
npm run build
npx wrangler deploy --config wrangler.toml
```

或：

```bash
npm run deploy
```

常用验证命令：

```bash
npm run typecheck
npm run build
npx wrangler d1 migrations apply mail-agent-db --remote --config wrangler.toml
npx wrangler deploy --config wrangler.toml
```

公开配置接口检查：

```bash
curl https://mail.112327.xyz/api/public-config
```

## 用户使用说明

### 登录

1. 打开 `https://mail.112327.xyz`。
2. 点击 `使用 Auth Center 登录`。
3. 在 Auth Center 完成登录。
4. 登录后回到 `/sso-callback`。

### 创建邮箱

1. 打开邮箱页面。
2. 点击 `+`。
3. 输入 local-part，例如 `shop-test`。
4. 可选填写别名。
5. 提交。

最终地址为 `shop-test@112327.xyz`。

### 收邮件

1. 确认 Cloudflare Email Routing catch-all 已指向 Worker。
2. 向已创建邮箱发邮件。
3. 收件箱读取 D1 中真实邮件记录。
4. 打开邮件可查看正文、HTML、状态和附件。

### 发邮件

1. 打开写邮件。
2. 选择发件邮箱。
3. 填写收件人、主题、正文和附件。
4. 点击发送。
5. 在发件箱查看 `pending`、`sent`、`retrying` 或 `failed`。

### 使用草稿

- 写邮件会自动创建并保存草稿。
- 草稿箱可搜索、重新打开、勾选、批量删除。
- 个人设置可配置草稿定时删除周期。

### 使用附件

- 打开附件页面。
- 可按类型筛选或搜索文件名。
- 下载会通过 Worker 鉴权。
- 可点击跳转按钮打开关联邮件或草稿。

### 使用 Gemini Agent

1. 打开写邮件。
2. 在 AI 面板填写意图或上下文。
3. 选择 Agent 命令。
4. 点击生成。
5. 可插入、替换选区、替换正文、复制或重试。

### 查看用量

用量页会区分：

- Auth Center tokens 用量，
- 本地邮箱/发送/接收/附件配额，
- 本地趋势图。

### 个人设置

用户可修改：

- 显示名称，
- 头像 URL，
- 语言，
- 主题，
- 草稿保留周期。

Auth Center 和修改密码按钮会跳转到 Auth Center。

## 管理员使用说明

### Analysis

展示所有用户，包括 admin 的真实 D1 聚合数据：

- tokens，
- 发送数量，
- 接收数量，
- 邮箱数量，
- 附件占用，
- 发送失败数量，
- Agent 生成次数，
- 趋势图，
- CSV 导出。

### 用户管理

管理员可：

- 搜索/筛选用户，
- 查看用户用量，
- 冻结/恢复用户，
- 重置今日发送/接收计数，
- 修改用户身份。

用户列表不直接修改配额。配额通过身份配置，再应用到用户。

### 身份与权限

管理员可：

- 新增身份，
- 修改身份，
- 设置默认身份，
- 配置页面权限，
- 配置配额，
- 删除 custom 身份。

删除 custom 身份后，使用该身份的用户会回到默认身份。

### 邮箱管理

管理员可：

- 查看全部邮箱，
- 搜索地址、别名或 owner，
- 按状态过滤，
- 修改邮箱状态，
- 查看收发数量。

### 系统设置

管理员可：

- 上传自定义落地页背景图，
- 调整背景透明度，
- 删除已上传背景图。

### 审计日志

审计日志记录：

- 用户登录，
- 邮箱创建/更新/删除，
- 邮件发送请求，
- 收件请求，
- 附件上传/清理，
- Agent 生成请求，
- 管理员修改用户状态，
- 管理员修改身份，
- 系统背景修改。

过长内容会自动换行，提高可读性。

## API 概览

标准成功格式：

```json
{
  "ok": true,
  "data": {}
}
```

标准错误格式：

```json
{
  "ok": false,
  "error": {
    "code": "LIMIT_EXCEEDED",
    "message": "Mailbox limit exceeded"
  }
}
```

公开接口：

- `GET /api/public-config`
- `GET /api/landing-background`
- `POST /api/sso-callback`

用户接口：

- `GET /api/me`
- `PATCH /api/me/settings`
- `GET /api/limits`
- `GET /api/usage`
- `GET /api/usage/trends`
- `GET /api/global-search`
- `GET /api/mailboxes`
- `POST /api/mailboxes`
- `PATCH /api/mailboxes/:id`
- `DELETE /api/mailboxes/:id`
- `GET /api/emails`
- `GET /api/emails/:id`
- `PATCH /api/emails/:id/star`
- `PATCH /api/emails/bulk`
- `POST /api/emails/send`
- `GET /api/drafts`
- `POST /api/drafts`
- `GET /api/drafts/:id`
- `PATCH /api/drafts/:id`
- `DELETE /api/drafts/:id`
- `DELETE /api/drafts`
- `GET /api/drafts/:id/history`
- `POST /api/attachments/upload`
- `GET /api/attachments`
- `GET /api/attachments/:id/download`
- `DELETE /api/attachments/:id`
- `POST /api/agent/generate`
- `GET /api/agent/jobs/:id`
- `POST /api/agent/jobs/:id/retry`

管理员接口：

- `GET /api/admin/users`
- `GET /api/admin/users/:id`
- `PATCH /api/admin/users/:id/limits`
- `PATCH /api/admin/users/:id/status`
- `PATCH /api/admin/users/:id/app-role`
- `POST /api/admin/users/:id/reset-counters`
- `GET /api/admin/roles`
- `POST /api/admin/roles`
- `PATCH /api/admin/roles/:id`
- `DELETE /api/admin/roles/:id`
- `GET /api/admin/system-settings`
- `PATCH /api/admin/system-settings`
- `POST /api/admin/system-settings/background`
- `DELETE /api/admin/system-settings/background`
- `GET /api/admin/mailboxes`
- `PATCH /api/admin/mailboxes/:id/status`
- `GET /api/admin/analysis`
- `GET /api/admin/audit-logs`
- `POST /api/attachments/cleanup`

## D1 Migrations

迁移说明：

- `0001_initial.sql`：核心表与索引。
- `0002_iteration2.sql`：邮箱别名、已读/文件夹字段、附件 metadata、用户资料、草稿历史。
- `0003_cloud_mail_ui.sql`：星标邮件、身份表、系统设置表、登录 metadata。
- `0004_compact_permissions_settings.sql`：用户应用身份、草稿保留周期、落地页背景存储 metadata。

执行全部迁移：

```bash
npx wrangler d1 migrations apply mail-agent-db --remote --config wrangler.toml
```

## 安全说明

- 后端校验 SSO token。
- Admin API 使用后端权限中间件。
- 普通用户数据按 `user_id` 隔离。
- 发件 from 邮箱必须属于当前用户。
- 附件下载必须经过 Worker 鉴权。
- R2 bucket 不公开。
- Resend/Gemini API key 使用 Worker secrets。
- 前端不调用 Resend 或 Gemini。
- HTML 邮件经过基础 sanitize，并在 sandbox iframe 中展示。
- 危险附件扩展名会被阻止。
- 邮件头会清理换行，防止 header injection。
- 发件和管理员修改会写审计日志。

## 运行要求和注意事项

- 真正收件需要 Cloudflare Email Routing catch-all 指向 Worker。
- 真正发件需要 Resend API key 和已验证发信域名。
- Gemini Agent 需要 `GEMINI_API_KEY`。
- Agent tokens 配额需要 `AUTH_APP_SECRET` 和 Auth Center 用量限制服务。
- 如果 Email Routing CLI 返回权限错误，请在 Dashboard 配置或重新登录并授予 Email Routing 写权限。

## 验证记录

最近验证命令：

```bash
npm run typecheck
npm run build
npx wrangler d1 migrations apply mail-agent-db --remote --config wrangler.toml
npx wrangler deploy --config wrangler.toml
```

checklist 中记录的最新部署版本：

```text
Version ID: 8446d2bd-8bd9-4383-952a-70b802c825ca
```

完整填写的 checklist：

- [checklists/FILLED_CHECKLIST.md](checklists/FILLED_CHECKLIST.md)
