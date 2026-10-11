import { Hono, type Context, type Next } from "hono";
import PostalMime from "postal-mime";

type Role = "admin" | "user";
type UserStatus = "active" | "frozen";
type MailboxStatus = "active" | "disabled" | "receive_only" | "send_only" | "frozen" | "deleted";
type QueueStatus = "pending" | "processing" | "succeeded" | "failed" | "retrying" | "cancelled";

interface Env {
  DB: D1Database;
  MAIL_BUCKET: R2Bucket;
  ASSETS: Fetcher;
  MAIL_PARSE_QUEUE: Queue;
  MAIL_SEND_QUEUE: Queue;
  AGENT_GENERATE_QUEUE: Queue;
  APP_ID: string;
  APP_UUID: string;
  AUTH_CENTER_URL: string;
  CALLBACK_URL: string;
  AUTH_APP_SECRET?: string;
  MAIL_DOMAIN: string;
  MALWARE_SCAN_URL?: string;
  DEFAULT_MAX_MAILBOXES: string;
  DEFAULT_MAX_SEND_PER_DAY: string;
  DEFAULT_MAX_RECEIVE_PER_DAY: string;
  DEFAULT_MAX_ATTACHMENT_TOTAL_BYTES: string;
  RESEND_API_KEY?: string;
  GEMINI_API_KEY?: string;
  GEMINI_MODEL?: string;
}

interface AppUser {
  id: string;
  username: string;
  role: Role;
  status: UserStatus;
  app_role_id?: string | null;
  app_role_key?: string;
  app_role_name?: string;
  permissions?: string[];
  draft_retention_days?: number;
  name?: string;
  avatar_url?: string;
  display_name?: string;
  language?: string;
  theme?: string;
  token: string;
}

interface QueueBody {
  kind: "mail-parse" | "mail-send" | "agent-generate";
  id: string;
}

interface MailboxRow {
  id: string;
  user_id: string;
  email: string;
  local_part: string;
  alias: string | null;
  domain: string;
  status: MailboxStatus;
  created_at: string;
  updated_at: string;
}

interface EmailRow {
  id: string;
  user_id: string;
  mailbox_id: string | null;
  direction: "inbound" | "outbound";
  from_addr: string | null;
  to_addr: string | null;
  cc: string | null;
  bcc: string | null;
  subject: string | null;
  text_body: string | null;
  html_body: string | null;
  raw_r2_key: string | null;
  status: string;
  is_read: number;
  is_starred: number;
  folder: string;
  archived_at: string | null;
  deleted_at: string | null;
  resend_id: string | null;
  error: string | null;
  retry_count: number;
  created_at: string;
  updated_at: string;
}

interface RoleRow {
  id: string;
  role_key: string;
  name: string;
  description: string | null;
  sort_order: number;
  is_default: number;
  is_system: number;
  permissions: string;
  limits_json: string | null;
  created_at: string;
  updated_at: string;
}

interface EffectiveRole {
  id: string | null;
  role_key: string;
  name: string;
  permissions: string[];
  limits: Record<string, number | boolean>;
}

interface DraftRow {
  id: string;
  user_id: string;
  mailbox_id: string | null;
  to_addr: string | null;
  cc: string | null;
  bcc: string | null;
  subject: string | null;
  text_body: string | null;
  html_body: string | null;
  status: string;
  created_at: string;
  updated_at: string;
}

interface AgentJobRow {
  id: string;
  user_id: string;
  draft_id: string | null;
  command: string;
  input: string | null;
  output: string | null;
  model: string | null;
  estimated_tokens: number | null;
  actual_tokens: number | null;
  quota_reported: number;
  status: QueueStatus;
  error: string | null;
  retry_count: number;
  created_at: string;
  updated_at: string;
}

const app = new Hono<{ Bindings: Env; Variables: { user: AppUser } }>();
type AppContext = Context<{ Bindings: Env; Variables: { user: AppUser } }>;
const DOMAIN = "112327.xyz";
const RESERVED_LOCAL_PARTS = new Set(["admin", "root", "postmaster", "abuse", "support", "security", "noreply", "no-reply"]);
const DANGEROUS_EXTENSIONS = new Set(["exe", "bat", "cmd", "js", "vbs", "scr"]);
const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;
const MAX_RECIPIENTS = 20;
const LIST_LIMIT = 100;

const ok = (data: unknown = {}) => Response.json({ ok: true, data });
const fail = (code: string, message: string, status = 400) => Response.json({ ok: false, error: { code, message } }, { status });
const now = () => new Date().toISOString();
const id = (prefix: string) => `${prefix}_${crypto.randomUUID().replace(/-/g, "")}`;
const dayStart = () => {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d.toISOString();
};
const dayEnd = () => {
  const d = new Date();
  d.setUTCHours(23, 59, 59, 999);
  return d.toISOString();
};

function getToken(req: Request): string | null {
  const auth = req.headers.get("Authorization");
  if (auth?.startsWith("Bearer ")) return auth.slice(7).trim();
  const cookie = req.headers.get("Cookie") || "";
  const match = cookie.match(/(?:^|;\s*)(?:sso_token|app_session)=([^;]+)/);
  return match ? decodeURIComponent(match[1]) : null;
}

function decodeJwtPayload(token: string): Record<string, unknown> {
  const part = token.split(".")[1];
  if (!part) return {};
  const base64 = part.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), "=");
  try {
    return JSON.parse(atob(padded));
  } catch {
    return {};
  }
}

async function first<T>(stmt: D1PreparedStatement): Promise<T | null> {
  return (await stmt.first<T>()) || null;
}

async function all<T>(stmt: D1PreparedStatement): Promise<T[]> {
  const result = await stmt.all<T>();
  return result.results || [];
}

async function verifyToken(env: Env, token: string): Promise<AppUser | Response> {
  const payload = decodeJwtPayload(token);
  const exp = Number(payload.exp || 0);
  if (exp && exp * 1000 < Date.now()) return fail("AUTH_EXPIRED", "Login expired", 401);

  let verifyUser: Record<string, unknown> = {};
  try {
    const res = await fetch(`${env.AUTH_CENTER_URL}/api/verify?app_id=${encodeURIComponent(env.APP_ID)}`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(7000)
    });
    if (!res.ok) return fail(res.status === 403 ? "AUTH_FORBIDDEN" : "AUTH_INVALID", "SSO verification failed", res.status === 403 ? 403 : 401);
    const json = (await res.json()) as Record<string, unknown>;
    verifyUser = (json.user || json.data || json) as Record<string, unknown>;
  } catch {
    return fail("AUTH_UNAVAILABLE", "Auth center is unavailable", 503);
  }

  const uuid = String(verifyUser.uuid || payload.uuid || verifyUser.id || payload.sub || "");
  const username = String(verifyUser.username || payload.username || verifyUser.name || "");
  if (!uuid || !username) return fail("AUTH_INVALID", "Token does not contain a valid user", 401);

  const ts = now();
  const existing = await first<AppUser>(
    env.DB.prepare("SELECT id, username, role, status, app_role_id, draft_retention_days, name, avatar_url, display_name, language, theme FROM users WHERE id = ? OR username = ?").bind(uuid, username)
  );
  const jwtRole = String(verifyUser.role || payload.role || "");
  const role: Role = existing?.role || (jwtRole === "admin" ? "admin" : username === "admin" ? "admin" : "user");
  const status: UserStatus = existing?.status || "active";
  const name = String(verifyUser.name || payload.name || username);
  const avatar = String(verifyUser.avatar_url || payload.avatar_url || "");

  await env.DB.prepare(
    "INSERT INTO users (id, username, role, status, name, avatar_url, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?) " +
      "ON CONFLICT(id) DO UPDATE SET username = excluded.username, name = excluded.name, avatar_url = excluded.avatar_url, updated_at = excluded.updated_at"
  )
    .bind(uuid, username, role, status, name, avatar || null, ts, ts)
    .run();

  if (status === "frozen") return fail("USER_FROZEN", "User is frozen", 403);
  const effective = await getEffectiveRole(env, { id: uuid, role, app_role_id: existing?.app_role_id || null });
  return {
    id: uuid,
    username,
    role,
    status,
    app_role_id: effective.id,
    app_role_key: effective.role_key,
    app_role_name: effective.name,
    permissions: effective.permissions,
    draft_retention_days: existing?.draft_retention_days || 7,
    name,
    avatar_url: avatar,
    display_name: existing?.display_name || name,
    language: "en",
    theme: existing?.theme || "system",
    token
  };
}

async function requireAuth(c: AppContext, next: Next) {
  const token = getToken(c.req.raw);
  if (!token) return fail("AUTH_REQUIRED", "Login required", 401);
  const verified = await verifyToken(c.env, token);
  if (verified instanceof Response) return verified;
  c.set("user", verified);
  await next();
}

async function requireAdmin(c: AppContext, next: Next) {
  const user = c.get("user");
  if (user.role !== "admin") return fail("ADMIN_REQUIRED", "Admin permission required", 403);
  await next();
}

function parseCsvAddresses(value: string | null | undefined): string[] {
  if (!value) return [];
  return value
    .split(/[,\n;]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function validateAddressList(value: string | null | undefined): string | null {
  const recipients = parseCsvAddresses(value);
  if (recipients.length > MAX_RECIPIENTS) return "Too many recipients";
  const emailRe = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;
  for (const addr of recipients) {
    if (!emailRe.test(addr)) return `Invalid email address: ${addr}`;
    if (/[\r\n]/.test(addr)) return "Header injection is not allowed";
  }
  return null;
}

function cleanHeader(value: unknown): string | null {
  if (value == null) return null;
  return String(value).replace(/[\r\n]+/g, " ").trim().slice(0, 500);
}

function sanitizeFilename(filename: string): string {
  const cleaned = filename
    .normalize("NFKD")
    .replace(/[^\w.\- ]+/g, "_")
    .replace(/\s+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^\.*/, "")
    .slice(0, 120);
  return cleaned || "attachment.bin";
}

function hasDangerousExtension(filename: string): boolean {
  const ext = filename.split(".").pop()?.toLowerCase() || "";
  return DANGEROUS_EXTENSIONS.has(ext);
}

function sanitizeHtml(html: string | null): string | null {
  if (!html) return null;
  let safe = html.replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, "");
  safe = safe.replace(/\son\w+="[^"]*"/gi, "").replace(/\son\w+='[^']*'/gi, "");
  safe = safe.replace(/href\s*=\s*["']javascript:[^"']*["']/gi, 'href="#"');
  safe = safe.replace(/src\s*=\s*["']javascript:[^"']*["']/gi, 'src=""');
  safe = safe.replace(/<iframe[\s\S]*?>[\s\S]*?<\/iframe>/gi, "");
  return safe;
}

function normalizeSort(value: string | null, allowed: Record<string, string>, fallback: string) {
  return allowed[value || ""] || fallback;
}

function like(input: string) {
  return `%${input.trim().replace(/[%_]/g, "\\$&")}%`;
}

function safeJson<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function cleanRoleKey(value: unknown) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

function parsePermissions(value: unknown): string[] {
  const raw = Array.isArray(value) ? value : typeof value === "string" ? safeJson<string[]>(value, []) : [];
  return Array.from(new Set(raw.map((item) => String(item).trim()).filter(Boolean))).slice(0, 80);
}

function normalizeSettingValue(value: unknown, type: string) {
  if (type === "boolean") return value === true || value === "true" || value === 1 || value === "1" ? "true" : "false";
  if (type === "number") return String(Math.max(0, Math.min(1, Number(value || 0))));
  return cleanHeader(value) || "";
}

function coerceSettingValue(value: string | null, type: string) {
  if (type === "boolean") return value === "true";
  if (type === "number") return Number(value || 0);
  return value || "";
}

async function ensureDefaultRoles(env: Env) {
  const count = await first<{ count: number }>(env.DB.prepare("SELECT COUNT(*) AS count FROM roles"));
  if (count?.count) return;
  const ts = now();
  const permissions = {
    admin: ["dashboard", "mailboxes", "emails", "attachments", "users", "roles", "settings", "analysis", "audit"],
    user: ["mailboxes", "emails", "drafts", "attachments", "usage", "settings"],
    readonly: ["mailboxes", "emails", "attachments", "usage"]
  };
  await env.DB.batch([
    env.DB.prepare("INSERT INTO roles (id, role_key, name, description, sort_order, is_default, is_system, permissions, limits_json, created_at, updated_at) VALUES (?, 'admin', 'Administrator', 'Full administrative access', 1, 0, 1, ?, ?, ?, ?)")
      .bind(id("role"), JSON.stringify([...permissions.admin, "system"]), JSON.stringify({ unlimited: true }), ts, ts),
    env.DB.prepare("INSERT INTO roles (id, role_key, name, description, sort_order, is_default, is_system, permissions, limits_json, created_at, updated_at) VALUES (?, 'user', 'User', 'Default temporary mailbox access', 2, 1, 1, ?, ?, ?, ?)")
      .bind(id("role"), JSON.stringify(permissions.user), JSON.stringify({ max_mailboxes: Number(env.DEFAULT_MAX_MAILBOXES || 5), max_send_per_day: Number(env.DEFAULT_MAX_SEND_PER_DAY || 50), max_receive_per_day: Number(env.DEFAULT_MAX_RECEIVE_PER_DAY || 200), max_attachment_total_mb: Math.round(Number(env.DEFAULT_MAX_ATTACHMENT_TOTAL_BYTES || 104857600) / 1024 / 1024) }), ts, ts),
    env.DB.prepare("INSERT INTO roles (id, role_key, name, description, sort_order, is_default, is_system, permissions, limits_json, created_at, updated_at) VALUES (?, 'readonly', 'Read only', 'View mail and attachments only', 3, 0, 1, ?, ?, ?, ?)")
      .bind(id("role"), JSON.stringify(permissions.readonly), JSON.stringify({ max_mailboxes: 1, max_send_per_day: 0, max_receive_per_day: 50, max_attachment_total_mb: 50 }), ts, ts)
  ]);
}

async function getDefaultRole(env: Env) {
  await ensureDefaultRoles(env);
  return first<RoleRow>(env.DB.prepare("SELECT * FROM roles WHERE is_default = 1 ORDER BY sort_order ASC LIMIT 1"));
}

async function getEffectiveRole(env: Env, user: { id: string; role: Role; app_role_id?: string | null }): Promise<EffectiveRole> {
  await ensureDefaultRoles(env);
  let role = user.app_role_id ? await first<RoleRow>(env.DB.prepare("SELECT * FROM roles WHERE id = ?").bind(user.app_role_id)) : null;
  if (!role && user.role === "admin") role = await first<RoleRow>(env.DB.prepare("SELECT * FROM roles WHERE role_key = 'admin' LIMIT 1"));
  if (!role) role = await getDefaultRole(env);
  if (!role) {
    return {
      id: null,
      role_key: user.role === "admin" ? "admin" : "user",
      name: user.role === "admin" ? "Administrator" : "User",
      permissions: user.role === "admin" ? ["mailboxes", "emails", "drafts", "attachments", "usage", "settings", "users", "roles", "system", "analysis", "audit"] : ["mailboxes", "emails", "drafts", "attachments", "usage", "settings"],
      limits: {}
    };
  }
  return {
    id: role.id,
    role_key: role.role_key,
    name: role.name,
    permissions: parsePermissions(role.permissions),
    limits: safeJson<Record<string, number | boolean>>(role.limits_json, {})
  };
}

async function syncRoleLimitsToUsers(env: Env, roleId: string, limits: Record<string, number | boolean>) {
  if (limits.unlimited) return;
  const users = await all<{ id: string }>(env.DB.prepare("SELECT id FROM users WHERE app_role_id = ?").bind(roleId));
  for (const user of users) {
    await env.DB.prepare(
      "INSERT INTO usage_limits (user_id, max_mailboxes, max_send_per_day, max_receive_per_day, max_attachment_total_bytes, updated_at) VALUES (?, ?, ?, ?, ?, ?) " +
        "ON CONFLICT(user_id) DO UPDATE SET max_mailboxes = excluded.max_mailboxes, max_send_per_day = excluded.max_send_per_day, max_receive_per_day = excluded.max_receive_per_day, max_attachment_total_bytes = excluded.max_attachment_total_bytes, updated_at = excluded.updated_at"
    )
      .bind(
        user.id,
        Number(limits.max_mailboxes ?? 5),
        Number(limits.max_send_per_day ?? 50),
        Number(limits.max_receive_per_day ?? 200),
        Number(limits.max_attachment_total_mb ?? 100) * 1024 * 1024,
        now()
      )
      .run();
  }
}

async function applyRoleToUser(env: Env, userId: string, roleId: string | null) {
  const role = roleId ? await first<RoleRow>(env.DB.prepare("SELECT * FROM roles WHERE id = ?").bind(roleId)) : await getDefaultRole(env);
  if (!role) return;
  const limits = safeJson<Record<string, number | boolean>>(role.limits_json, {});
  await env.DB.prepare("UPDATE users SET app_role_id = ?, updated_at = ? WHERE id = ?").bind(role.id, now(), userId).run();
  if (!limits.unlimited) {
    await env.DB.prepare(
      "INSERT INTO usage_limits (user_id, max_mailboxes, max_send_per_day, max_receive_per_day, max_attachment_total_bytes, updated_at) VALUES (?, ?, ?, ?, ?, ?) " +
        "ON CONFLICT(user_id) DO UPDATE SET max_mailboxes = excluded.max_mailboxes, max_send_per_day = excluded.max_send_per_day, max_receive_per_day = excluded.max_receive_per_day, max_attachment_total_bytes = excluded.max_attachment_total_bytes, updated_at = excluded.updated_at"
    )
      .bind(
        userId,
        Number(limits.max_mailboxes ?? 5),
        Number(limits.max_send_per_day ?? 50),
        Number(limits.max_receive_per_day ?? 200),
        Number(limits.max_attachment_total_mb ?? 100) * 1024 * 1024,
        now()
      )
      .run();
  }
}

async function ensureDefaultSettings(env: Env) {
  const count = await first<{ count: number }>(env.DB.prepare("SELECT COUNT(*) AS count FROM app_settings"));
  if (count?.count) return;
  const ts = now();
  const defaults: Array<[string, string, string]> = [
    ["site_name", "Cloud Mail", "string"],
    ["landing_background_opacity", "0.18", "number"],
    ["landing_background", "", "image"]
  ];
  await env.DB.batch(defaults.map(([key, value, type]) =>
    env.DB.prepare("INSERT INTO app_settings (key, value, type, updated_at) VALUES (?, ?, ?, ?)").bind(key, value, type, ts)
  ));
}

function parseDateParam(value: string | null) {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function fileType(filename: string, contentType = "") {
  const ext = filename.split(".").pop()?.toLowerCase() || "";
  if (contentType.startsWith("image/") || ["png", "jpg", "jpeg", "gif", "webp", "avif"].includes(ext)) return "image";
  if (contentType === "application/pdf" || ext === "pdf") return "pdf";
  if (["zip", "rar", "7z", "gz", "tar"].includes(ext)) return "archive";
  if (["doc", "docx", "txt", "md", "rtf"].includes(ext)) return "document";
  return "file";
}

async function scanAttachment(env: Env, file: File | { name: string; contentType?: string; size: number; bytes?: ArrayBuffer }) {
  const filename = sanitizeFilename(file.name);
  if (hasDangerousExtension(filename)) throw new Error("This file type is not allowed");
  const contentType = file instanceof File ? file.type : file.contentType || "";
  if (!contentType || contentType === "application/x-msdownload") throw new Error("Attachment MIME type is not allowed");
  if (!env.MALWARE_SCAN_URL) return { status: "passed", error: null };
  const bytes = file instanceof File ? await file.arrayBuffer() : file.bytes;
  if (!bytes) return { status: "passed", error: null };
  const res = await fetch(env.MALWARE_SCAN_URL, {
    method: "POST",
    headers: {
      "Content-Type": contentType,
      "X-Filename": filename
    },
    body: bytes,
    signal: AbortSignal.timeout(10000)
  });
  if (!res.ok) throw new Error(`Attachment scan failed: ${res.status}`);
  const data = (await res.json().catch(() => ({}))) as { clean?: boolean; status?: string; error?: string };
  if (data.clean === false || data.status === "infected") throw new Error(data.error || "Attachment failed malware scan");
  return { status: data.status || "passed", error: null };
}

function validateLocalPart(input: string): string | null {
  const local = input.toLowerCase();
  if (local.length < 3 || local.length > 64) return "Local part must be 3-64 characters";
  if (!/^[a-z0-9._-]+$/.test(local)) return "Only a-z, 0-9, dot, dash and underscore are allowed";
  if (local.startsWith(".") || local.endsWith(".")) return "Local part cannot start or end with dot";
  if (local.includes("..")) return "Consecutive dots are not allowed";
  if (RESERVED_LOCAL_PARTS.has(local)) return "This local part is reserved";
  return null;
}

async function audit(env: Env, user: AppUser | null, action: string, targetType?: string, targetId?: string, metadata?: unknown) {
  await env.DB.prepare(
    "INSERT INTO audit_logs (id, actor_user_id, actor_username, action, target_type, target_id, metadata, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
  )
    .bind(id("audit"), user?.id || null, user?.username || null, action, targetType || null, targetId || null, metadata ? JSON.stringify(metadata) : null, now())
    .run();
}

async function incrementCounter(env: Env, userId: string, type: string, count = 1, bytes = 0) {
  const start = dayStart();
  const end = dayEnd();
  await env.DB.prepare(
    "INSERT INTO usage_counters (id, user_id, type, count, bytes, period_start, period_end, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?) " +
      "ON CONFLICT(user_id, type, period_start, period_end) DO UPDATE SET count = count + excluded.count, bytes = bytes + excluded.bytes, updated_at = excluded.updated_at"
  )
    .bind(id("usage"), userId, type, count, bytes, start, end, now())
    .run();
}

async function getLimits(env: Env, userId: string) {
  const custom = await first<{
    max_mailboxes: number | null;
    max_send_per_day: number | null;
    max_receive_per_day: number | null;
    max_attachment_total_bytes: number | null;
  }>(env.DB.prepare("SELECT max_mailboxes, max_send_per_day, max_receive_per_day, max_attachment_total_bytes FROM usage_limits WHERE user_id = ?").bind(userId));
  if (!custom) {
    const user = await first<{ id: string; role: Role; app_role_id: string | null }>(env.DB.prepare("SELECT id, role, app_role_id FROM users WHERE id = ?").bind(userId));
    if (user) {
      const effective = await getEffectiveRole(env, user);
      if (!effective.limits.unlimited) {
        return {
          max_mailboxes: Number(effective.limits.max_mailboxes ?? env.DEFAULT_MAX_MAILBOXES ?? 5),
          max_send_per_day: Number(effective.limits.max_send_per_day ?? env.DEFAULT_MAX_SEND_PER_DAY ?? 50),
          max_receive_per_day: Number(effective.limits.max_receive_per_day ?? env.DEFAULT_MAX_RECEIVE_PER_DAY ?? 200),
          max_attachment_total_bytes: Number(effective.limits.max_attachment_total_mb ?? 100) * 1024 * 1024
        };
      }
    }
  }
  return {
    max_mailboxes: custom?.max_mailboxes ?? Number(env.DEFAULT_MAX_MAILBOXES || 5),
    max_send_per_day: custom?.max_send_per_day ?? Number(env.DEFAULT_MAX_SEND_PER_DAY || 50),
    max_receive_per_day: custom?.max_receive_per_day ?? Number(env.DEFAULT_MAX_RECEIVE_PER_DAY || 200),
    max_attachment_total_bytes: custom?.max_attachment_total_bytes ?? Number(env.DEFAULT_MAX_ATTACHMENT_TOTAL_BYTES || 104857600)
  };
}

async function getCounter(env: Env, userId: string, type: string) {
  const row = await first<{ count: number; bytes: number }>(
    env.DB.prepare("SELECT count, bytes FROM usage_counters WHERE user_id = ? AND type = ? AND period_start = ? AND period_end = ?").bind(userId, type, dayStart(), dayEnd())
  );
  return row || { count: 0, bytes: 0 };
}

async function totalAttachmentBytes(env: Env, userId: string) {
  const row = await first<{ total: number }>(env.DB.prepare("SELECT COALESCE(SUM(size_bytes), 0) AS total FROM attachments WHERE user_id = ?").bind(userId));
  return row?.total || 0;
}

async function cleanupExpiredDrafts(env: Env, user: AppUser) {
  const days = Math.max(1, Math.min(Number(user.draft_retention_days || 7), 365));
  const cutoff = new Date(Date.now() - days * 86400000).toISOString();
  const rows = await all<{ id: string }>(env.DB.prepare("SELECT id FROM drafts WHERE user_id = ? AND status = 'draft' AND updated_at < ?").bind(user.id, cutoff));
  for (const draft of rows) {
    const attachments = await all<{ r2_key: string }>(env.DB.prepare("SELECT r2_key FROM attachments WHERE draft_id = ? AND user_id = ?").bind(draft.id, user.id));
    for (const att of attachments) await env.MAIL_BUCKET.delete(att.r2_key);
    await env.DB.prepare("DELETE FROM attachments WHERE draft_id = ? AND user_id = ?").bind(draft.id, user.id).run();
    await env.DB.prepare("DELETE FROM drafts WHERE id = ? AND user_id = ?").bind(draft.id, user.id).run();
  }
}

async function enforceMailboxLimit(env: Env, user: AppUser) {
  if (user.role === "admin") return null;
  const limits = await getLimits(env, user.id);
  const row = await first<{ count: number }>(
    env.DB.prepare("SELECT COUNT(*) AS count FROM mailboxes WHERE user_id = ? AND status != 'deleted'").bind(user.id)
  );
  if ((row?.count || 0) >= limits.max_mailboxes) return fail("LIMIT_EXCEEDED", "Mailbox limit exceeded", 403);
  return null;
}

async function enforceDailyLimit(env: Env, user: AppUser, type: "send" | "receive") {
  if (user.role === "admin") return null;
  const limits = await getLimits(env, user.id);
  const counter = await getCounter(env, user.id, type);
  const max = type === "send" ? limits.max_send_per_day : limits.max_receive_per_day;
  if (counter.count >= max) return fail("LIMIT_EXCEEDED", `${type} limit exceeded`, 403);
  return null;
}

async function enforceAttachmentLimit(env: Env, user: AppUser, additionalBytes: number) {
  if (additionalBytes > MAX_ATTACHMENT_BYTES) return fail("ATTACHMENT_TOO_LARGE", "Single attachment is too large", 413);
  if (user.role === "admin") return null;
  const limits = await getLimits(env, user.id);
  const used = await totalAttachmentBytes(env, user.id);
  if (used + additionalBytes > limits.max_attachment_total_bytes) return fail("LIMIT_EXCEEDED", "Attachment storage limit exceeded", 403);
  return null;
}

async function getMailboxForSend(env: Env, user: AppUser, mailboxId: string) {
  const mailbox = await first<MailboxRow>(env.DB.prepare("SELECT * FROM mailboxes WHERE id = ? AND user_id = ?").bind(mailboxId, user.id));
  if (!mailbox) return { error: fail("MAILBOX_NOT_FOUND", "Mailbox not found", 404) };
  if (!["active", "send_only"].includes(mailbox.status)) return { error: fail("MAILBOX_NOT_SENDABLE", "Mailbox does not allow sending", 403) };
  return { mailbox };
}

async function checkQuota(env: Env, userId: string) {
  if (!env.AUTH_APP_SECRET) throw new Error("AUTH_APP_SECRET is not configured");
  const res = await fetch(`${env.AUTH_CENTER_URL}/api/quota/check?uuid=${encodeURIComponent(userId)}&app_id=${encodeURIComponent(env.APP_ID)}`, {
    headers: { Authorization: `Bearer ${env.AUTH_APP_SECRET}` },
    signal: AbortSignal.timeout(7000)
  });
  if (!res.ok) {
    const message = await res.text();
    throw new Error(message || `Quota check failed: ${res.status}`);
  }
}

async function consumeQuota(env: Env, userId: string, tokens: number) {
  if (!env.AUTH_APP_SECRET || tokens <= 0) return;
  const res = await fetch(`${env.AUTH_CENTER_URL}/api/quota/consume`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.AUTH_APP_SECRET}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ uuid: userId, app_id: env.APP_ID, tokens }),
    signal: AbortSignal.timeout(7000)
  });
  if (!res.ok) throw new Error(await res.text());
}

app.post("/api/sso-callback", async (c) => {
  let token = "";
  try {
    const body = await c.req.json<{ token?: string }>();
    token = body.token || "";
  } catch {
    return fail("BAD_REQUEST", "Invalid request body", 400);
  }
  if (!token) return fail("AUTH_REQUIRED", "Token required", 400);
  const verified = await verifyToken(c.env, token);
  if (verified instanceof Response) return verified;
  await c.env.DB.prepare("UPDATE users SET last_login_at = ?, last_login_ip = ?, last_login_user_agent = ?, updated_at = ? WHERE id = ?")
    .bind(now(), c.req.header("CF-Connecting-IP") || null, c.req.header("User-Agent") || null, now(), verified.id)
    .run();
  await audit(c.env, verified, "user.login", "user", verified.id);
  return ok({ user: verified, token });
});

app.get("/api/public-config", async (c) => {
  await ensureDefaultSettings(c.env);
  const opacity = await first<{ value: string | null }>(c.env.DB.prepare("SELECT value FROM app_settings WHERE key = 'landing_background_opacity'"));
  const bg = await first<{ r2_key: string | null }>(c.env.DB.prepare("SELECT r2_key FROM app_settings WHERE key = 'landing_background'"));
  return ok({
    app_id: c.env.APP_ID,
    app_uuid: c.env.APP_UUID,
    auth_center_url: c.env.AUTH_CENTER_URL,
    callback_url: c.env.CALLBACK_URL,
    landing_background_url: bg?.r2_key ? "/api/landing-background" : "",
    landing_background_opacity: Math.max(0, Math.min(Number(opacity?.value || 0.18), 1))
  });
});

app.get("/api/landing-background", async (c) => {
  await ensureDefaultSettings(c.env);
  const row = await first<{ value: string | null; r2_key: string | null }>(c.env.DB.prepare("SELECT value, r2_key FROM app_settings WHERE key = 'landing_background'"));
  if (!row?.r2_key) return fail("BACKGROUND_NOT_FOUND", "No custom landing background", 404);
  const object = await c.env.MAIL_BUCKET.get(row.r2_key);
  if (!object) return fail("BACKGROUND_NOT_FOUND", "Background object missing", 404);
  return new Response(object.body, { headers: { "Content-Type": row.value || object.httpMetadata?.contentType || "image/jpeg", "Cache-Control": "public, max-age=300" } });
});

app.use("/api/*", requireAuth);

app.get("/api/me", async (c) => ok({ user: c.get("user") }));

app.get("/api/limits", async (c) => ok(await getLimits(c.env, c.get("user").id)));

app.get("/api/usage", async (c) => {
  const user = c.get("user");
  const [limits, send, receive, tokens, attachmentBytes, mailboxes] = await Promise.all([
    getLimits(c.env, user.id),
    getCounter(c.env, user.id, "send"),
    getCounter(c.env, user.id, "receive"),
    getCounter(c.env, user.id, "tokens"),
    totalAttachmentBytes(c.env, user.id),
    first<{ count: number }>(c.env.DB.prepare("SELECT COUNT(*) AS count FROM mailboxes WHERE user_id = ? AND status != 'deleted'").bind(user.id))
  ]);
  return ok({ limits, usage: { send, receive, tokens, attachment_bytes: attachmentBytes, mailboxes: mailboxes?.count || 0 } });
});

app.get("/api/mailboxes", async (c) => {
  const user = c.get("user");
  const q = c.req.query("q") || "";
  const sort = normalizeSort(c.req.query("sort") || "created_desc", {
    local_part: "local_part ASC",
    created_asc: "created_at ASC",
    created_desc: "created_at DESC",
    status: "status ASC, created_at DESC"
  }, "created_at DESC");
  const clauses = ["user_id = ?", "status != 'deleted'"];
  const binds: unknown[] = [user.id];
  if (q.trim()) {
    clauses.push("(local_part LIKE ? ESCAPE '\\' OR email LIKE ? ESCAPE '\\' OR COALESCE(alias, '') LIKE ? ESCAPE '\\')");
    binds.push(like(q), like(q), like(q));
  }
  return ok(await all(c.env.DB.prepare(
    `SELECT m.*,
      (SELECT COUNT(*) FROM emails e WHERE e.mailbox_id = m.id AND e.direction = 'inbound') AS inbound_count,
      (SELECT COUNT(*) FROM emails e WHERE e.mailbox_id = m.id AND e.direction = 'outbound') AS outbound_count,
      (SELECT COALESCE(SUM(a.size_bytes),0) FROM attachments a JOIN emails e ON e.id = a.email_id WHERE e.mailbox_id = m.id) AS attachment_bytes
     FROM mailboxes m
     WHERE ${clauses.map((clause) => clause.replace(/^user_id/, "m.user_id").replace(/^status/, "m.status")).join(" AND ")}
     ORDER BY ${sort.replace(/\b(local_part|created_at|status)\b/g, "m.$1")}
     LIMIT ${LIST_LIMIT}`
  ).bind(...binds)));
});

app.post("/api/mailboxes", async (c) => {
  const user = c.get("user");
  const limited = await enforceMailboxLimit(c.env, user);
  if (limited) return limited;
  const body = (await c.req.json<{ local_part?: string; alias?: string }>().catch(() => ({}))) as { local_part?: string; alias?: string };
  const local = String(body.local_part || "").toLowerCase().trim();
  const validation = validateLocalPart(local);
  if (validation) return fail("INVALID_LOCAL_PART", validation, 400);
  const ts = now();
  const mailboxId = id("mbx");
  const email = `${local}@${c.env.MAIL_DOMAIN || DOMAIN}`;
  try {
    await c.env.DB.prepare("INSERT INTO mailboxes (id, user_id, email, local_part, alias, domain, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?)")
      .bind(mailboxId, user.id, email, local, cleanHeader(body.alias) || null, c.env.MAIL_DOMAIN || DOMAIN, ts, ts)
      .run();
    await audit(c.env, user, "mailbox.create", "mailbox", mailboxId, { email });
    return ok({ id: mailboxId, email, local_part: local, status: "active" });
  } catch {
    return fail("MAILBOX_EXISTS", "Mailbox already exists", 409);
  }
});

app.patch("/api/mailboxes/:id", async (c) => {
  const user = c.get("user");
  const mailboxId = c.req.param("id");
  const body = (await c.req.json<{ status?: MailboxStatus; alias?: string }>().catch(() => ({}))) as { status?: MailboxStatus; alias?: string };
  const allowed: MailboxStatus[] = ["active", "disabled", "receive_only", "send_only", "frozen"];
  if (body.status && !allowed.includes(body.status)) return fail("INVALID_STATUS", "Invalid mailbox status", 400);
  const result = await c.env.DB.prepare("UPDATE mailboxes SET status = COALESCE(?, status), alias = COALESCE(?, alias), updated_at = ? WHERE id = ? AND user_id = ?")
    .bind(body.status || null, body.alias == null ? null : cleanHeader(body.alias), now(), mailboxId, user.id)
    .run();
  if (!result.meta.changes) return fail("MAILBOX_NOT_FOUND", "Mailbox not found", 404);
  await audit(c.env, user, "mailbox.update", "mailbox", mailboxId, { status: body.status, alias: body.alias });
  return ok({ id: mailboxId, status: body.status, alias: body.alias });
});

app.delete("/api/mailboxes/:id", async (c) => {
  const user = c.get("user");
  const mailboxId = c.req.param("id");
  const result = await c.env.DB.prepare("UPDATE mailboxes SET status = 'deleted', updated_at = ? WHERE id = ? AND user_id = ?")
    .bind(now(), mailboxId, user.id)
    .run();
  if (!result.meta.changes) return fail("MAILBOX_NOT_FOUND", "Mailbox not found", 404);
  await audit(c.env, user, "mailbox.delete", "mailbox", mailboxId);
  return ok({ id: mailboxId });
});

app.get("/api/emails", async (c) => {
  const user = c.get("user");
  const direction = c.req.query("direction");
  const mailboxId = c.req.query("mailbox_id");
  const q = c.req.query("q") || "";
  const read = c.req.query("read");
  const hasAttachment = c.req.query("has_attachment");
  const folder = c.req.query("folder");
  const starred = c.req.query("starred");
  const from = parseDateParam(c.req.query("from") || null);
  const to = parseDateParam(c.req.query("to") || null);
  const clauses = ["e.user_id = ?", "e.folder != 'trash'"];
  const binds: unknown[] = [user.id];
  if (direction === "inbound" || direction === "outbound") {
    clauses.push("e.direction = ?");
    binds.push(direction);
  }
  if (folder && ["mail", "archive", "trash"].includes(folder)) {
    clauses[1] = "e.folder = ?";
    binds.push(folder);
  }
  if (read === "read" || read === "unread") {
    clauses.push("e.is_read = ?");
    binds.push(read === "read" ? 1 : 0);
  }
  if (hasAttachment === "1") clauses.push("EXISTS (SELECT 1 FROM attachments a WHERE a.email_id = e.id)");
  if (starred === "1") clauses.push("e.is_starred = 1");
  if (from) {
    clauses.push("e.created_at >= ?");
    binds.push(from);
  }
  if (to) {
    clauses.push("e.created_at <= ?");
    binds.push(to);
  }
  if (q.trim()) {
    clauses.push("(COALESCE(e.subject,'') LIKE ? ESCAPE '\\' OR COALESCE(e.from_addr,'') LIKE ? ESCAPE '\\' OR COALESCE(e.to_addr,'') LIKE ? ESCAPE '\\' OR COALESCE(e.text_body,'') LIKE ? ESCAPE '\\')");
    binds.push(like(q), like(q), like(q), like(q));
  }
  if (mailboxId) {
    clauses.push("e.mailbox_id = ?");
    binds.push(mailboxId);
  }
  const rows = await all(
    c.env.DB.prepare(
      `SELECT e.*, (SELECT COUNT(*) FROM attachments a WHERE a.email_id = e.id) AS attachment_count FROM emails e WHERE ${clauses.join(" AND ")} ORDER BY e.created_at DESC LIMIT ${LIST_LIMIT}`
    ).bind(...binds)
  );
  return ok(rows);
});

app.patch("/api/emails/:id/star", async (c) => {
  const user = c.get("user");
  const body = (await c.req.json<{ starred?: boolean }>().catch(() => ({}))) as { starred?: boolean };
  const emailId = c.req.param("id");
  const result = await c.env.DB.prepare("UPDATE emails SET is_starred = ?, updated_at = ? WHERE id = ? AND (? = 'admin' OR user_id = ?)")
    .bind(body.starred ? 1 : 0, now(), emailId, user.role, user.id)
    .run();
  if (!result.meta.changes) return fail("EMAIL_NOT_FOUND", "Email not found", 404);
  await audit(c.env, user, body.starred ? "email.star" : "email.unstar", "email", emailId);
  return ok({ id: emailId, is_starred: body.starred ? 1 : 0 });
});

app.patch("/api/emails/bulk", async (c) => {
  const user = c.get("user");
  const body = (await c.req.json<{ ids?: string[]; action?: string }>().catch(() => ({}))) as { ids?: string[]; action?: string };
  const ids = (body.ids || []).filter(Boolean).slice(0, 100);
  if (!ids.length) return fail("EMAIL_IDS_REQUIRED", "Select at least one email", 400);
  const placeholders = ids.map(() => "?").join(",");
  let sql = "";
  const ts = now();
  if (body.action === "mark_read") sql = "UPDATE emails SET is_read = 1, updated_at = ? WHERE user_id = ? AND id IN (" + placeholders + ")";
  if (body.action === "mark_unread") sql = "UPDATE emails SET is_read = 0, updated_at = ? WHERE user_id = ? AND id IN (" + placeholders + ")";
  if (body.action === "archive") sql = "UPDATE emails SET folder = 'archive', archived_at = ?, updated_at = ? WHERE user_id = ? AND id IN (" + placeholders + ")";
  if (body.action === "trash" || body.action === "delete") sql = "UPDATE emails SET folder = 'trash', deleted_at = ?, updated_at = ? WHERE user_id = ? AND id IN (" + placeholders + ")";
  if (!sql) return fail("INVALID_ACTION", "Unsupported bulk action", 400);
  const bindValues = body.action === "mark_read" || body.action === "mark_unread" ? [ts, user.id, ...ids] : [ts, ts, user.id, ...ids];
  const result = await c.env.DB.prepare(sql).bind(...bindValues).run();
  await audit(c.env, user, `email.bulk_${body.action}`, "email", undefined, { count: result.meta.changes, ids });
  return ok({ changed: result.meta.changes });
});

app.get("/api/emails/:id", async (c) => {
  const user = c.get("user");
  const email = await first<EmailRow>(
    c.env.DB.prepare("SELECT * FROM emails WHERE id = ? AND (? = 'admin' OR user_id = ?)").bind(c.req.param("id"), user.role, user.id)
  );
  if (!email) return fail("EMAIL_NOT_FOUND", "Email not found", 404);
  if (email.direction === "inbound" && !email.is_read) {
    await c.env.DB.prepare("UPDATE emails SET is_read = 1, updated_at = ? WHERE id = ? AND user_id = ?").bind(now(), email.id, user.id).run();
  }
  const attachments = await all(c.env.DB.prepare("SELECT id, email_id, draft_id, direction, filename, content_type, size_bytes, file_type, created_at FROM attachments WHERE email_id = ?").bind(email.id));
  return ok({ ...email, html_body: sanitizeHtml(email.html_body), attachments });
});

app.post("/api/emails/send", async (c) => {
  const user = c.get("user");
  const body = (await c.req.json<{
    draft_id?: string;
    mailbox_id?: string;
    to?: string;
    cc?: string;
    bcc?: string;
    subject?: string;
    text_body?: string;
    html_body?: string;
    attachment_ids?: string[];
  }>().catch(() => ({}))) as {
    draft_id?: string;
    mailbox_id?: string;
    to?: string;
    cc?: string;
    bcc?: string;
    subject?: string;
    text_body?: string;
    html_body?: string;
    attachment_ids?: string[];
  };

  let draft: DraftRow | null = null;
  if (body.draft_id) {
    draft = await first<DraftRow>(c.env.DB.prepare("SELECT * FROM drafts WHERE id = ? AND user_id = ?").bind(body.draft_id, user.id));
    if (!draft) return fail("DRAFT_NOT_FOUND", "Draft not found", 404);
  }

  const mailboxId = body.mailbox_id || draft?.mailbox_id || "";
  const { mailbox, error } = await getMailboxForSend(c.env, user, mailboxId);
  if (error) return error;
  const to = cleanHeader(body.to ?? draft?.to_addr);
  const cc = cleanHeader(body.cc ?? draft?.cc);
  const bcc = cleanHeader(body.bcc ?? draft?.bcc);
  for (const value of [to, cc, bcc]) {
    const invalid = validateAddressList(value);
    if (invalid) return fail("INVALID_RECIPIENT", invalid, 400);
  }
  if (!parseCsvAddresses(to).length) return fail("RECIPIENT_REQUIRED", "At least one recipient is required", 400);

  const dailyLimited = await enforceDailyLimit(c.env, user, "send");
  if (dailyLimited) return dailyLimited;
  const attachmentIds = body.attachment_ids || [];
  if (attachmentIds.length) {
    const placeholders = attachmentIds.map(() => "?").join(",");
    const rows = await all<{ total: number }>(
      c.env.DB.prepare(`SELECT COALESCE(SUM(size_bytes),0) AS total FROM attachments WHERE user_id = ? AND id IN (${placeholders})`).bind(user.id, ...attachmentIds)
    );
    const limited = await enforceAttachmentLimit(c.env, user, rows[0]?.total || 0);
    if (limited) return limited;
  }

  const ts = now();
  const emailId = id("eml");
  const subject = cleanHeader(body.subject ?? draft?.subject) || "";
  const textBody = String(body.text_body ?? draft?.text_body ?? "");
  const htmlBody = String(body.html_body ?? draft?.html_body ?? "");
  const rawKey = `mail-sub/raw/outbound/${ts.slice(0, 10)}/${emailId}.json`;
  await c.env.MAIL_BUCKET.put(rawKey, JSON.stringify({ mailbox: mailbox!.email, to, cc, bcc, subject, text_body: textBody, html_body: htmlBody }), {
    httpMetadata: { contentType: "application/json" }
  });
  await c.env.DB.prepare(
    "INSERT INTO emails (id, user_id, mailbox_id, direction, from_addr, to_addr, cc, bcc, subject, text_body, html_body, raw_r2_key, status, created_at, updated_at) " +
      "VALUES (?, ?, ?, 'outbound', ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)"
  )
    .bind(emailId, user.id, mailbox!.id, mailbox!.email, to, cc, bcc, subject, textBody, htmlBody, rawKey, ts, ts)
    .run();
  if (attachmentIds.length) {
    const placeholders = attachmentIds.map(() => "?").join(",");
    await c.env.DB.prepare(`UPDATE attachments SET email_id = ?, direction = 'outbound' WHERE user_id = ? AND id IN (${placeholders})`).bind(emailId, user.id, ...attachmentIds).run();
  } else if (draft?.id) {
    await c.env.DB.prepare("UPDATE attachments SET email_id = ?, direction = 'outbound' WHERE user_id = ? AND draft_id = ?").bind(emailId, user.id, draft.id).run();
  }
  await c.env.DB.prepare("INSERT INTO send_logs (id, user_id, email_id, provider, status, created_at) VALUES (?, ?, ?, 'resend', 'pending', ?)")
    .bind(id("sendlog"), user.id, emailId, ts)
    .run();
  if (draft?.id) await c.env.DB.prepare("UPDATE drafts SET status = 'sent', updated_at = ? WHERE id = ?").bind(ts, draft.id).run();
  await c.env.MAIL_SEND_QUEUE.send({ kind: "mail-send", id: emailId } satisfies QueueBody);
  await audit(c.env, user, "email.send_requested", "email", emailId, {
    to,
    ip: c.req.header("CF-Connecting-IP") || null,
    user_agent: c.req.header("User-Agent") || null
  });
  return ok({ id: emailId, status: "pending" });
});

app.get("/api/drafts", async (c) => {
  const user = c.get("user");
  await cleanupExpiredDrafts(c.env, user);
  const q = c.req.query("q") || "";
  const clauses = ["user_id = ?", "status = 'draft'"];
  const binds: unknown[] = [user.id];
  if (q.trim()) {
    clauses.push("(COALESCE(subject,'') LIKE ? ESCAPE '\\' OR COALESCE(to_addr,'') LIKE ? ESCAPE '\\')");
    binds.push(like(q), like(q));
  }
  return ok(await all(c.env.DB.prepare(`SELECT * FROM drafts WHERE ${clauses.join(" AND ")} ORDER BY updated_at DESC LIMIT ${LIST_LIMIT}`).bind(...binds)));
});

app.delete("/api/drafts", async (c) => {
  const user = c.get("user");
  const body = (await c.req.json<{ ids?: string[] }>().catch(() => ({}))) as { ids?: string[] };
  const ids = (body.ids || []).filter(Boolean).slice(0, 100);
  if (!ids.length) return fail("DRAFT_IDS_REQUIRED", "Select at least one draft", 400);
  const placeholders = ids.map(() => "?").join(",");
  const attachments = await all<{ r2_key: string }>(c.env.DB.prepare(`SELECT r2_key FROM attachments WHERE user_id = ? AND draft_id IN (${placeholders})`).bind(user.id, ...ids));
  for (const att of attachments) await c.env.MAIL_BUCKET.delete(att.r2_key);
  await c.env.DB.prepare(`DELETE FROM attachments WHERE user_id = ? AND draft_id IN (${placeholders})`).bind(user.id, ...ids).run();
  const result = await c.env.DB.prepare(`DELETE FROM drafts WHERE user_id = ? AND id IN (${placeholders})`).bind(user.id, ...ids).run();
  await audit(c.env, user, "draft.bulk_delete", "draft", undefined, { count: result.meta.changes });
  return ok({ deleted: result.meta.changes });
});

app.post("/api/drafts", async (c) => {
  const user = c.get("user");
  const body = (await c.req.json<Partial<DraftRow>>().catch(() => ({}))) as Partial<DraftRow>;
  const ts = now();
  const draftId = id("draft");
  if (body.mailbox_id) {
    const mailbox = await first<MailboxRow>(c.env.DB.prepare("SELECT * FROM mailboxes WHERE id = ? AND user_id = ?").bind(body.mailbox_id, user.id));
    if (!mailbox) return fail("MAILBOX_NOT_FOUND", "Mailbox not found", 404);
  }
  await c.env.DB.prepare(
    "INSERT INTO drafts (id, user_id, mailbox_id, to_addr, cc, bcc, subject, text_body, html_body, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?)"
  )
    .bind(draftId, user.id, body.mailbox_id || null, cleanHeader(body.to_addr), cleanHeader(body.cc), cleanHeader(body.bcc), cleanHeader(body.subject), body.text_body || "", body.html_body || "", ts, ts)
    .run();
  return ok({ id: draftId, updated_at: ts });
});

app.get("/api/drafts/:id", async (c) => {
  const user = c.get("user");
  const draft = await first<DraftRow>(c.env.DB.prepare("SELECT * FROM drafts WHERE id = ? AND user_id = ?").bind(c.req.param("id"), user.id));
  if (!draft) return fail("DRAFT_NOT_FOUND", "Draft not found", 404);
  const attachments = await all(c.env.DB.prepare("SELECT id, filename, content_type, size_bytes, created_at FROM attachments WHERE draft_id = ?").bind(draft.id));
  return ok({ ...draft, attachments });
});

app.patch("/api/drafts/:id", async (c) => {
  const user = c.get("user");
  const body = (await c.req.json<Partial<DraftRow>>().catch(() => ({}))) as Partial<DraftRow>;
  const draftId = c.req.param("id");
  if (body.mailbox_id) {
    const mailbox = await first<MailboxRow>(c.env.DB.prepare("SELECT * FROM mailboxes WHERE id = ? AND user_id = ?").bind(body.mailbox_id, user.id));
    if (!mailbox) return fail("MAILBOX_NOT_FOUND", "Mailbox not found", 404);
  }
  const existing = await first<DraftRow>(c.env.DB.prepare("SELECT * FROM drafts WHERE id = ? AND user_id = ?").bind(draftId, user.id));
  if (!existing) return fail("DRAFT_NOT_FOUND", "Draft not found", 404);
  const ts = now();
  if (
    (existing.subject || "") !== (body.subject || "") ||
    (existing.text_body || "") !== (body.text_body || "") ||
    (existing.html_body || "") !== (body.html_body || "")
  ) {
    await c.env.DB.prepare(
      "INSERT INTO draft_versions (id, draft_id, user_id, mailbox_id, to_addr, cc, bcc, subject, text_body, html_body, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
    )
      .bind(id("dver"), existing.id, user.id, existing.mailbox_id, existing.to_addr, existing.cc, existing.bcc, existing.subject, existing.text_body, existing.html_body, ts)
      .run();
  }
  const result = await c.env.DB.prepare(
    "UPDATE drafts SET mailbox_id = COALESCE(?, mailbox_id), to_addr = ?, cc = ?, bcc = ?, subject = ?, text_body = ?, html_body = ?, updated_at = ? WHERE id = ? AND user_id = ?"
  )
    .bind(body.mailbox_id || null, cleanHeader(body.to_addr), cleanHeader(body.cc), cleanHeader(body.bcc), cleanHeader(body.subject), body.text_body || "", body.html_body || "", ts, draftId, user.id)
    .run();
  if (!result.meta.changes) return fail("DRAFT_NOT_FOUND", "Draft not found", 404);
  return ok({ id: draftId });
});

app.get("/api/drafts/:id/history", async (c) => {
  const user = c.get("user");
  const draft = await first<DraftRow>(c.env.DB.prepare("SELECT id FROM drafts WHERE id = ? AND user_id = ?").bind(c.req.param("id"), user.id));
  if (!draft) return fail("DRAFT_NOT_FOUND", "Draft not found", 404);
  return ok(await all(c.env.DB.prepare("SELECT * FROM draft_versions WHERE draft_id = ? AND user_id = ? ORDER BY created_at DESC LIMIT 30").bind(draft.id, user.id)));
});

app.delete("/api/drafts/:id", async (c) => {
  const user = c.get("user");
  const draftId = c.req.param("id");
  const attachments = await all<{ id: string; r2_key: string }>(c.env.DB.prepare("SELECT id, r2_key FROM attachments WHERE draft_id = ? AND user_id = ?").bind(draftId, user.id));
  for (const att of attachments) await c.env.MAIL_BUCKET.delete(att.r2_key);
  await c.env.DB.prepare("DELETE FROM attachments WHERE draft_id = ? AND user_id = ?").bind(draftId, user.id).run();
  const result = await c.env.DB.prepare("DELETE FROM drafts WHERE id = ? AND user_id = ?").bind(draftId, user.id).run();
  if (!result.meta.changes) return fail("DRAFT_NOT_FOUND", "Draft not found", 404);
  return ok({ id: draftId });
});

app.post("/api/attachments/upload", async (c) => {
  const user = c.get("user");
  const form = await c.req.formData();
  const file = form.get("file");
  const draftId = String(form.get("draft_id") || "");
  if (!(file instanceof File)) return fail("FILE_REQUIRED", "File is required", 400);
  if (!draftId) return fail("DRAFT_REQUIRED", "draft_id is required", 400);
  const draft = await first<DraftRow>(c.env.DB.prepare("SELECT * FROM drafts WHERE id = ? AND user_id = ?").bind(draftId, user.id));
  if (!draft) return fail("DRAFT_NOT_FOUND", "Draft not found", 404);
  const filename = sanitizeFilename(file.name || "attachment.bin");
  let scan = { status: "passed", error: null as string | null };
  try {
    scan = await scanAttachment(c.env, file);
  } catch (error) {
    return fail("ATTACHMENT_REJECTED", error instanceof Error ? error.message : "Attachment scan failed", 400);
  }
  const limited = await enforceAttachmentLimit(c.env, user, file.size);
  if (limited) return limited;
  const attachmentId = id("att");
  const key = `mail-sub/drafts/${user.id}/${draftId}/${attachmentId}-${filename}`;
  await c.env.MAIL_BUCKET.put(key, file.stream(), { httpMetadata: { contentType: file.type } });
  await c.env.DB.prepare(
    "INSERT INTO attachments (id, user_id, draft_id, direction, filename, content_type, size_bytes, r2_key, file_type, scan_status, scan_error, created_at) VALUES (?, ?, ?, 'draft', ?, ?, ?, ?, ?, ?, ?, ?)"
  )
    .bind(attachmentId, user.id, draftId, filename, file.type, file.size, key, fileType(filename, file.type), scan.status, scan.error, now())
    .run();
  await incrementCounter(c.env, user.id, "attachment", 1, file.size);
  await audit(c.env, user, "attachment.upload", "attachment", attachmentId, { filename, size: file.size });
  return ok({ id: attachmentId, filename, content_type: file.type, size_bytes: file.size });
});

app.get("/api/attachments/:id/download", async (c) => {
  const user = c.get("user");
  const attachment = await first<{ id: string; user_id: string; filename: string; content_type: string | null; r2_key: string }>(
    c.env.DB.prepare("SELECT * FROM attachments WHERE id = ? AND (? = 'admin' OR user_id = ?)").bind(c.req.param("id"), user.role, user.id)
  );
  if (!attachment) return fail("ATTACHMENT_NOT_FOUND", "Attachment not found", 404);
  const object = await c.env.MAIL_BUCKET.get(attachment.r2_key);
  if (!object) return fail("ATTACHMENT_MISSING", "Attachment object missing", 404);
  return new Response(object.body, {
    headers: {
      "Content-Type": attachment.content_type || "application/octet-stream",
      "Content-Disposition": `attachment; filename="${attachment.filename.replace(/"/g, "")}"`
    }
  });
});

app.delete("/api/attachments/:id", async (c) => {
  const user = c.get("user");
  const attachment = await first<{ id: string; r2_key: string }>(
    c.env.DB.prepare("SELECT id, r2_key FROM attachments WHERE id = ? AND user_id = ?").bind(c.req.param("id"), user.id)
  );
  if (!attachment) return fail("ATTACHMENT_NOT_FOUND", "Attachment not found", 404);
  await c.env.MAIL_BUCKET.delete(attachment.r2_key);
  await c.env.DB.prepare("DELETE FROM attachments WHERE id = ? AND user_id = ?").bind(attachment.id, user.id).run();
  return ok({ id: attachment.id });
});

app.get("/api/attachments", async (c) => {
  const user = c.get("user");
  const q = c.req.query("q") || "";
  const type = c.req.query("type") || "";
  const sort = normalizeSort(c.req.query("sort") || "created_desc", {
    name: "a.filename ASC",
    size: "a.size_bytes DESC",
    created_asc: "a.created_at ASC",
    created_desc: "a.created_at DESC"
  }, "a.created_at DESC");
  const clauses = [user.role === "admin" ? "1=1" : "a.user_id = ?"];
  const binds: unknown[] = user.role === "admin" ? [] : [user.id];
  if (q.trim()) {
    clauses.push("a.filename LIKE ? ESCAPE '\\'");
    binds.push(like(q));
  }
  if (type) {
    clauses.push("a.file_type = ?");
    binds.push(type);
  }
  return ok(await all(c.env.DB.prepare(
    `SELECT a.id, a.email_id, a.draft_id, a.direction, a.filename, a.content_type, a.size_bytes, a.file_type, a.scan_status, a.created_at, e.subject AS email_subject, e.direction AS email_direction, d.subject AS draft_subject, u.username AS owner_username
     FROM attachments a
     LEFT JOIN emails e ON e.id = a.email_id
     LEFT JOIN drafts d ON d.id = a.draft_id
     LEFT JOIN users u ON u.id = a.user_id
     WHERE ${clauses.join(" AND ")}
     ORDER BY ${sort}
     LIMIT ${LIST_LIMIT}`
  ).bind(...binds)));
});

app.post("/api/attachments/cleanup", requireAdmin, async (c) => {
  const user = c.get("user");
  const body = (await c.req.json<{ retention_days?: number; dry_run?: boolean }>().catch(() => ({}))) as { retention_days?: number; dry_run?: boolean };
  const days = Math.max(1, Math.min(Number(body.retention_days || 30), 365));
  const cutoff = new Date(Date.now() - days * 86400000).toISOString();
  const rows = await all<{ id: string; r2_key: string; size_bytes: number }>(
    c.env.DB.prepare("SELECT id, r2_key, size_bytes FROM attachments WHERE created_at < ? OR (email_id IS NULL AND draft_id IS NULL)").bind(cutoff)
  );
  if (!body.dry_run) {
    for (const row of rows) await c.env.MAIL_BUCKET.delete(row.r2_key);
    if (rows.length) {
      const placeholders = rows.map(() => "?").join(",");
      await c.env.DB.prepare(`DELETE FROM attachments WHERE id IN (${placeholders})`).bind(...rows.map((r) => r.id)).run();
    }
    await audit(c.env, user, "attachment.cleanup", "attachment", undefined, { count: rows.length, retention_days: days });
  }
  return ok({ count: rows.length, bytes: rows.reduce((sum, row) => sum + row.size_bytes, 0), dry_run: !!body.dry_run });
});

app.post("/api/agent/generate", async (c) => {
  const user = c.get("user");
  const body = (await c.req.json<{ draft_id?: string; command?: string; input?: string; selected_text?: string }>().catch(() => ({}))) as {
    draft_id?: string;
    command?: string;
    input?: string;
    selected_text?: string;
  };
  const command = cleanHeader(body.command) || "generate";
  const input = String(body.input || body.selected_text || "");
  try {
    await checkQuota(c.env, user.id);
  } catch (error) {
    return fail("QUOTA_DENIED", error instanceof Error ? error.message : "Quota check failed", 403);
  }
  if (body.draft_id) {
    const draft = await first<DraftRow>(c.env.DB.prepare("SELECT * FROM drafts WHERE id = ? AND user_id = ?").bind(body.draft_id, user.id));
    if (!draft) return fail("DRAFT_NOT_FOUND", "Draft not found", 404);
  }
  const ts = now();
  const jobId = id("agent");
  const estimated = Math.max(1, Math.ceil((command.length + input.length) / 4));
  await c.env.DB.prepare(
    "INSERT INTO agent_jobs (id, user_id, draft_id, command, input, model, estimated_tokens, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)"
  )
    .bind(jobId, user.id, body.draft_id || null, command, input, c.env.GEMINI_MODEL || "gemini-1.5-flash", estimated, ts, ts)
    .run();
  await c.env.AGENT_GENERATE_QUEUE.send({ kind: "agent-generate", id: jobId } satisfies QueueBody);
  await audit(c.env, user, "agent.generate_requested", "agent_job", jobId, { command });
  return ok({ id: jobId, status: "pending" });
});

app.get("/api/agent/jobs/:id", async (c) => {
  const user = c.get("user");
  const job = await first<AgentJobRow>(
    c.env.DB.prepare("SELECT * FROM agent_jobs WHERE id = ? AND (? = 'admin' OR user_id = ?)").bind(c.req.param("id"), user.role, user.id)
  );
  if (!job) return fail("JOB_NOT_FOUND", "Agent job not found", 404);
  return ok(job);
});

app.post("/api/agent/jobs/:id/retry", async (c) => {
  const user = c.get("user");
  const job = await first<AgentJobRow>(c.env.DB.prepare("SELECT * FROM agent_jobs WHERE id = ? AND user_id = ?").bind(c.req.param("id"), user.id));
  if (!job) return fail("JOB_NOT_FOUND", "Agent job not found", 404);
  if (job.retry_count >= 3) return fail("RETRY_LIMIT", "Retry limit exceeded", 400);
  try {
    await checkQuota(c.env, user.id);
  } catch (error) {
    return fail("QUOTA_DENIED", error instanceof Error ? error.message : "Quota check failed", 403);
  }
  await c.env.DB.prepare("UPDATE agent_jobs SET status = 'pending', error = NULL, retry_count = retry_count + 1, updated_at = ? WHERE id = ?").bind(now(), job.id).run();
  await c.env.AGENT_GENERATE_QUEUE.send({ kind: "agent-generate", id: job.id } satisfies QueueBody);
  return ok({ id: job.id, status: "pending" });
});

app.patch("/api/me/settings", async (c) => {
  const user = c.get("user");
  const body = (await c.req.json<{ display_name?: string; avatar_url?: string; language?: string; theme?: string; draft_retention_days?: number }>().catch(() => ({}))) as {
    display_name?: string;
    avatar_url?: string;
    language?: string;
    theme?: string;
    draft_retention_days?: number;
  };
  const language = ["zh", "en"].includes(body.language || "") ? body.language : null;
  const theme = ["light", "dark", "system"].includes(body.theme || "") ? body.theme : null;
  const retention = [1, 3, 7, 30].includes(Number(body.draft_retention_days)) ? Number(body.draft_retention_days) : null;
  await c.env.DB.prepare(
    "UPDATE users SET display_name = COALESCE(?, display_name), avatar_url = COALESCE(?, avatar_url), language = COALESCE(?, language), theme = COALESCE(?, theme), draft_retention_days = COALESCE(?, draft_retention_days), updated_at = ? WHERE id = ?"
  )
    .bind(cleanHeader(body.display_name) || null, cleanHeader(body.avatar_url) || null, language, theme, retention, now(), user.id)
    .run();
  await audit(c.env, user, "user.settings.update", "user", user.id, { language, theme, draft_retention_days: retention });
  return ok({ id: user.id, display_name: body.display_name, avatar_url: body.avatar_url, language, theme, draft_retention_days: retention });
});

app.get("/api/usage/trends", async (c) => {
  const user = c.get("user");
  const days = Math.max(1, Math.min(Number(c.req.query("days") || 7), 90));
  const since = new Date(Date.now() - days * 86400000).toISOString();
  const counters = await all<{ day: string; type: string; count: number; bytes: number }>(
    c.env.DB.prepare("SELECT substr(period_start,1,10) AS day, type, SUM(count) AS count, SUM(bytes) AS bytes FROM usage_counters WHERE user_id = ? AND period_start >= ? GROUP BY day, type ORDER BY day ASC").bind(user.id, since)
  );
  const mailboxes = await all<{ day: string; count: number }>(
    c.env.DB.prepare("SELECT substr(created_at,1,10) AS day, COUNT(*) AS count FROM mailboxes WHERE user_id = ? AND created_at >= ? GROUP BY day ORDER BY day ASC").bind(user.id, since)
  );
  return ok({ days, counters, mailboxes });
});

app.get("/api/global-search", async (c) => {
  const user = c.get("user");
  const q = c.req.query("q") || "";
  if (q.trim().length < 2) return ok({ emails: [], mailboxes: [], attachments: [], users: [] });
  const term = like(q);
  const emails = await all(c.env.DB.prepare("SELECT id, subject, from_addr, to_addr, direction, created_at FROM emails WHERE (? = 'admin' OR user_id = ?) AND (subject LIKE ? ESCAPE '\\' OR from_addr LIKE ? ESCAPE '\\' OR to_addr LIKE ? ESCAPE '\\' OR text_body LIKE ? ESCAPE '\\') ORDER BY created_at DESC LIMIT 8").bind(user.role, user.id, term, term, term, term));
  const mailboxes = await all(c.env.DB.prepare("SELECT id, email, alias, status FROM mailboxes WHERE (? = 'admin' OR user_id = ?) AND (email LIKE ? ESCAPE '\\' OR COALESCE(alias,'') LIKE ? ESCAPE '\\') ORDER BY created_at DESC LIMIT 8").bind(user.role, user.id, term, term));
  const attachments = await all(c.env.DB.prepare("SELECT id, filename, size_bytes, file_type, created_at FROM attachments WHERE (? = 'admin' OR user_id = ?) AND filename LIKE ? ESCAPE '\\' ORDER BY created_at DESC LIMIT 8").bind(user.role, user.id, term));
  const users = user.role === "admin" ? await all(c.env.DB.prepare("SELECT id, username, role, status FROM users WHERE username LIKE ? ESCAPE '\\' OR COALESCE(display_name,'') LIKE ? ESCAPE '\\' LIMIT 8").bind(term, term)) : [];
  return ok({ emails, mailboxes, attachments, users });
});

app.use("/api/admin/*", requireAdmin);

app.get("/api/admin/users", async (c) => {
  const q = c.req.query("q") || "";
  const status = c.req.query("status") || "";
  const clauses = ["1=1"];
  const binds: unknown[] = [];
  if (q.trim()) {
    clauses.push("(u.username LIKE ? ESCAPE '\\' OR COALESCE(u.display_name,'') LIKE ? ESCAPE '\\')");
    binds.push(like(q), like(q));
  }
  if (status && ["active", "frozen"].includes(status)) {
    clauses.push("u.status = ?");
    binds.push(status);
  }
  const rows = await all(
    c.env.DB.prepare(
      "SELECT u.*, r.name AS app_role_name, r.role_key AS app_role_key, COALESCE(l.max_mailboxes, ?) AS max_mailboxes, COALESCE(l.max_send_per_day, ?) AS max_send_per_day, COALESCE(l.max_receive_per_day, ?) AS max_receive_per_day, COALESCE(l.max_attachment_total_bytes, ?) AS max_attachment_total_bytes, " +
        "(SELECT COUNT(*) FROM emails e WHERE e.user_id = u.id AND e.direction = 'inbound') AS received_count, " +
        "(SELECT COUNT(*) FROM emails e WHERE e.user_id = u.id AND e.direction = 'outbound') AS sent_count, " +
        "(SELECT COUNT(*) FROM mailboxes m WHERE m.user_id = u.id AND m.status != 'deleted') AS mailbox_count, " +
        "(SELECT COALESCE(SUM(a.size_bytes),0) FROM attachments a WHERE a.user_id = u.id) AS attachment_bytes " +
        `FROM users u LEFT JOIN usage_limits l ON l.user_id = u.id LEFT JOIN roles r ON r.id = u.app_role_id WHERE ${clauses.join(" AND ")} ORDER BY u.created_at DESC LIMIT ${LIST_LIMIT}`
    ).bind(Number(c.env.DEFAULT_MAX_MAILBOXES), Number(c.env.DEFAULT_MAX_SEND_PER_DAY), Number(c.env.DEFAULT_MAX_RECEIVE_PER_DAY), Number(c.env.DEFAULT_MAX_ATTACHMENT_TOTAL_BYTES), ...binds)
  );
  return ok(rows);
});

app.get("/api/admin/users/:id", async (c) => {
  const userId = c.req.param("id");
  const user = await first(c.env.DB.prepare("SELECT * FROM users WHERE id = ?").bind(userId));
  if (!user) return fail("USER_NOT_FOUND", "User not found", 404);
  const [limits, mailboxes, stats] = await Promise.all([
    getLimits(c.env, userId),
    all(c.env.DB.prepare("SELECT * FROM mailboxes WHERE user_id = ? ORDER BY created_at DESC").bind(userId)),
    all(c.env.DB.prepare("SELECT type, SUM(count) AS count, SUM(bytes) AS bytes FROM usage_counters WHERE user_id = ? GROUP BY type").bind(userId))
  ]);
  return ok({ user, limits, mailboxes, stats });
});

app.patch("/api/admin/users/:id/limits", async (c) => {
  const actor = c.get("user");
  const userId = c.req.param("id");
  const body = (await c.req.json<Record<string, number>>().catch(() => ({}))) as Record<string, number>;
  await c.env.DB.prepare(
    "INSERT INTO usage_limits (user_id, max_mailboxes, max_send_per_day, max_receive_per_day, max_attachment_total_bytes, updated_at) VALUES (?, ?, ?, ?, ?, ?) " +
      "ON CONFLICT(user_id) DO UPDATE SET max_mailboxes = excluded.max_mailboxes, max_send_per_day = excluded.max_send_per_day, max_receive_per_day = excluded.max_receive_per_day, max_attachment_total_bytes = excluded.max_attachment_total_bytes, updated_at = excluded.updated_at"
  )
    .bind(userId, body.max_mailboxes ?? null, body.max_send_per_day ?? null, body.max_receive_per_day ?? null, body.max_attachment_total_bytes ?? null, now())
    .run();
  await audit(c.env, actor, "admin.user_limits.update", "user", userId, body);
  return ok({ user_id: userId });
});

app.patch("/api/admin/users/:id/status", async (c) => {
  const actor = c.get("user");
  const body = (await c.req.json<{ status?: UserStatus }>().catch(() => ({}))) as { status?: UserStatus };
  if (!body.status || !["active", "frozen"].includes(body.status)) return fail("INVALID_STATUS", "Invalid user status", 400);
  const result = await c.env.DB.prepare("UPDATE users SET status = ?, updated_at = ? WHERE id = ?").bind(body.status, now(), c.req.param("id")).run();
  if (!result.meta.changes) return fail("USER_NOT_FOUND", "User not found", 404);
  await audit(c.env, actor, "admin.user_status.update", "user", c.req.param("id"), { status: body.status });
  return ok({ id: c.req.param("id"), status: body.status });
});

app.post("/api/admin/users/:id/reset-counters", async (c) => {
  const actor = c.get("user");
  const userId = c.req.param("id");
  const body = (await c.req.json<{ types?: string[] }>().catch(() => ({}))) as { types?: string[] };
  const types = (body.types?.length ? body.types : ["send", "receive"]).filter((type) => ["send", "receive", "tokens", "agent", "attachment"].includes(type));
  if (!types.length) return fail("INVALID_COUNTER_TYPE", "No valid counter type selected", 400);
  const placeholders = types.map(() => "?").join(",");
  const result = await c.env.DB.prepare(`UPDATE usage_counters SET count = 0, bytes = 0, updated_at = ? WHERE user_id = ? AND period_start = ? AND type IN (${placeholders})`)
    .bind(now(), userId, dayStart(), ...types)
    .run();
  await audit(c.env, actor, "admin.user_counters.reset", "user", userId, { types, changed: result.meta.changes });
  return ok({ user_id: userId, changed: result.meta.changes });
});

app.patch("/api/admin/users/:id/app-role", async (c) => {
  const actor = c.get("user");
  const userId = c.req.param("id");
  const body = (await c.req.json<{ role_id?: string | null }>().catch(() => ({}))) as { role_id?: string | null };
  await applyRoleToUser(c.env, userId, body.role_id || null);
  await audit(c.env, actor, "admin.user_role.update", "user", userId, { role_id: body.role_id || "default" });
  return ok({ user_id: userId, role_id: body.role_id || null });
});

app.get("/api/admin/roles", async (c) => {
  await ensureDefaultRoles(c.env);
  return ok(await all<RoleRow>(c.env.DB.prepare("SELECT * FROM roles ORDER BY sort_order ASC, created_at ASC")));
});

app.post("/api/admin/roles", async (c) => {
  const actor = c.get("user");
  const body = (await c.req.json<Partial<RoleRow> & { limits?: Record<string, number> }>().catch(() => ({}))) as Partial<RoleRow> & { limits?: Record<string, number> };
  const roleKey = cleanRoleKey(body.role_key || body.name || "");
  if (!roleKey) return fail("ROLE_KEY_REQUIRED", "Role key is required", 400);
  const ts = now();
  const roleId = id("role");
  await c.env.DB.prepare("INSERT INTO roles (id, role_key, name, description, sort_order, is_default, is_system, permissions, limits_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 0, 0, ?, ?, ?, ?)")
    .bind(roleId, roleKey, cleanHeader(body.name) || roleKey, cleanHeader(body.description) || null, Number(body.sort_order || 100), JSON.stringify(parsePermissions(body.permissions)), JSON.stringify(body.limits || {}), ts, ts)
    .run();
  await audit(c.env, actor, "admin.role.create", "role", roleId, { role_key: roleKey });
  return ok({ id: roleId });
});

app.patch("/api/admin/roles/:id", async (c) => {
  const actor = c.get("user");
  const roleId = c.req.param("id");
  const body = (await c.req.json<Partial<RoleRow> & { limits?: Record<string, number> }>().catch(() => ({}))) as Partial<RoleRow> & { limits?: Record<string, number> };
  const existing = await first<RoleRow>(c.env.DB.prepare("SELECT * FROM roles WHERE id = ?").bind(roleId));
  if (!existing) return fail("ROLE_NOT_FOUND", "Role not found", 404);
  const permissions = parsePermissions(body.permissions ?? existing.permissions);
  if (!permissions.length) return fail("ROLE_PERMISSIONS_REQUIRED", "Select at least one permission", 400);
  const limits = body.limits || safeJson<Record<string, number | boolean>>(existing.limits_json, {});
  await c.env.DB.prepare("UPDATE roles SET name = ?, description = ?, sort_order = ?, is_default = ?, permissions = ?, limits_json = ?, updated_at = ? WHERE id = ?")
    .bind(cleanHeader(body.name) || existing.name, cleanHeader(body.description) || null, Number(body.sort_order ?? existing.sort_order), body.is_default ? 1 : 0, JSON.stringify(permissions), JSON.stringify(limits), now(), roleId)
    .run();
  if (body.is_default) await c.env.DB.prepare("UPDATE roles SET is_default = CASE WHEN id = ? THEN 1 ELSE 0 END").bind(roleId).run();
  await syncRoleLimitsToUsers(c.env, roleId, limits);
  await audit(c.env, actor, "admin.role.update", "role", roleId, { name: body.name, is_default: !!body.is_default });
  return ok({ id: roleId });
});

app.delete("/api/admin/roles/:id", async (c) => {
  const actor = c.get("user");
  const roleId = c.req.param("id");
  const existing = await first<RoleRow>(c.env.DB.prepare("SELECT * FROM roles WHERE id = ?").bind(roleId));
  if (!existing) return fail("ROLE_NOT_FOUND", "Role not found", 404);
  if (existing.is_system) return fail("SYSTEM_ROLE", "System role cannot be deleted", 403);
  const defaultRole = await getDefaultRole(c.env);
  await c.env.DB.prepare("UPDATE users SET app_role_id = ?, updated_at = ? WHERE app_role_id = ?").bind(defaultRole?.id || null, now(), roleId).run();
  if (defaultRole) await syncRoleLimitsToUsers(c.env, defaultRole.id, safeJson<Record<string, number | boolean>>(defaultRole.limits_json, {}));
  await c.env.DB.prepare("DELETE FROM roles WHERE id = ?").bind(roleId).run();
  await audit(c.env, actor, "admin.role.delete", "role", roleId, { role_key: existing.role_key });
  return ok({ id: roleId });
});

app.get("/api/admin/system-settings", async (c) => {
  await ensureDefaultSettings(c.env);
  const rows = await all<{ key: string; value: string | null; type: string; r2_key: string | null }>(c.env.DB.prepare("SELECT key, value, type, r2_key FROM app_settings WHERE key IN ('landing_background_opacity','landing_background') ORDER BY key ASC"));
  const settings = Object.fromEntries(rows.map((row) => [row.key, coerceSettingValue(row.value, row.type)]));
  const background = rows.find((row) => row.key === "landing_background");
  return ok({ settings: { ...settings, landing_background_url: background?.r2_key ? "/api/landing-background" : "" } });
});

app.patch("/api/admin/system-settings", async (c) => {
  const actor = c.get("user");
  const body = (await c.req.json<Record<string, unknown>>().catch(() => ({}))) as Record<string, unknown>;
  const allowed: Record<string, string> = {
    landing_background_opacity: "number"
  };
  const ts = now();
  const saved: Record<string, unknown> = {};
  for (const [key, type] of Object.entries(allowed)) {
    if (!(key in body)) continue;
    const value = normalizeSettingValue(body[key], type);
    await c.env.DB.prepare("INSERT INTO app_settings (key, value, type, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, type = excluded.type, updated_at = excluded.updated_at")
      .bind(key, value, type, ts)
      .run();
    saved[key] = coerceSettingValue(value, type);
  }
  await audit(c.env, actor, "admin.system_settings.update", "system", "app_settings", saved);
  return ok({ settings: saved });
});

app.post("/api/admin/system-settings/background", async (c) => {
  const actor = c.get("user");
  const form = await c.req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) return fail("FILE_REQUIRED", "Background image is required", 400);
  if (!file.type.startsWith("image/")) return fail("INVALID_IMAGE", "Only images are allowed", 400);
  if (file.size > 8 * 1024 * 1024) return fail("IMAGE_TOO_LARGE", "Image must be under 8MB", 413);
  const key = `mail-sub/settings/landing-background/${id("bg")}-${sanitizeFilename(file.name || "background")}`;
  await c.env.MAIL_BUCKET.put(key, file.stream(), { httpMetadata: { contentType: file.type } });
  const previous = await first<{ r2_key: string | null }>(c.env.DB.prepare("SELECT r2_key FROM app_settings WHERE key = 'landing_background'"));
  if (previous?.r2_key) await c.env.MAIL_BUCKET.delete(previous.r2_key);
  await c.env.DB.prepare("INSERT INTO app_settings (key, value, type, r2_key, updated_at) VALUES ('landing_background', ?, 'image', ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, type = excluded.type, r2_key = excluded.r2_key, updated_at = excluded.updated_at")
    .bind(file.type, key, now())
    .run();
  await audit(c.env, actor, "admin.landing_background.upload", "system", "landing_background");
  return ok({ url: "/api/landing-background" });
});

app.delete("/api/admin/system-settings/background", async (c) => {
  const actor = c.get("user");
  const previous = await first<{ r2_key: string | null }>(c.env.DB.prepare("SELECT r2_key FROM app_settings WHERE key = 'landing_background'"));
  if (previous?.r2_key) await c.env.MAIL_BUCKET.delete(previous.r2_key);
  await c.env.DB.prepare("INSERT INTO app_settings (key, value, type, r2_key, updated_at) VALUES ('landing_background', '', 'image', NULL, ?) ON CONFLICT(key) DO UPDATE SET value = '', r2_key = NULL, updated_at = excluded.updated_at")
    .bind(now())
    .run();
  await audit(c.env, actor, "admin.landing_background.delete", "system", "landing_background");
  return ok({ deleted: true });
});

app.get("/api/admin/mailboxes", async (c) => {
  const userId = c.req.query("user_id");
  const q = c.req.query("q") || "";
  const status = c.req.query("status") || "";
  const sort = normalizeSort(c.req.query("sort") || "created_desc", {
    local_part: "m.local_part ASC",
    owner: "u.username ASC, m.created_at DESC",
    status: "m.status ASC, m.created_at DESC",
    created_asc: "m.created_at ASC",
    created_desc: "m.created_at DESC"
  }, "m.created_at DESC");
  const clauses = ["1=1"];
  const binds: unknown[] = [];
  if (userId) {
    clauses.push("m.user_id = ?");
    binds.push(userId);
  }
  if (status) {
    clauses.push("m.status = ?");
    binds.push(status);
  }
  if (q.trim()) {
    clauses.push("(m.email LIKE ? ESCAPE '\\' OR COALESCE(m.alias,'') LIKE ? ESCAPE '\\' OR u.username LIKE ? ESCAPE '\\')");
    binds.push(like(q), like(q), like(q));
  }
  const rows = await all(c.env.DB.prepare(
    `SELECT m.*, u.username, (SELECT COUNT(*) FROM emails e WHERE e.mailbox_id = m.id AND e.direction = 'inbound') AS inbound_count, (SELECT COUNT(*) FROM emails e WHERE e.mailbox_id = m.id AND e.direction = 'outbound') AS outbound_count
     FROM mailboxes m JOIN users u ON u.id = m.user_id
     WHERE ${clauses.join(" AND ")}
     ORDER BY ${sort}
     LIMIT ${LIST_LIMIT}`
  ).bind(...binds));
  return ok(rows);
});

app.patch("/api/admin/mailboxes/:id/status", async (c) => {
  const actor = c.get("user");
  const body = (await c.req.json<{ status?: MailboxStatus }>().catch(() => ({}))) as { status?: MailboxStatus };
  const allowed: MailboxStatus[] = ["active", "disabled", "receive_only", "send_only", "frozen", "deleted"];
  if (!body.status || !allowed.includes(body.status)) return fail("INVALID_STATUS", "Invalid mailbox status", 400);
  const result = await c.env.DB.prepare("UPDATE mailboxes SET status = ?, updated_at = ? WHERE id = ?").bind(body.status, now(), c.req.param("id")).run();
  if (!result.meta.changes) return fail("MAILBOX_NOT_FOUND", "Mailbox not found", 404);
  await audit(c.env, actor, "admin.mailbox_status.update", "mailbox", c.req.param("id"), { status: body.status });
  return ok({ id: c.req.param("id"), status: body.status });
});

app.get("/api/admin/analysis", async (c) => {
  const days = Number(c.req.query("days") || 7);
  const since = new Date(Date.now() - Math.max(1, Math.min(days, 30)) * 86400000).toISOString();
  const users = await all<{ id: string; username: string; role: Role }>(c.env.DB.prepare("SELECT id, username, role FROM users ORDER BY username ASC"));
  const counters = await all<{ user_id: string; type: string; count: number; bytes: number }>(
    c.env.DB.prepare("SELECT user_id, type, SUM(count) AS count, SUM(bytes) AS bytes FROM usage_counters WHERE period_start >= ? GROUP BY user_id, type").bind(since)
  );
  const mailboxCounts = await all<{ user_id: string; count: number }>(
    c.env.DB.prepare("SELECT user_id, COUNT(*) AS count FROM mailboxes WHERE status != 'deleted' GROUP BY user_id")
  );
  const failures = await all<{ user_id: string; count: number }>(
    c.env.DB.prepare("SELECT user_id, COUNT(*) AS count FROM emails WHERE direction = 'outbound' AND status = 'failed' AND created_at >= ? GROUP BY user_id").bind(since)
  );
  const byDay = await all<{ day: string; direction: string; count: number }>(
    c.env.DB.prepare("SELECT substr(created_at, 1, 10) AS day, direction, COUNT(*) AS count FROM emails WHERE created_at >= ? GROUP BY day, direction ORDER BY day ASC").bind(since)
  );
  const rows = users.map((user) => {
    const getCount = (type: string) => counters.find((c2) => c2.user_id === user.id && c2.type === type)?.count || 0;
    const getBytes = (type: string) => counters.find((c2) => c2.user_id === user.id && c2.type === type)?.bytes || 0;
    return {
      user_id: user.id,
      username: user.username,
      role: user.role,
      tokens: getCount("tokens"),
      sent: getCount("send"),
      received: getCount("receive"),
      mailboxes: mailboxCounts.find((m) => m.user_id === user.id)?.count || 0,
      attachment_bytes: getBytes("attachment"),
      send_failures: failures.find((f) => f.user_id === user.id)?.count || 0,
      agent_jobs: getCount("agent")
    };
  });
  if (c.req.query("format") === "csv") {
    const header = "username,role,tokens,sent,received,mailboxes,attachment_bytes,send_failures,agent_jobs";
    const csv = [header, ...rows.map((r) => [r.username, r.role, r.tokens, r.sent, r.received, r.mailboxes, r.attachment_bytes, r.send_failures, r.agent_jobs].join(","))].join("\n");
    return new Response(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": "attachment; filename=\"mail-agent-analysis.csv\""
      }
    });
  }
  return ok({ users: rows, by_day: byDay, days });
});

app.get("/api/admin/audit-logs", async (c) => {
  const q = c.req.query("q") || "";
  const action = c.req.query("action") || "";
  const from = parseDateParam(c.req.query("from") || null);
  const clauses = ["1=1"];
  const binds: unknown[] = [];
  if (q.trim()) {
    clauses.push("(COALESCE(actor_username,'') LIKE ? ESCAPE '\\' OR action LIKE ? ESCAPE '\\' OR COALESCE(target_id,'') LIKE ? ESCAPE '\\')");
    binds.push(like(q), like(q), like(q));
  }
  if (action.trim()) {
    clauses.push("action LIKE ? ESCAPE '\\'");
    binds.push(like(action));
  }
  if (from) {
    clauses.push("created_at >= ?");
    binds.push(from);
  }
  return ok(await all(c.env.DB.prepare(`SELECT * FROM audit_logs WHERE ${clauses.join(" AND ")} ORDER BY created_at DESC LIMIT 200`).bind(...binds)));
});

app.notFound((c) => c.env.ASSETS.fetch(c.req.raw));

async function handleMailSend(env: Env, emailId: string) {
  const email = await first<EmailRow>(env.DB.prepare("SELECT * FROM emails WHERE id = ?").bind(emailId));
  if (!email || email.direction !== "outbound") return;
  if (email.status === "sent" || email.status === "processing") return;
  await env.DB.prepare("UPDATE emails SET status = 'processing', updated_at = ? WHERE id = ? AND status != 'sent'").bind(now(), emailId).run();
  try {
    if (!env.RESEND_API_KEY) throw new Error("RESEND_API_KEY is not configured");
    const attachments = await all<{ filename: string; content_type: string | null; r2_key: string }>(
      env.DB.prepare("SELECT filename, content_type, r2_key FROM attachments WHERE email_id = ?").bind(emailId)
    );
    const resendAttachments = [];
    for (const att of attachments) {
      const object = await env.MAIL_BUCKET.get(att.r2_key);
      if (!object) continue;
      const bytes = new Uint8Array(await object.arrayBuffer());
      let binary = "";
      for (const byte of bytes) binary += String.fromCharCode(byte);
      resendAttachments.push({ filename: att.filename, content: btoa(binary), content_type: att.content_type || "application/octet-stream" });
    }
    const payload = {
      from: email.from_addr,
      to: parseCsvAddresses(email.to_addr),
      cc: parseCsvAddresses(email.cc),
      bcc: parseCsvAddresses(email.bcc),
      subject: email.subject || "(no subject)",
      text: email.text_body || undefined,
      html: sanitizeHtml(email.html_body) || undefined,
      attachments: resendAttachments.length ? resendAttachments : undefined
    };
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const data = (await res.json().catch(() => ({}))) as { id?: string; message?: string; error?: string };
    if (!res.ok) throw new Error(data.message || data.error || `Resend failed: ${res.status}`);
    await env.DB.prepare("UPDATE emails SET status = 'sent', resend_id = ?, error = NULL, updated_at = ? WHERE id = ?").bind(data.id || null, now(), emailId).run();
    await env.DB.prepare("UPDATE send_logs SET status = 'sent', provider_message_id = ?, error = NULL WHERE email_id = ?").bind(data.id || null, emailId).run();
    await incrementCounter(env, email.user_id, "send", 1, 0);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown send error";
    const retry = email.retry_count + 1;
    const status = retry < 3 ? "retrying" : "failed";
    await env.DB.prepare("UPDATE emails SET status = ?, retry_count = ?, error = ?, updated_at = ? WHERE id = ?").bind(status, retry, message, now(), emailId).run();
    await env.DB.prepare("UPDATE send_logs SET status = ?, error = ? WHERE email_id = ?").bind(status, message, emailId).run();
    if (retry < 3) throw error;
  }
}

async function handleMailParse(env: Env, emailId: string) {
  const email = await first<EmailRow>(env.DB.prepare("SELECT * FROM emails WHERE id = ?").bind(emailId));
  if (!email || email.direction !== "inbound" || email.status === "parsed") return;
  await env.DB.prepare("UPDATE emails SET status = 'processing', updated_at = ? WHERE id = ?").bind(now(), emailId).run();
  try {
    if (!email.raw_r2_key) throw new Error("Missing raw_r2_key");
    const object = await env.MAIL_BUCKET.get(email.raw_r2_key);
    if (!object) throw new Error("Raw email object missing");
    const parsed = await PostalMime.parse(await object.arrayBuffer());
    const ts = now();
    const user = await first<AppUser>(env.DB.prepare("SELECT * FROM users WHERE id = ?").bind(email.user_id));
    for (const att of parsed.attachments || []) {
      const filename = sanitizeFilename(att.filename || "attachment.bin");
      if (hasDangerousExtension(filename)) continue;
      const bytes = att.content instanceof ArrayBuffer ? att.content.byteLength : att.content.length;
      const contentType = att.mimeType || "application/octet-stream";
      try {
        const scanBytes = att.content instanceof ArrayBuffer
          ? att.content
          : typeof att.content === "string"
            ? new TextEncoder().encode(att.content).buffer
            : new Uint8Array(att.content).slice().buffer;
        await scanAttachment(env, { name: filename, contentType, size: bytes, bytes: scanBytes });
      } catch {
        continue;
      }
      if (user) {
        const limited = await enforceAttachmentLimit(env, user, bytes);
        if (limited) continue;
      }
      const attachmentId = id("att");
      const key = `mail-sub/attachments/inbound/${email.user_id}/${emailId}/${attachmentId}-${filename}`;
      await env.MAIL_BUCKET.put(key, att.content, { httpMetadata: { contentType } });
      await env.DB.prepare(
        "INSERT INTO attachments (id, user_id, email_id, direction, filename, content_type, size_bytes, r2_key, file_type, scan_status, created_at) VALUES (?, ?, ?, 'inbound', ?, ?, ?, ?, ?, 'passed', ?)"
      )
        .bind(attachmentId, email.user_id, emailId, filename, contentType, bytes, key, fileType(filename, contentType), ts)
        .run();
      await incrementCounter(env, email.user_id, "attachment", 1, bytes);
    }
    await env.DB.prepare(
      "UPDATE emails SET from_addr = COALESCE(?, from_addr), subject = COALESCE(?, subject), text_body = ?, html_body = ?, status = 'parsed', error = NULL, updated_at = ? WHERE id = ?"
    )
      .bind(parsed.from?.address || null, cleanHeader(parsed.subject), parsed.text || "", sanitizeHtml(parsed.html || ""), ts, emailId)
      .run();
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown parse error";
    await env.DB.prepare("UPDATE emails SET status = 'failed', error = ?, updated_at = ? WHERE id = ?").bind(message, now(), emailId).run();
    throw error;
  }
}

async function handleAgentGenerate(env: Env, jobId: string) {
  const job = await first<AgentJobRow>(env.DB.prepare("SELECT * FROM agent_jobs WHERE id = ?").bind(jobId));
  if (!job || job.status === "succeeded" || job.status === "processing") return;
  await env.DB.prepare("UPDATE agent_jobs SET status = 'processing', updated_at = ? WHERE id = ?").bind(now(), jobId).run();
  try {
    if (!env.GEMINI_API_KEY) throw new Error("GEMINI_API_KEY is not configured");
    const prompt =
      `You are an email writing assistant. Command: ${job.command}\n` +
      "Return only the email content or requested suggestion, without markdown fences.\n\n" +
      `Input:\n${job.input || ""}`;
    const model = job.model || env.GEMINI_MODEL || "gemini-1.5-flash";
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${env.GEMINI_API_KEY}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: prompt }] }] })
    });
    const data = (await res.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
      usageMetadata?: { totalTokenCount?: number };
      error?: { message?: string };
    };
    if (!res.ok) throw new Error(data.error?.message || `Gemini failed: ${res.status}`);
    const output = data.candidates?.[0]?.content?.parts?.map((part) => part.text || "").join("\n").trim() || "";
    const tokens = data.usageMetadata?.totalTokenCount || job.estimated_tokens || 0;
    await consumeQuota(env, job.user_id, tokens);
    await incrementCounter(env, job.user_id, "tokens", tokens, 0);
    await incrementCounter(env, job.user_id, "agent", 1, 0);
    await env.DB.prepare("UPDATE agent_jobs SET output = ?, actual_tokens = ?, quota_reported = 1, status = 'succeeded', error = NULL, updated_at = ? WHERE id = ?")
      .bind(output, tokens, now(), jobId)
      .run();
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown agent error";
    const retry = job.retry_count + 1;
    const status = retry < 2 ? "retrying" : "failed";
    await env.DB.prepare("UPDATE agent_jobs SET status = ?, retry_count = ?, error = ?, updated_at = ? WHERE id = ?").bind(status, retry, message, now(), jobId).run();
    if (retry < 2) throw error;
  }
}

async function receiveEmail(message: ForwardableEmailMessage, env: Env) {
  const reject = (reason: string) => (message as unknown as { reject: (reason: string) => void }).reject(reason);
  const to = message.to.toLowerCase();
  const mailbox = await first<MailboxRow>(env.DB.prepare("SELECT * FROM mailboxes WHERE email = ?").bind(to));
  if (!mailbox || !["active", "receive_only"].includes(mailbox.status)) {
    reject("Mailbox unavailable");
    return;
  }
  const user = await first<AppUser>(env.DB.prepare("SELECT * FROM users WHERE id = ?").bind(mailbox.user_id));
  if (!user || user.status === "frozen") {
    reject("User unavailable");
    return;
  }
  const limited = await enforceDailyLimit(env, user, "receive");
  if (limited) {
    reject("Receive limit exceeded");
    return;
  }
  const emailId = id("eml");
  const ts = now();
  const rawKey = `mail-sub/raw/inbound/${ts.slice(0, 10)}/${emailId}.eml`;
  const raw = await new Response(message.raw).arrayBuffer();
  await env.MAIL_BUCKET.put(rawKey, raw, { httpMetadata: { contentType: "message/rfc822" } });
  await env.DB.prepare(
    "INSERT INTO emails (id, user_id, mailbox_id, direction, from_addr, to_addr, subject, raw_r2_key, status, created_at, updated_at) VALUES (?, ?, ?, 'inbound', ?, ?, ?, ?, 'pending', ?, ?)"
  )
    .bind(emailId, mailbox.user_id, mailbox.id, cleanHeader(message.from), to, cleanHeader(message.headers.get("subject") || ""), rawKey, ts, ts)
    .run();
  await incrementCounter(env, mailbox.user_id, "receive", 1, raw.byteLength);
  await audit(env, null, "email.receive_requested", "email", emailId, { to, from: message.from });
  await env.MAIL_PARSE_QUEUE.send({ kind: "mail-parse", id: emailId } satisfies QueueBody);
}

export default {
  fetch: app.fetch,
  async email(message: ForwardableEmailMessage, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(receiveEmail(message, env));
  },
  async queue(batch: MessageBatch<QueueBody>, env: Env) {
    for (const message of batch.messages) {
      try {
        if (message.body.kind === "mail-send" || batch.queue === "mail-send-queue") await handleMailSend(env, message.body.id);
        if (message.body.kind === "mail-parse" || batch.queue === "mail-parse-queue") await handleMailParse(env, message.body.id);
        if (message.body.kind === "agent-generate" || batch.queue === "agent-generate-queue") await handleAgentGenerate(env, message.body.id);
        message.ack();
      } catch {
        message.retry();
      }
    }
  }
} satisfies ExportedHandler<Env, QueueBody>;
