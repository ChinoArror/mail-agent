import React, { useEffect, useRef, useState } from "react";

/* ---------- Types ---------------------------------------------------------- */
export type Role = "admin" | "user";
export type ApiResponse<T> = { ok: true; data: T } | { ok: false; error: { code: string; message: string } };
export type ThemeMode = "light" | "dark" | "system";

export interface User {
  id: string;
  username: string;
  role: Role;
  app_role_id?: string;
  app_role_key?: string;
  app_role_name?: string;
  permissions?: string[];
  draft_retention_days?: number;
  name?: string;
  avatar_url?: string;
  display_name?: string;
  language?: string;
  theme?: ThemeMode;
}

export interface Mailbox {
  id: string;
  email: string;
  local_part: string;
  alias?: string;
  status: string;
  username?: string;
  inbound_count?: number;
  outbound_count?: number;
  attachment_bytes?: number;
  created_at: string;
}

export interface EmailItem {
  id: string;
  direction: "inbound" | "outbound";
  from_addr: string;
  to_addr: string;
  subject: string;
  text_body?: string;
  html_body?: string;
  status: string;
  is_read?: number;
  is_starred?: number;
  folder?: string;
  error?: string;
  attachment_count?: number;
  attachments?: Attachment[];
  created_at: string;
}

export interface Draft {
  id: string;
  mailbox_id?: string;
  to_addr?: string;
  cc?: string;
  bcc?: string;
  subject?: string;
  text_body?: string;
  html_body?: string;
  updated_at: string;
  attachments?: Attachment[];
}

export interface Attachment {
  id: string;
  email_id?: string;
  draft_id?: string;
  direction?: string;
  filename: string;
  content_type: string;
  file_type?: string;
  size_bytes: number;
  email_subject?: string;
  email_direction?: string;
  draft_subject?: string;
  owner_username?: string;
  created_at: string;
}

export interface AgentJob {
  id: string;
  status: string;
  output?: string;
  error?: string;
  actual_tokens?: number;
}

export interface LandingSettings {
  mode: "wave" | "image";
  title: string;
  tagline: string;
  show_features: boolean;
  waves_over_image: boolean;
  wave_opacity: number;
}

export interface LoadingSettings {
  style: "steps" | "minimal";
  title: string;
  subtitle: string;
  show_progress: boolean;
  show_waves: boolean;
}

export const DEFAULT_LANDING: LandingSettings = {
  mode: "wave",
  title: "Mail Agent",
  tagline: "Temporary mail with real delivery, drafts and AI assist.",
  show_features: true,
  waves_over_image: true,
  wave_opacity: 1
};

export const DEFAULT_LOADING: LoadingSettings = {
  style: "steps",
  title: "Signing you in",
  subtitle: "This usually takes a second.",
  show_progress: true,
  show_waves: true
};

export interface PublicConfig {
  app_id: string;
  app_uuid?: string;
  auth_center_url: string;
  callback_url: string;
  landing_background_url?: string;
  landing_background_opacity?: number;
  landing?: LandingSettings;
  loading?: LoadingSettings;
}

/* ---------- API ------------------------------------------------------------ */
export const tokenKey = "mail_agent_sso_token";

export class ApiError extends Error {
  constructor(message: string, public status: number, public code = "") {
    super(message);
  }
}

const authHeaders = (init?: HeadersInit) => {
  const headers = new Headers(init);
  const token = localStorage.getItem(tokenKey);
  if (token) headers.set("Authorization", `Bearer ${token}`);
  return headers;
};

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = authHeaders(init.headers);
  if (!(init.body instanceof FormData) && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  let res: Response;
  try {
    res = await fetch(path, { ...init, headers });
  } catch {
    throw new ApiError("Network error — check your connection", 0, "NETWORK");
  }
  const json = (await res.json().catch(() => null)) as ApiResponse<T> | null;
  if (!json || !json.ok) {
    const message = (json && !json.ok && json.error?.message) || `HTTP ${res.status}`;
    // The session shell decides what to do (verification notice → re-verify → reload).
    if (res.status === 401 && path !== "/api/me") window.dispatchEvent(new CustomEvent("auth-failed", { detail: { path } }));
    throw new ApiError(message, res.status, json && !json.ok ? json.error?.code : "");
  }
  return json.data;
}

/** Authenticated GET → Blob, reporting download progress when Content-Length is known. */
export async function fetchBlob(path: string, onProgress?: (fraction: number | null) => void): Promise<Blob> {
  const res = await fetch(path, { headers: authHeaders() });
  if (!res.ok) throw new ApiError(res.status === 404 ? "File not found" : `Download failed (HTTP ${res.status})`, res.status);
  const total = Number(res.headers.get("Content-Length") || 0);
  if (!res.body || !onProgress) return res.blob();
  const reader = res.body.getReader();
  const chunks: BlobPart[] = [];
  let received = 0;
  onProgress(total ? 0 : null);
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value as BlobPart);
    received += value.byteLength;
    onProgress(total ? received / total : null);
  }
  return new Blob(chunks, { type: res.headers.get("Content-Type") || "application/octet-stream" });
}

/** multipart upload with upload progress (fetch cannot report upload progress). */
export function uploadForm<T>(path: string, form: FormData, onProgress?: (fraction: number) => void, method = "POST"): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open(method, path);
    const token = localStorage.getItem(tokenKey);
    if (token) xhr.setRequestHeader("Authorization", `Bearer ${token}`);
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgress?.(e.loaded / e.total); };
    xhr.onerror = () => reject(new ApiError("Network error — upload interrupted", 0, "NETWORK"));
    xhr.onload = () => {
      let json: ApiResponse<T> | null = null;
      try { json = JSON.parse(xhr.responseText); } catch { /* ignore */ }
      if (json && json.ok) resolve(json.data);
      else {
        if (xhr.status === 401) window.dispatchEvent(new CustomEvent("auth-failed", { detail: { path } }));
        reject(new ApiError((json && !json.ok && json.error?.message) || `HTTP ${xhr.status}`, xhr.status));
      }
    };
    xhr.send(form);
  });
}

export function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const CONFIG_CACHE = "mail_agent_public_config";

/** Last known public config — lets the sign-in / loading screens render their configured look instantly. */
export function cachedPublicConfig(): PublicConfig | null {
  try {
    return JSON.parse(localStorage.getItem(CONFIG_CACHE) || "null");
  } catch {
    return null;
  }
}

export async function getPublicConfig(): Promise<PublicConfig> {
  const fallback: PublicConfig = cachedPublicConfig() || { app_id: "mail-agent", auth_center_url: "https://accounts.aryuki.com", callback_url: `${window.location.origin}/sso-callback` };
  try {
    const config = await api<PublicConfig>("/api/public-config");
    localStorage.setItem(CONFIG_CACHE, JSON.stringify(config));
    return config;
  } catch {
    return fallback;
  }
}

/** Seconds until the stored JWT expires (negative = already expired), or null when unknown. */
export function tokenSecondsLeft(token = localStorage.getItem(tokenKey)): number | null {
  const part = token?.split(".")[1];
  if (!part) return null;
  try {
    const json = JSON.parse(atob(part.replace(/-/g, "+").replace(/_/g, "/").padEnd(part.length + ((4 - (part.length % 4)) % 4), "=")));
    return typeof json.exp === "number" ? json.exp - Date.now() / 1000 : null;
  } catch {
    return null;
  }
}

/** Auth Center sign-in URL (unified sign-in, 2026-09-30): /login?app_id=…&redirect=… */
export function authLoginUrl(config: Pick<PublicConfig, "auth_center_url" | "app_id" | "callback_url">) {
  return `${config.auth_center_url.replace(/\/$/, "")}/login?app_id=${encodeURIComponent(config.app_id)}&redirect=${encodeURIComponent(config.callback_url)}`;
}

/* ---------- Routing -------------------------------------------------------- */
export const routeFromHash = () => window.location.hash.replace(/^#\/?/, "") || "mailboxes";
export const setRoute = (route: string) => {
  window.location.hash = route;
};

/* ---------- Data hook ------------------------------------------------------ */
export function useAsync<T>(loader: () => Promise<T>, deps: React.DependencyList, options: { keepStale?: boolean } = {}) {
  const keepStale = options.keepStale ?? true;
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const seq = useRef(0);
  const reload = async () => {
    const mine = ++seq.current;
    setLoading(true);
    setError("");
    try {
      const next = await loader();
      if (mine === seq.current) setData(next);
    } catch (err) {
      if (mine === seq.current) setError(err instanceof Error ? err.message : "Failed to load");
    } finally {
      if (mine === seq.current) setLoading(false);
    }
  };
  useEffect(() => {
    if (!keepStale) setData(null);
    void reload();
  }, deps);
  return { data, error, loading, reload, setData };
}

/* ---------- Formatting ----------------------------------------------------- */
export function formatBytes(bytes = 0) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

export const formatDate = (value: string) => new Date(value).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });

export function formatRelative(value: string) {
  const diff = Date.now() - new Date(value).getTime();
  const min = Math.round(diff / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h}h ago`;
  const d = new Date(value);
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", ...(sameYear ? {} : { year: "numeric" }) });
}

export const formatTime = (value: string) => new Date(value).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });

/* ---------- Roles ---------------------------------------------------------- */
const systemRoleLabels: Record<string, { name: string; description: string }> = {
  admin: { name: "Administrator", description: "Full administrative access" },
  user: { name: "User", description: "Default temporary mailbox access" },
  readonly: { name: "Read only", description: "View mail and attachments only" }
};
export const roleName = (role: { app_role_key?: string; role_key?: string; app_role_name?: string; name?: string; role?: string }) =>
  systemRoleLabels[role.app_role_key || role.role_key || ""]?.name || role.app_role_name || role.name || role.role || "User";
export const roleDescription = (role: { role_key?: string; description?: string }) =>
  systemRoleLabels[role.role_key || ""]?.description || role.description || "No description";

/* ---------- Theme (D5 circular reveal) ------------------------------------ */
export function readTheme(): ThemeMode {
  const t = localStorage.getItem("theme");
  return t === "dark" || t === "light" ? t : "system";
}

export function resolveDark(mode: ThemeMode) {
  return mode === "dark" || (mode === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
}

export function applyTheme(mode: ThemeMode, origin?: { x: number; y: number }) {
  localStorage.setItem("theme", mode === "system" ? "" : mode);
  const dark = resolveDark(mode);
  const root = document.documentElement;
  if (root.classList.contains("dark") === dark) return;
  const swap = () => root.classList.toggle("dark", dark);
  const doc = document as Document & { startViewTransition?: (cb: () => void) => unknown };
  if (!doc.startViewTransition || motionLevel() !== "full" || !readPrefs().themeReveal) return swap();
  const x = origin?.x ?? window.innerWidth - 40;
  const y = origin?.y ?? 32;
  root.style.setProperty("--vt-x", `${x}px`);
  root.style.setProperty("--vt-y", `${y}px`);
  root.style.setProperty("--vt-r", `${Math.hypot(Math.max(x, window.innerWidth - x), Math.max(y, window.innerHeight - y))}px`);
  doc.startViewTransition(swap);
}

export function useThemeMode() {
  const [mode, setMode] = useState<ThemeMode>(readTheme);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => { if (readTheme() === "system") applyTheme("system"); };
    mq.addEventListener("change", onChange);
    const onStorage = () => setMode(readTheme());
    window.addEventListener("theme-change", onStorage);
    return () => {
      mq.removeEventListener("change", onChange);
      window.removeEventListener("theme-change", onStorage);
    };
  }, []);
  const set = (next: ThemeMode, origin?: { x: number; y: number }) => {
    applyTheme(next, origin);
    setMode(next);
    window.dispatchEvent(new Event("theme-change"));
  };
  return [mode, set] as const;
}

/* ---------- Appearance preferences (per device) --------------------------- */
export type AccentName = "sky" | "blue" | "violet" | "rose" | "emerald" | "amber" | "orange" | "custom";
export type MotionPref = "system" | "full" | "reduced" | "off";

export interface Prefs {
  accent: AccentName;
  /** Hue used when accent === "custom" (0–360). */
  hue: number;
  darkStyle: "night" | "black";
  density: "comfortable" | "compact";
  contrast: "normal" | "high";
  motion: MotionPref;
  loginWaves: boolean;
  themeReveal: boolean;
}

/** Light / dark lightness–chroma pairs per preset (dark raises L and drops C so the accent glows without vibrating). */
export const ACCENTS: Record<Exclude<AccentName, "custom">, { label: string; hue: number; light: [number, number]; dark: [number, number] }> = {
  sky: { label: "Sky", hue: 230, light: [68.5, 0.155], dark: [75, 0.14] },
  blue: { label: "Blue", hue: 262, light: [58, 0.19], dark: [70, 0.15] },
  violet: { label: "Violet", hue: 292, light: [58, 0.2], dark: [72, 0.16] },
  rose: { label: "Rose", hue: 12, light: [62, 0.2], dark: [72, 0.16] },
  emerald: { label: "Emerald", hue: 160, light: [62, 0.15], dark: [74, 0.14] },
  amber: { label: "Amber", hue: 72, light: [72, 0.16], dark: [80, 0.15] },
  orange: { label: "Orange", hue: 45, light: [66, 0.18], dark: [75, 0.16] }
};

export const DEFAULT_PREFS: Prefs = { accent: "sky", hue: 230, darkStyle: "night", density: "comfortable", contrast: "normal", motion: "system", loginWaves: true, themeReveal: true };
const PREFS_KEY = "mail_agent_prefs";

export function readPrefs(): Prefs {
  try {
    return { ...DEFAULT_PREFS, ...JSON.parse(localStorage.getItem(PREFS_KEY) || "{}") };
  } catch {
    return DEFAULT_PREFS;
  }
}

/** Effective motion level: the app setting, falling back to the OS preference. */
export function motionLevel(prefs = readPrefs()): "full" | "reduced" | "off" {
  if (prefs.motion !== "system") return prefs.motion;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "reduced" : "full";
}

/** Writes prefs onto <html> as data attributes + accent custom properties. Mirrored in index.html for first paint. */
export function applyPrefs(prefs: Prefs) {
  const root = document.documentElement;
  const preset = prefs.accent === "custom" ? null : ACCENTS[prefs.accent];
  const hue = preset ? preset.hue : prefs.hue;
  const [ll, lc] = preset ? preset.light : [64, 0.17];
  const [dl, dc] = preset ? preset.dark : [74, 0.15];
  root.style.setProperty("--accent-h", String(hue));
  root.style.setProperty("--accent-l", `${ll}%`);
  root.style.setProperty("--accent-c", String(lc));
  root.style.setProperty("--accent-dl", `${dl}%`);
  root.style.setProperty("--accent-dc", String(dc));
  root.dataset.darkIntensity = prefs.darkStyle;
  root.dataset.density = prefs.density;
  root.dataset.contrast = prefs.contrast;
  root.dataset.motion = motionLevel(prefs);
}

export function usePrefs() {
  const [prefs, setPrefs] = useState<Prefs>(readPrefs);
  useEffect(() => {
    const sync = () => setPrefs(readPrefs());
    window.addEventListener("prefs-change", sync);
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onMotion = () => applyPrefs(readPrefs());
    mq.addEventListener("change", onMotion);
    return () => {
      window.removeEventListener("prefs-change", sync);
      mq.removeEventListener("change", onMotion);
    };
  }, []);
  const update = (patch: Partial<Prefs>) => {
    const next = { ...readPrefs(), ...patch };
    localStorage.setItem(PREFS_KEY, JSON.stringify(next));
    applyPrefs(next);
    setPrefs(next);
    window.dispatchEvent(new Event("prefs-change"));
  };
  const reset = () => update(DEFAULT_PREFS);
  return [prefs, update, reset] as const;
}

/* ---------- Per-account sync of appearance preferences --------------------- *
 * Local storage keeps first paint instant; the account copy (GET/PUT /api/me/preferences)
 * is the source of truth, so every account carries its own look across devices.
 */
type SyncState = "idle" | "saving" | "saved" | "offline";
interface SyncMeta { userId: string; dirty: boolean; savedAt?: string }
const SYNC_KEY = "mail_agent_prefs_sync";
let syncUserId = "";
let syncTimer = 0;
let applyingRemote = false;
let syncState: SyncState = "idle";
let lastSavedAt = "";

const readSyncMeta = (): SyncMeta | null => {
  try { return JSON.parse(localStorage.getItem(SYNC_KEY) || "null"); } catch { return null; }
};
const writeSyncMeta = (meta: SyncMeta) => localStorage.setItem(SYNC_KEY, JSON.stringify(meta));
const setSyncState = (state: SyncState) => {
  syncState = state;
  window.dispatchEvent(new Event("prefs-sync"));
};

/** Everything that makes up "my look": appearance prefs + light/dark mode. */
function snapshotPrefs() {
  return { ...readPrefs(), theme: readTheme() };
}

function applyRemotePrefs(remote: Partial<Prefs> & { theme?: ThemeMode }) {
  applyingRemote = true;
  try {
    const { theme, ...rest } = remote;
    const next = { ...DEFAULT_PREFS, ...rest };
    localStorage.setItem(PREFS_KEY, JSON.stringify(next));
    applyPrefs(next);
    window.dispatchEvent(new Event("prefs-change"));
    if (theme && theme !== readTheme()) {
      applyTheme(theme);
      window.dispatchEvent(new Event("theme-change"));
    }
  } finally {
    applyingRemote = false;
  }
}

async function pushPrefs() {
  if (!syncUserId) return;
  setSyncState("saving");
  try {
    const res = await api<{ updated_at: string }>("/api/me/preferences", { method: "PUT", body: JSON.stringify({ prefs: snapshotPrefs() }) });
    lastSavedAt = res.updated_at;
    writeSyncMeta({ userId: syncUserId, dirty: false, savedAt: res.updated_at });
    setSyncState("saved");
  } catch {
    // Keep the change locally and retry on the next edit / sign-in.
    writeSyncMeta({ userId: syncUserId, dirty: true, savedAt: lastSavedAt });
    setSyncState("offline");
  }
}

function scheduleSync() {
  if (applyingRemote || !syncUserId) return;
  writeSyncMeta({ userId: syncUserId, dirty: true, savedAt: lastSavedAt });
  setSyncState("saving");
  window.clearTimeout(syncTimer);
  syncTimer = window.setTimeout(() => void pushPrefs(), 700);
}

/** Called once the signed-in user is known. */
export async function startPrefsSync(userId: string) {
  if (syncUserId === userId) return;
  syncUserId = userId;
  window.addEventListener("prefs-change", scheduleSync);
  window.addEventListener("theme-change", scheduleSync);
  const meta = readSyncMeta();
  const sameUser = meta?.userId === userId;
  try {
    const res = await api<{ prefs: (Partial<Prefs> & { theme?: ThemeMode }) | null; updated_at: string | null }>("/api/me/preferences");
    lastSavedAt = res.updated_at || "";
    if (sameUser && meta?.dirty) {
      // Edits made on this device while offline win; push them.
      await pushPrefs();
    } else if (res.prefs) {
      applyRemotePrefs(res.prefs);
      writeSyncMeta({ userId, dirty: false, savedAt: res.updated_at || undefined });
      setSyncState("saved");
    } else {
      // First time for this account: start from defaults if this device last belonged to someone else.
      if (!sameUser && meta) applyRemotePrefs({ ...DEFAULT_PREFS, theme: "system" });
      await pushPrefs();
    }
  } catch {
    setSyncState("offline");
  }
}

export function stopPrefsSync() {
  window.removeEventListener("prefs-change", scheduleSync);
  window.removeEventListener("theme-change", scheduleSync);
  syncUserId = "";
}

export function usePrefsSync() {
  const [state, setState] = useState<{ state: SyncState; savedAt: string }>({ state: syncState, savedAt: lastSavedAt });
  useEffect(() => {
    const on = () => setState({ state: syncState, savedAt: lastSavedAt });
    window.addEventListener("prefs-sync", on);
    return () => window.removeEventListener("prefs-sync", on);
  }, []);
  return { ...state, retry: () => void pushPrefs() };
}
