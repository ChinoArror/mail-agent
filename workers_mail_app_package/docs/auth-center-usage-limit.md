# Auth Center Tokens 用量限制接入说明

Gemini Agent 生成不在 Mail Agent 内部实现 tokens 限制策略，只接入 Auth Center 的前置检测和后置上报。

## 前置检测

创建 Agent 任务前，后端调用：

```text
GET https://accounts.aryuki.com/api/quota/check?uuid=<uuid>&app_id=mail-agent
Authorization: Bearer <AUTH_APP_SECRET>
```

检测失败时不会创建 Gemini 调用任务，接口返回明确错误。

## 后置上报

Queue Consumer 调用 Gemini 成功后，从响应中的：

```javascript
data.usageMetadata.totalTokenCount
```

读取实际 tokens，并调用：

```text
POST https://accounts.aryuki.com/api/quota/consume
Authorization: Bearer <AUTH_APP_SECRET>
Content-Type: application/json
```

请求体：

```json
{
  "uuid": "<uuid>",
  "app_id": "mail-agent",
  "tokens": 1234
}
```

## Secret

Quota API 的 app secret 使用 Worker secret 保存，建议命名：

```bash
npx wrangler secret put AUTH_APP_SECRET
```

该 secret 不得写入前端、源码、README 示例明文或 `wrangler.toml`。

## 本地记录

Mail Agent 会同时在本地 `agent_jobs.actual_tokens` 与 `usage_counters(type='tokens')` 记录用量，便于 Admin Analysis 展示；权威限制仍以 Auth Center 为准。
