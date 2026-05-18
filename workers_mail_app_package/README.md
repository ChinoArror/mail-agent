# Mail Agent

English | [简体中文](README_zh.md)

Mail Agent is a Cloudflare Workers full-stack temporary mailbox web app. It lets users create temporary addresses under `112327.xyz`, receive mail through Cloudflare Email Routing, send mail through Resend, manage drafts and attachments, and use a Gemini-powered email assistant. The app is built as a React SPA served by Cloudflare Workers Assets, with a Hono Worker backend, D1, R2, Queues, and an Email Worker entrypoint.

The current production custom domain is:

```text
https://mail.112327.xyz
```

## What Is Included

### Authentication and Permission Model

- Auth Center SSO login.
- Backend token verification for every protected `/api/*` request.
- Username is read from Auth Center verification/JWT payload.
- Local user records are stored in D1.
- Built-in admin detection supports `username === "admin"`.
- Admin routes are protected by backend middleware.
- User data is isolated by `user_id` for mailboxes, emails, drafts, and attachments.
- App-level identities/roles can control:
  - visible and usable pages,
  - mailbox quota,
  - daily send quota,
  - daily receive quota,
  - attachment storage quota.
- Tokens/API usage quota is not controlled by this app. Gemini Agent token quota is checked and consumed through Auth Center usage limit APIs.

### Temporary Mailboxes

- Root mail domain: `112327.xyz`.
- Users can create addresses such as:
  - `abc@112327.xyz`
  - `shop-test@112327.xyz`
  - `home_001@112327.xyz`
- Local part validation:
  - lowercase storage,
  - `a-z`, `0-9`, `.`, `-`, `_`,
  - length 3-64,
  - no leading/trailing dot,
  - no consecutive dots,
  - reserved names are blocked,
  - unique D1 indexes prevent duplicate creation under concurrency.
- Mailbox cards show status, inbound count, outbound count, and attachment usage.
- Creating a mailbox uses a compact `+` button and modal.
- Users can update alias/status and soft-delete their own mailboxes.
- Admins can view and manage all mailboxes.

### Receiving Email

Inbound flow:

```text
external sender
-> Cloudflare Email Routing catch-all for *@112327.xyz
-> Mail Agent Email Worker
-> D1 mailbox/status/user/quota checks
-> raw .eml stored in R2
-> email metadata stored in D1
-> mail-parse-queue
-> MIME parsing with postal-mime
-> attachments stored in R2
-> email updated to parsed or failed
```

Important: dynamic mailbox addresses are not individually created in Cloudflare Email Routing. You must configure a catch-all route to the Worker. Without it, Cloudflare can reject messages before they reach the Worker with errors such as:

```text
550 5.1.1 Address does not exist
```

### Sending Email

Outbound flow:

```text
user clicks send
-> backend verifies JWT
-> backend verifies from mailbox belongs to user
-> send quota and attachment quota checks
-> email payload and attachments saved to D1/R2
-> mail-send-queue
-> Queue consumer calls Resend
-> status updated to sent/retrying/failed
-> send_logs and audit_logs updated
```

The frontend never calls Resend directly. `RESEND_API_KEY` must be configured as a Worker secret.

### Drafts

- Writing a message creates a draft automatically.
- Drafts auto-save with a 2 second debounce.
- Drafts store:
  - from mailbox,
  - to,
  - cc,
  - bcc,
  - subject,
  - text body,
  - HTML body,
  - attachments.
- Drafts survive refresh.
- Draft history is stored in `draft_versions`.
- Draft list supports search.
- Draft list supports checkbox selection and bulk delete.
- Personal settings include automatic draft cleanup:
  - 1 day,
  - 3 days,
  - 1 week,
  - 1 month.
- Sending a draft marks it as sent.

### Attachments

- Attachments are stored in private R2 objects.
- D1 stores only metadata and `r2_key`.
- Downloads always go through Worker authorization.
- Dangerous extensions are blocked, including `.exe`, `.bat`, `.cmd`, `.js`, `.vbs`, `.scr`.
- Single attachment size and total attachment usage are checked by the backend.
- Optional malware scan adapter can be configured with `MALWARE_SCAN_URL`.
- Attachment page supports:
  - search,
  - type filtering,
  - sorting,
  - two-column 4:3 cards,
  - created time,
  - file size,
  - download button,
  - jump to related email or draft,
  - image previews for images,
  - type icons for PDFs, documents, archives, images, and generic files.

### Gemini Agent

Agent flow:

```text
user requests AI generation
-> backend verifies JWT
-> backend calls Auth Center quota check
-> agent_jobs row is created
-> agent-generate-queue
-> Queue consumer calls Gemini API
-> actual token usage is reported to Auth Center
-> local token and agent counters are updated
-> frontend polls and displays the result
```

Supported AI actions include:

- generate email,
- draft reply,
- translate to English,
- reply email,
- polish,
- rewrite tone,
- summarize,
- generate subject,
- reply suggestions.

The frontend never calls Gemini directly. `GEMINI_API_KEY` must be configured as a Worker secret.

### User Interface

The UI is a compact SaaS-style mailbox dashboard:

- dark left sidebar,
- compact top bar,
- smaller search inputs and controls,
- light content area,
- responsive layout,
- light and dark mode,
- mailbox workbench with mailbox cards on the left and messages on the right,
- compact compose editor,
- AI assistant side panel,
- attachment card grid,
- usage explanation and trends,
- user settings page,
- admin tables and modals,
- audit log rows that wrap long content.

### Admin Features

Admin pages include:

- analysis dashboard,
- user list,
- mailbox list,
- identity/permission control,
- system settings,
- audit logs.

Admin user management:

- view users,
- search/filter users,
- freeze/restore users,
- view user statistics,
- reset daily send/receive counters,
- change a user's identity/role.

Admin identity/permission management:

- list identities,
- create custom identity,
- edit identity name, description, sort order,
- set default identity,
- configure visible/usable pages,
- configure local quotas,
- delete custom identities.

When an identity is updated, users assigned to that identity receive synchronized local quotas. When a custom identity is deleted, assigned users fall back to the default identity.

Admin system settings currently focus on landing page branding:

- upload custom landing page background image,
- set background overlay opacity with numeric input and stepper buttons,
- delete uploaded background and return to the default background.

### Usage and Quota Logic

The app uses two quota systems:

1. Auth Center controls API/Gemini token usage.
   - The app only calls Auth Center before and after Gemini Agent generation.
   - Token policy is not implemented locally.

2. Mail Agent controls local email resource limits.
   - mailbox count,
   - daily send count,
   - daily receive count,
   - attachment storage size,
   - attachment count/statistics.

Admins bypass local resource limits but their usage is still recorded and shown in analysis.

## Tech Stack

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
- Auth Center SSO and usage limit service
- `postal-mime` for queued MIME parsing
- `lucide-react` icons

## Project Structure

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

## Local Development

Install dependencies:

```bash
npm install
```

Start local development server:

```bash
npm run dev -- --host 127.0.0.1 --port 5299 --strictPort
```

Type-check and build:

```bash
npm run typecheck
npm run build
```

Preview production build:

```bash
npm run preview -- --host 127.0.0.1 --port 5300
```

## Cloudflare Resources

Current configured resources:

```text
D1 database name: mail-agent-db
D1 database id:   730603a4-3b9f-45b9-bc03-311d116f3c49
R2 bucket name:   mail-agent-save
Worker name:      mail-agent
Custom domain:    mail.112327.xyz
```

Create resources if starting from scratch:

```bash
npx wrangler d1 create mail-agent-db
npx wrangler r2 bucket create mail-agent-save
npx wrangler queues create mail-parse-queue
npx wrangler queues create mail-send-queue
npx wrangler queues create agent-generate-queue
```

Apply migrations:

```bash
npx wrangler d1 migrations apply mail-agent-db --remote --config wrangler.toml
```

## Worker Secrets

Never commit real API keys to source code, frontend code, README examples, or `wrangler.toml`.

Required secrets:

```bash
npx wrangler secret put RESEND_API_KEY
npx wrangler secret put GEMINI_API_KEY
npx wrangler secret put AUTH_APP_SECRET
```

Secret purposes:

- `RESEND_API_KEY`: used by the send Queue consumer to call Resend.
- `GEMINI_API_KEY`: used by the Agent Queue consumer to call Gemini.
- `AUTH_APP_SECRET`: app-level Auth Center secret for token usage quota check/consume.

## Wrangler Configuration

Important environment variables in `wrangler.toml`:

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

Custom domain:

```toml
routes = [
  { pattern = "mail.112327.xyz", custom_domain = true }
]
```

Bindings:

- `DB`: D1 database.
- `MAIL_BUCKET`: private R2 bucket.
- `MAIL_PARSE_QUEUE`: inbound MIME parsing queue.
- `MAIL_SEND_QUEUE`: outbound Resend queue.
- `AGENT_GENERATE_QUEUE`: Gemini Agent queue.
- `ASSETS`: React SPA assets.

## Auth Center Setup

Reserved documentation locations:

- [docs/auth-center-sso.md](docs/auth-center-sso.md)
- [docs/auth-center-usage-limit.md](docs/auth-center-usage-limit.md)

Configured app values:

```text
APP_ID=mail-agent
APP_UUID=357a4032-ce5b-49bd-8ab4-24b06d5a7e5b
CALLBACK_URL=https://mail.112327.xyz/sso-callback
```

Logout behavior:

- The app removes the local token.
- The app redirects to Auth Center logout with a redirect back to this app origin.

## Email Routing Setup

Cloudflare Dashboard setup:

1. Open Cloudflare Dashboard.
2. Enter the `112327.xyz` website.
3. Go to `Email` / `Email Routing`.
4. Enable Email Routing.
5. Confirm the MX records required by Cloudflare are present and healthy.
6. Go to `Routing rules` / `Routes`.
7. Enable or create the catch-all address.
8. Set the action to `Send to Worker`.
9. Select the `mail-agent` Worker.
10. Save.

Wrangler CLI setup:

```bash
npx wrangler email routing enable 112327.xyz
npx wrangler email routing rules update 112327.xyz catch-all --enabled true --action-type worker --action-value mail-agent
```

The current Wrangler token must include Email Routing write permission, such as `email_routing:write` / Email Routing Rules Write. If the CLI returns `Authentication error [code: 10000]`, re-run:

```bash
npx wrangler login
```

or configure the route in the Cloudflare Dashboard.

## Resend Setup

1. Verify the sending domain in Resend.
2. Create a Resend API key.
3. Store it as a Worker secret:

```bash
npx wrangler secret put RESEND_API_KEY
```

The Worker sends through Resend only from Queue consumers.

## Gemini Setup

1. Create a Gemini API key.
2. Store it as a Worker secret:

```bash
npx wrangler secret put GEMINI_API_KEY
```

Optional model configuration is controlled by:

```toml
GEMINI_MODEL = "gemini-3-flash-preview"
```

## Deployment

Build and deploy:

```bash
npm run build
npx wrangler deploy --config wrangler.toml
```

Or:

```bash
npm run deploy
```

Useful verification:

```bash
npm run typecheck
npm run build
npx wrangler d1 migrations apply mail-agent-db --remote --config wrangler.toml
npx wrangler deploy --config wrangler.toml
```

Public config check:

```bash
curl https://mail.112327.xyz/api/public-config
```

## User Guide

### Sign In

1. Open `https://mail.112327.xyz`.
2. Click `Sign in with Auth Center`.
3. Complete Auth Center login.
4. You will be redirected back to `/sso-callback`.

### Create a Mailbox

1. Open the mailbox page.
2. Click the `+` button.
3. Enter the local part, for example `shop-test`.
4. Optionally enter an alias.
5. Submit.

The resulting address is `shop-test@112327.xyz`.

### Receive Mail

1. Make sure Cloudflare Email Routing catch-all points to the Worker.
2. Send mail to a created address.
3. The inbox updates from real D1 email records.
4. Open the message to view text, sanitized HTML, status, and attachments.

### Send Mail

1. Open Compose.
2. Select a sending mailbox.
3. Enter recipients, subject, body, and attachments.
4. Click Send.
5. Check the Sent page for `pending`, `sent`, `retrying`, or `failed`.

### Use Drafts

- Compose automatically creates and saves a draft.
- Use the draft list to reopen, search, select, and bulk-delete drafts.
- Personal settings control automatic draft retention.

### Use Attachments

- Open Attachments.
- Filter by type or search filename.
- Download files through authenticated Worker requests.
- Use the jump button to open the related email or draft.

### Use Gemini Agent

1. Open Compose.
2. Enter context/instructions in the AI panel.
3. Choose the Agent command.
4. Generate.
5. Insert, replace selected text, replace body, copy, or retry.

### View Usage

The Usage page separates:

- Auth Center token usage,
- local mailbox/send/receive/attachment quotas,
- local trends.

### Personal Settings

Users can edit:

- display name,
- avatar URL,
- language,
- theme,
- draft retention period.

The Auth Center and password-change buttons link to Auth Center.

## Admin Guide

### Analysis

Shows real D1 aggregates for all users, including admins:

- tokens,
- sent count,
- received count,
- mailbox count,
- attachment usage,
- send failures,
- Agent job count,
- trend charts,
- CSV export.

### Users

Admins can:

- search/filter users,
- view usage,
- freeze/restore users,
- reset daily send/receive counters,
- change a user's identity.

The user list does not directly edit quotas. Quotas are configured in identities and applied to users through identity assignment.

### Identities and Permissions

Admins can:

- create identities,
- edit identities,
- set a default identity,
- configure page permissions,
- configure quotas,
- delete custom identities.

Deleting a custom identity moves assigned users back to the default identity.

### Mailboxes

Admins can:

- list all mailboxes,
- search by address, alias, or owner,
- filter by status,
- change mailbox status,
- view inbound/outbound counts.

### System Settings

Admins can:

- upload a custom landing page background image,
- adjust overlay opacity,
- delete the uploaded background.

### Audit Logs

Audit logs record important actions such as:

- user login,
- mailbox create/update/delete,
- email send request,
- inbound receive request,
- attachment upload/cleanup,
- Agent generation request,
- admin user status changes,
- admin identity changes,
- system background changes.

Long audit values wrap to multiple lines for readability.

## API Overview

Standard response format:

```json
{
  "ok": true,
  "data": {}
}
```

Error response format:

```json
{
  "ok": false,
  "error": {
    "code": "LIMIT_EXCEEDED",
    "message": "Mailbox limit exceeded"
  }
}
```

Public:

- `GET /api/public-config`
- `GET /api/landing-background`
- `POST /api/sso-callback`

User:

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

Admin:

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

Migration summary:

- `0001_initial.sql`: core tables and indexes.
- `0002_iteration2.sql`: aliases, read/folder fields, attachment metadata, user profile fields, draft history.
- `0003_cloud_mail_ui.sql`: starred emails, role table, app settings table, login metadata.
- `0004_compact_permissions_settings.sql`: user app identity, draft retention, landing background storage metadata.

Apply all migrations:

```bash
npx wrangler d1 migrations apply mail-agent-db --remote --config wrangler.toml
```

## Security Notes

- Backend verifies SSO token for protected APIs.
- Admin APIs require backend admin middleware.
- User-owned data is always filtered by `user_id`, except admin reads.
- `from` mailbox for sending must belong to the current user.
- Attachments are downloaded through authenticated Worker routes.
- R2 bucket must remain private.
- Resend and Gemini API keys are Worker secrets.
- The frontend does not call Resend or Gemini.
- HTML email body is sanitized and rendered in a sandboxed iframe.
- Dangerous attachment extensions are blocked.
- Header injection is cleaned from mail headers.
- Send requests and admin changes are audited.

## Known Operational Requirements

- Real receiving requires Cloudflare Email Routing catch-all to the Worker.
- Real sending requires a valid Resend API key and verified sending domain.
- Gemini Agent requires `GEMINI_API_KEY`.
- Agent token quota requires `AUTH_APP_SECRET` and Auth Center usage limit service.
- If Email Routing CLI operations fail with auth error, configure Email Routing in Dashboard or re-login with Email Routing write permission.

## Validation Record

Recent validation performed:

```bash
npm run typecheck
npm run build
npx wrangler d1 migrations apply mail-agent-db --remote --config wrangler.toml
npx wrangler deploy --config wrangler.toml
```

Latest recorded deployment in checklist:

```text
Version ID: 8446d2bd-8bd9-4383-952a-70b802c825ca
```

Full completed checklist:

- [checklists/FILLED_CHECKLIST.md](checklists/FILLED_CHECKLIST.md)
