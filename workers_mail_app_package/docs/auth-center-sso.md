# Auth Center SSO 接入说明

Mail Agent 使用 `accounts.aryuki.com` 作为统一登录中心。

## 前端流程

1. 未登录时点击登录按钮。
2. 前端跳转到：

```text
https://accounts.aryuki.com/login?app_id=mail-agent&redirect=https%3A%2F%2Fmail.112327.xyz%2Fsso-callback
```

（统一登录文档 2026-09-30：使用 `/login?app_id=…`；旧的 `/?client_id=…` 仍兼容。）

3. Auth Center 登录成功后回跳：

```text
/sso-callback?token=<jwt>
```

4. 回调页先用 `history.replaceState` 把 token 从地址栏移除（不在 URL / 历史记录中保留 JWT），再调用 `POST /api/sso-callback`，后端校验 token 并写入/更新本地 `users` 表。回调页显示分步进度（收到 token → 校验身份 → 加载工作区），失败时可重试或重新登录。
5. 后续 API 请求统一携带：

```text
Authorization: Bearer <jwt>
```

## 后端校验

后端不使用 App Secret 本地验签。每个受保护 API 都通过 Auth Center 权威端点校验：

```text
GET https://accounts.aryuki.com/api/verify?app_id=mail-agent
Authorization: Bearer <jwt>
```

校验通过后，Worker 从 verify 响应或 JWT payload 中读取：

- `uuid`
- `username`
- `name`
- `avatar_url`
- `exp`

并根据本地 `users.role` 与初始规则 `username === "admin"` 判断角色。

## 过期与冻结

- token 缺失返回 `401 AUTH_REQUIRED`
- token 无效或过期返回 `401 AUTH_INVALID`
- Auth Center 返回暂停/无权限时返回 `403 AUTH_FORBIDDEN`
- 本地用户 `status = frozen` 时返回 `403 USER_FROZEN`

## 配置项

`wrangler.toml` 中：

```toml
[vars]
APP_ID = "mail-agent"
APP_UUID = "357a4032-ce5b-49bd-8ab4-24b06d5a7e5b"
AUTH_CENTER_URL = "https://accounts.aryuki.com"
CALLBACK_URL = "https://mail.112327.xyz/sso-callback"
```

## 静默续期

- JWT 最长 1 小时。`/api/me` 返回 `401` 时，前端清除本地 token，显示“正在续期会话”，并跳转到 `/login?app_id=…&redirect=…`。
- 若 Auth Center 的刷新 Cookie 与 D1 会话仍有效，Auth Center 会直接签发新 JWT 并回跳，用户无感知；否则显示登录表单。
- 为避免重定向循环，自动续期每分钟最多触发一次（`sessionStorage.mail_agent_renew_at`），超过后显示登录页并提示会话已结束。
- `403`（账号被冻结或无应用权限）不会自动续期，直接显示原因。
