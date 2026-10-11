import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  Archive,
  BarChart3,
  Bot,
  Check,
  CheckSquare,
  ChevronRight,
  Copy,
  Database,
  Download,
  Eye,
  FileText,
  Gauge,
  Image,
  Inbox,
  KeyRound,
  Languages,
  LogOut,
  Mail,
  Menu,
  Moon,
  MoreHorizontal,
  Paperclip,
  PenLine,
  Plus,
  RefreshCw,
  Search,
  Send,
  Settings,
  Shield,
  SlidersHorizontal,
  Square,
  Sparkles,
  Star,
  Sun,
  Trash2,
  Upload,
  UserCog,
  Users,
  X
} from "lucide-react";
import "./styles.css";

type Role = "admin" | "user";
type ApiResponse<T> = { ok: true; data: T } | { ok: false; error: { code: string; message: string } };

interface User {
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
  theme?: "light" | "dark" | "system";
}

interface Mailbox {
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

interface EmailItem {
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

interface Draft {
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

interface Attachment {
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

interface AgentJob {
  id: string;
  status: string;
  output?: string;
  error?: string;
  actual_tokens?: number;
}

const tokenKey = "mail_agent_sso_token";
const systemRoleLabels: Record<string, { name: string; description: string }> = {
  admin: { name: "Administrator", description: "Full administrative access" },
  user: { name: "User", description: "Default temporary mailbox access" },
  readonly: { name: "Read only", description: "View mail and attachments only" }
};
const roleName = (role: { app_role_key?: string; role_key?: string; app_role_name?: string; name?: string; role?: string }) =>
  systemRoleLabels[role.app_role_key || role.role_key || ""]?.name || role.app_role_name || role.name || role.role || "User";
const roleDescription = (role: { role_key?: string; description?: string }) =>
  systemRoleLabels[role.role_key || ""]?.description || role.description || "No description";
const routeFromHash = () => window.location.hash.replace(/^#\/?/, "") || "mailboxes";
const setRoute = (route: string) => {
  window.location.hash = route;
};

async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = localStorage.getItem(tokenKey);
  const headers = new Headers(init.headers);
  if (token) headers.set("Authorization", `Bearer ${token}`);
  if (!(init.body instanceof FormData) && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  const res = await fetch(path, { ...init, headers });
  const json = (await res.json().catch(() => null)) as ApiResponse<T> | null;
  if (!json || !json.ok) {
    const message = json?.error?.message || `HTTP ${res.status}`;
    if (res.status === 401) localStorage.removeItem(tokenKey);
    throw new Error(message);
  }
  return json.data;
}

function useAsync<T>(loader: () => Promise<T>, deps: React.DependencyList) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const reload = async () => {
    setLoading(true);
    setError("");
    try {
      setData(await loader());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    void reload();
  }, deps);
  return { data, error, loading, reload };
}

function formatBytes(bytes = 0) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

const formatDate = (value: string) => new Date(value).toLocaleString("en-US");

function StatusPill({ value }: { value: string }) {
  return <span className={`pill ${value}`}>{value}</span>;
}

function EmptyState({ title, icon: Icon = Mail }: { title: string; icon?: React.ElementType }) {
  return (
    <div className="empty">
      <Icon size={28} />
      <span>{title}</span>
    </div>
  );
}

function Login() {
  const [bg, setBg] = useState<{ url: string; opacity: number }>({ url: "", opacity: 0.18 });
  useEffect(() => {
    api<any>("/api/public-config")
      .then((config) => setBg({ url: config.landing_background_url || "", opacity: Number(config.landing_background_opacity ?? 0.18) }))
      .catch(() => undefined);
  }, []);
  const login = async () => {
    const fallback = {
      app_id: "mail-agent",
      auth_center_url: "https://accounts.aryuki.com",
      callback_url: `${window.location.origin}/sso-callback`
    };
    const config = await api<typeof fallback>("/api/public-config").catch(() => fallback);
    window.location.href = `${config.auth_center_url}/?client_id=${encodeURIComponent(config.app_id)}&redirect=${encodeURIComponent(config.callback_url)}`;
  };
  return (
    <main className="login" style={bg.url ? { ["--landing-bg" as any]: `url(${bg.url})`, ["--landing-opacity" as any]: bg.opacity } : undefined}>
      <section className="login-shell">
        <div className="login-copy">
          <div className="brand-lockup">
            <span className="brand-mark"><Mail size={24} /></span>
            <strong>Mail Agent</strong>
          </div>
          <h1>Temp mail with real delivery, drafts, and AI assist.</h1>
          <p>Create temporary addresses, manage mail and attachments, and draft replies with Gemini Agent.</p>
          <div className="login-stats">
            <span><Check size={16} />D1</span>
            <span><Check size={16} />R2</span>
            <span><Check size={16} />Queues</span>
          </div>
        </div>
        <div className="login-panel">
          <div className="brand-mark">
            <Shield size={28} />
          </div>
          <h2>Secure sign-in</h2>
          <p>Auth Center sign-in protects every API request with server-side identity and permission checks.</p>
          <button className="primary" onClick={login}>
            <Shield size={18} />
            Sign in with Auth Center
          </button>
        </div>
      </section>
    </main>
  );
}

function Callback({ onDone }: { onDone: () => void }) {
  const [message, setMessage] = useState("Completing sign-in...");
  useEffect(() => {
    const token = new URLSearchParams(window.location.search).get("token");
    if (!token) {
      setMessage("Sign-in callback is missing a token");
      return;
    }
    api<{ token: string }>("/api/sso-callback", { method: "POST", body: JSON.stringify({ token }) })
      .then(() => {
        localStorage.setItem(tokenKey, token);
        window.history.replaceState({}, "", "/");
        onDone();
      })
      .catch((err) => setMessage(err instanceof Error ? err.message : "Sign-in failed"));
  }, []);
  return (
    <main className="login">
      <section className="login-panel">
        <RefreshCw className="spin" size={28} />
        <p>{message}</p>
      </section>
    </main>
  );
}

function Shell({ user, onLogout }: { user: User; onLogout: () => void }) {
  const [route, setLocalRoute] = useState(routeFromHash());
  const [dark, setDark] = useState(localStorage.getItem("theme") === "dark");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  useEffect(() => {
    const fn = () => setLocalRoute(routeFromHash());
    window.addEventListener("hashchange", fn);
    return () => window.removeEventListener("hashchange", fn);
  }, []);
  useEffect(() => setSidebarOpen(false), [route]);
  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
    localStorage.setItem("theme", dark ? "dark" : "light");
  }, [dark]);

  const nav = [
    ["mailboxes", "Mailboxes", Mail],
    ["inbox", "Inbox", Inbox],
    ["sent", "Sent", Send],
    ["starred", "Starred", Star],
    ["compose", "Compose", PenLine],
    ["drafts", "Drafts", FileText],
    ["attachments", "Attachments", Paperclip],
    ["usage", "Usage", BarChart3],
    ["settings", "Personal settings", Settings]
  ] as const;
  const adminNav = [
    ["admin-analysis", "Analytics", BarChart3],
    ["admin-users", "Users", Users],
    ["admin-mailboxes", "Messages", Archive],
    ["admin-roles", "Access control", KeyRound],
    ["admin-system", "System settings", SlidersHorizontal],
    ["admin-audit", "System logs", Shield]
  ] as const;

  const can = (key: string) => user.role === "admin" || (user.permissions || []).includes(key);
  const visibleNav = nav.filter(([key]) => {
    if (key === "inbox" || key === "sent" || key === "starred") return can("emails");
    if (key === "compose" || key === "drafts") return can("drafts");
    return can(key);
  });
  const visibleAdminNav = adminNav.filter(([key]) => {
    if (key === "admin-users") return can("users");
    if (key === "admin-mailboxes") return can("emails") || can("mailboxes");
    if (key === "admin-analysis") return can("analysis");
    if (key === "admin-roles") return can("roles");
    if (key === "admin-system") return can("system");
    if (key === "admin-audit") return can("audit");
    return true;
  });

  return (
    <div className="app">
      {sidebarOpen && <button className="sidebar-scrim" aria-label="Close navigation" onClick={() => setSidebarOpen(false)} />}
      <aside className={`sidebar ${sidebarOpen ? "open" : ""}`}>
        <button className="brand" onClick={() => setRoute("mailboxes")}>
          <span className="brand-icon"><Mail size={21} /></span>
          <span>Mail Agent</span>
        </button>
        <nav>
          {visibleNav.map(([key, label, Icon]) => (
            <button key={key} className={route.startsWith(key) ? "active" : ""} onClick={() => setRoute(key)}>
              <Icon size={18} />
              {label}
            </button>
          ))}
        </nav>
        {user.role === "admin" && (
          <div className="admin-nav">
            <span>Admin</span>
            {visibleAdminNav.map(([key, label, Icon]) => (
              <button key={key} className={route.startsWith(key) ? "active" : ""} onClick={() => setRoute(key)}>
                <Icon size={18} />
                {label}
              </button>
            ))}
          </div>
        )}
      </aside>
      <div className="main">
        <header className="topbar">
          <button className="icon-button menu-button" aria-label="Open navigation" onClick={() => setSidebarOpen(true)}><Menu size={19} /></button>
          <div className="page-title"><strong>{routeLabel(route)}</strong></div>
          <GlobalSearch label={routeLabel(route)} />
          <div className="top-actions">
            <button className="round-primary" title="Compose" onClick={() => setRoute("compose")}><PenLine size={18} /></button>
            <button className="icon-button" aria-label="Toggle theme" onClick={() => setDark(!dark)}>{dark ? <Sun size={18} /> : <Moon size={18} />}</button>
            <div className="avatar">{user.avatar_url ? <img src={user.avatar_url} alt={user.username} /> : user.username.slice(0, 1).toUpperCase()}</div>
            <strong>{user.username}</strong>
            <button className="icon-button" aria-label="Sign out" onClick={onLogout}><LogOut size={18} /></button>
          </div>
        </header>
        <section className="content">
          <RouteView route={route} user={user} />
        </section>
      </div>
    </div>
  );
}

function GlobalSearch({ label }: { label: string }) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<any | null>(null);
  useEffect(() => {
    if (q.trim().length < 2) {
      setResults(null);
      return;
    }
    const timer = window.setTimeout(() => {
      api(`/api/global-search?q=${encodeURIComponent(q)}`).then(setResults).catch(() => setResults(null));
    }, 250);
    return () => window.clearTimeout(timer);
  }, [q]);
  const count = results ? Object.values(results).reduce((sum: number, rows: any) => sum + (Array.isArray(rows) ? rows.length : 0), 0) : 0;
  return (
    <div className="global-search">
      <Search size={16} />
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={`${label} · Search`} />
      {results && (
        <div className="search-popover">
          {!count && <span className="muted">No results</span>}
          {!!results.mailboxes?.length && <SearchGroup title="Mailbox" rows={results.mailboxes} render={(row: any) => <button onClick={() => { setRoute("mailboxes"); setQ(""); }}>{row.email}<small>{row.alias}</small></button>} />}
          {!!results.emails?.length && <SearchGroup title="Mail" rows={results.emails} render={(row: any) => <button onClick={() => { setRoute(`email:${row.id}`); setQ(""); }}>{row.subject || "(no subject)"}<small>{row.from_addr || row.to_addr}</small></button>} />}
          {!!results.attachments?.length && <SearchGroup title="Attachments" rows={results.attachments} render={(row: any) => <button onClick={() => { setRoute("attachments"); setQ(""); }}>{row.filename}<small>{formatBytes(row.size_bytes)}</small></button>} />}
          {!!results.users?.length && <SearchGroup title="Users" rows={results.users} render={(row: any) => <button onClick={() => { setRoute("admin-users"); setQ(""); }}>{row.username}<small>{row.status}</small></button>} />}
        </div>
      )}
    </div>
  );
}

function SearchGroup({ title, rows, render }: { title: string; rows: any[]; render: (row: any) => React.ReactNode }) {
  return <section><strong>{title}</strong>{rows.map((row) => <React.Fragment key={row.id}>{render(row)}</React.Fragment>)}</section>;
}

function routeLabel(route: string) {
  if (route.startsWith("email:")) return "Message details";
  if (route.startsWith("compose:")) return "Compose";
  const labels: Record<string, string> = {
    mailboxes: "Mailboxes",
    inbox: "Inbox",
    sent: "Sent",
    starred: "Starred",
    compose: "Compose",
    drafts: "Drafts",
    attachments: "Attachments",
    usage: "Usage / Quotas",
    settings: "Settings",
    "admin-users": "User management",
    "admin-mailboxes": "Mailboxes",
    "admin-analysis": "Analysis",
    "admin-roles": "Access control",
    "admin-system": "System settings",
    "admin-audit": "Audit logs"
  };
  return labels[route] || "Mail Agent";
}

function RouteView({ route, user }: { route: string; user: User }) {
  const can = (key: string) => user.role === "admin" || (user.permissions || []).includes(key);
  if (route.startsWith("email:")) {
    const [, id, from] = route.split(":");
    return <EmailDetail id={id} returnRoute={from === "attachments" ? "attachments" : undefined} />;
  }
  if (route.startsWith("compose:") && route.endsWith(":history")) return <DraftHistory draftId={route.slice(8, -8)} />;
  if (route.startsWith("compose:")) return can("drafts") ? <Compose draftId={route.slice(8)} /> : <EmptyState title="Your role cannot use Compose" icon={Shield} />;
  if (route === "inbox") return can("emails") ? <EmailList direction="inbound" /> : <EmptyState title="Your role cannot view mail" icon={Shield} />;
  if (route === "sent") return can("emails") ? <EmailList direction="outbound" /> : <EmptyState title="Your role cannot view Sent" icon={Shield} />;
  if (route === "starred") return can("emails") ? <EmailList starredOnly /> : <EmptyState title="Your role cannot view starred mail" icon={Shield} />;
  if (route === "compose") return can("drafts") ? <Compose /> : <EmptyState title="Your role cannot compose mail" icon={Shield} />;
  if (route === "drafts") return can("drafts") ? <Drafts /> : <EmptyState title="Your role cannot view drafts" icon={Shield} />;
  if (route === "attachments") return can("attachments") ? <Attachments user={user} /> : <EmptyState title="Your role cannot view attachments" icon={Shield} />;
  if (route === "usage") return can("usage") ? <Usage /> : <EmptyState title="Your role cannot view usage" icon={Shield} />;
  if (route === "settings") return <SettingsPage user={user} />;
  if (route === "admin-users") return can("users") ? <AdminUsers /> : <EmptyState title="Your role cannot manage users" icon={Shield} />;
  if (route === "admin-mailboxes") return can("emails") || can("mailboxes") ? <AdminMailboxes /> : <EmptyState title="Your role cannot manage mailboxes" icon={Shield} />;
  if (route === "admin-analysis") return can("analysis") ? <AdminAnalysis /> : <EmptyState title="Your role cannot view analytics" icon={Shield} />;
  if (route === "admin-roles") return can("roles") ? <AdminRoles /> : <EmptyState title="Your role cannot manage roles" icon={Shield} />;
  if (route === "admin-system") return can("system") ? <AdminSystemSettings /> : <EmptyState title="Your role cannot manage system settings" icon={Shield} />;
  if (route === "admin-audit") return can("audit") ? <AdminAudit /> : <EmptyState title="Your role cannot view audit logs" icon={Shield} />;
  return can("mailboxes") ? <Mailboxes /> : <EmptyState title="Your role cannot view mailboxes" icon={Shield} />;
}

function DraftHistory({ draftId }: { draftId: string }) {
  const { data, loading, error } = useAsync<any[]>(() => api(`/api/drafts/${draftId}/history`), [draftId]);
  if (loading) return <EmptyState title="Loading draft history" icon={RefreshCw} />;
  if (error) return <div className="alert">{error}</div>;
  return (
    <div className="stack">
      <div className="section-head">
        <h2>Draft history</h2>
        <button onClick={() => setRoute(`compose:${draftId}`)}><ChevronRight className="back" size={17} />Back to draft</button>
      </div>
      {!data?.length ? <EmptyState title="No previous versions" icon={FileText} /> : data.map((v) => (
        <article className="panel" key={v.id}>
          <strong>{v.subject || "(no subject)"}</strong>
          <small>{formatDate(v.created_at)}</small>
          <pre className="body-text">{v.text_body}</pre>
        </article>
      ))}
    </div>
  );
}

function Mailboxes() {
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState("created_desc");
  const { data, loading, error, reload } = useAsync<Mailbox[]>(() => api(`/api/mailboxes?q=${encodeURIComponent(query)}&sort=${sort}`), [query, sort]);
  const [selectedId, setSelectedId] = useState("");
  const [local, setLocal] = useState("");
  const [alias, setAlias] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const selected = useMemo(() => data?.find((box) => box.id === selectedId) || data?.[0], [data, selectedId]);
  const createMailbox = async () => {
    setBusy(true);
    setNotice("");
    try {
      await api("/api/mailboxes", { method: "POST", body: JSON.stringify({ local_part: local, alias }) });
      setLocal("");
      setAlias("");
      setCreateOpen(false);
      await reload();
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "Creation failed");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="mail-workbench">
      <aside className="mailbox-rail panel">
        <div className="section-head">
          <h2>Cloud Mail</h2>
          <button className="icon-button primary" disabled={busy} onClick={() => setCreateOpen(true)} title="New mailbox"><Plus size={18} /></button>
        </div>
        <div className="toolbar compact-toolbar">
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search mailbox or alias" />
          <select value={sort} onChange={(e) => setSort(e.target.value)} title="Order">
            <option value="created_desc">Newest</option>
            <option value="created_asc">Oldest</option>
            <option value="local_part">Address</option>
            <option value="status">Status</option>
          </select>
        </div>
        {notice && <div className="alert">{notice}</div>}
        {error && <div className="alert">{error}</div>}
        {loading ? <EmptyState title="Loading mailboxes" icon={RefreshCw} /> : !data?.length ? <EmptyState title="No mailboxes yet" /> : (
          <div className="mailbox-list">
            {data.map((box) => <MailboxCard key={box.id} box={box} active={selected?.id === box.id} onSelect={() => setSelectedId(box.id)} onReload={reload} />)}
          </div>
        )}
      </aside>
      <section className="mailbox-mails">
        {selected ? (
          <>
            <div className="panel mailbox-summary">
              <div>
                <span className="eyebrow">Current mailbox</span>
                <h2>{selected.email}</h2>
                {selected.alias && <p>{selected.alias}</p>}
              </div>
              <div className="summary-stats">
                <span>Received <strong>{selected.inbound_count || 0}</strong></span>
                <span>Sent <strong>{selected.outbound_count || 0}</strong></span>
                <span>Attachments <strong>{formatBytes(selected.attachment_bytes || 0)}</strong></span>
              </div>
            </div>
            <EmailList mailboxId={selected.id} compactTitle="Messages" />
          </>
        ) : <EmptyState title="Select a mailbox to view messages" icon={Mail} />}
      </section>
      {createOpen && (
        <div className="modal-backdrop" role="dialog" aria-modal="true">
          <section className="modal small-modal">
            <div className="section-head">
              <h2>New mailbox</h2>
              <button className="icon-button" onClick={() => setCreateOpen(false)}><X size={16} /></button>
            </div>
            <label>Email address<div className="input-suffix"><input value={local} onChange={(e) => setLocal(e.target.value)} placeholder="new-address" /><span>@112327.xyz</span></div></label>
            <label>Alias / purpose<input value={alias} onChange={(e) => setAlias(e.target.value)} placeholder="e.g. shopping, testing, sign-ups" /></label>
            <div className="button-row compact-actions"><button onClick={() => setCreateOpen(false)}>Cancel</button><button className="primary" disabled={busy} onClick={createMailbox}><Plus size={16} />Create</button></div>
          </section>
        </div>
      )}
    </div>
  );
}

function MailboxCard({ box, active, onSelect, onReload }: { box: Mailbox; active?: boolean; onSelect: () => void; onReload: () => void }) {
  const [alias, setAlias] = useState(box.alias || "");
  const [menuOpen, setMenuOpen] = useState(false);
  const update = async (status: string) => {
    await api(`/api/mailboxes/${box.id}`, { method: "PATCH", body: JSON.stringify({ status }) });
    setMenuOpen(false);
    onReload();
  };
  const saveAlias = async () => {
    await api(`/api/mailboxes/${box.id}`, { method: "PATCH", body: JSON.stringify({ alias }) });
    setMenuOpen(false);
    onReload();
  };
  const remove = async () => {
    if (!confirm(`Delete ${box.email}?`)) return;
    await api(`/api/mailboxes/${box.id}`, { method: "DELETE" });
    onReload();
  };
  return (
    <article className={`mailbox-card cloud ${active ? "active" : ""}`}>
      <button className="mailbox-main" onClick={onSelect}>
        <span className="mailbox-badge"><Mail size={18} /></span>
        <span>
          <strong>{box.email}</strong>
          <small>{box.alias || "No alias"}</small>
        </span>
      </button>
      <div className="mailbox-stats">
        <span>Received {box.inbound_count || 0}</span>
        <span>Sent {box.outbound_count || 0}</span>
        <span>{formatBytes(box.attachment_bytes || 0)}</span>
      </div>
      <div className="mailbox-card-footer">
        <StatusPill value={box.status} />
        <div className="dropdown">
          <button className="icon-button" aria-label="Mailbox actions" onClick={() => setMenuOpen((v) => !v)}><MoreHorizontal size={17} /></button>
          {menuOpen && (
            <div className="dropdown-menu">
              <label>Alias<input value={alias} onChange={(e) => setAlias(e.target.value)} /></label>
              <button onClick={saveAlias}><Check size={16} />Save alias</button>
              {["active", "disabled", "receive_only", "send_only", "frozen"].map((s) => <button key={s} onClick={() => update(s)}>{s}</button>)}
              <button className="danger" onClick={remove}><Trash2 size={16} />Delete mailbox</button>
            </div>
          )}
        </div>
      </div>
    </article>
  );
}

function EmailList({ direction, mailboxId, starredOnly, compactTitle }: { direction?: "inbound" | "outbound"; mailboxId?: string; starredOnly?: boolean; compactTitle?: string }) {
  const [query, setQuery] = useState("");
  const [read, setRead] = useState("");
  const [hasAttachment, setHasAttachment] = useState(false);
  const [folder, setFolder] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const params = new URLSearchParams();
  if (direction) params.set("direction", direction);
  if (mailboxId) params.set("mailbox_id", mailboxId);
  if (starredOnly) params.set("starred", "1");
  if (query) params.set("q", query);
  if (read) params.set("read", read);
  if (hasAttachment) params.set("has_attachment", "1");
  if (folder) params.set("folder", folder);
  const { data, loading, error, reload } = useAsync<EmailItem[]>(() => api(`/api/emails?${params.toString()}`), [direction, mailboxId, starredOnly, query, read, hasAttachment, folder]);
  const [optimisticStars, setOptimisticStars] = useState<Record<string, number>>({});
  const toggle = (id: string) => setSelected((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]);
  const bulk = async (action: string) => {
    await api("/api/emails/bulk", { method: "PATCH", body: JSON.stringify({ ids: selected, action }) });
    setSelected([]);
    await reload();
  };
  const star = async (email: EmailItem) => {
    const current = optimisticStars[email.id] ?? email.is_starred ?? 0;
    const next = current ? 0 : 1;
    setOptimisticStars((prev) => ({ ...prev, [email.id]: next }));
    try {
      await api(`/api/emails/${email.id}/star`, { method: "PATCH", body: JSON.stringify({ starred: !!next }) });
    } catch (err) {
      setOptimisticStars((prev) => ({ ...prev, [email.id]: current }));
    }
  };
  const title = compactTitle || (starredOnly ? "Starred" : direction === "outbound" ? "Sent" : "Inbox");
  return (
    <div className="stack">
      <div className="section-head">
        <h2>{title}</h2>
        <button onClick={reload}><RefreshCw size={17} />Refresh</button>
      </div>
      <div className="panel toolbar">
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search subject, sender, recipient, or body" />
        <select value={read} onChange={(e) => setRead(e.target.value)}>
          <option value="">All</option>
          <option value="unread">Unread</option>
          <option value="read">Read</option>
        </select>
        <select value={folder} onChange={(e) => setFolder(e.target.value)}>
          <option value="">Mail</option>
          <option value="archive">Archive</option>
          <option value="trash">Trash</option>
        </select>
        <label className="check-filter"><input type="checkbox" checked={hasAttachment} onChange={(e) => setHasAttachment(e.target.checked)} /> Has attachments</label>
      </div>
      {!!selected.length && (
        <div className="action-bar">
          <strong>Selected {selected.length}</strong>
          <button onClick={() => bulk("mark_read")}><Eye size={16} />Mark read</button>
          <button onClick={() => bulk("mark_unread")}><Mail size={16} />Mark unread</button>
          <button onClick={() => bulk("archive")}><Archive size={16} />Archive</button>
          <button className="danger" onClick={() => bulk("delete")}><Trash2 size={16} />Delete</button>
        </div>
      )}
      {error && <div className="alert">{error}</div>}
      {loading ? <EmptyState title="Loading mail" icon={RefreshCw} /> : !data?.length ? <EmptyState title="No messages" icon={Inbox} /> : (
        <div className="mail-list">
          {data.map((email) => (
            <div className={`mail-row ${email.is_read ? "" : "unread"}`} key={email.id}>
              <button className="icon-button" aria-label="Select message" onClick={() => toggle(email.id)}>{selected.includes(email.id) ? <CheckSquare size={18} /> : <Square size={18} />}</button>
              <button className={`icon-button star-button ${(optimisticStars[email.id] ?? email.is_starred) ? "active" : ""}`} aria-label={(optimisticStars[email.id] ?? email.is_starred) ? "Remove star" : "Starred"} onClick={() => star(email).catch(console.error)}><Star size={18} /></button>
              <button className="mail-copy" onClick={() => setRoute(`email:${email.id}`)}>
                <div><strong>{email.direction === "inbound" ? email.from_addr : email.to_addr}</strong><span>{formatDate(email.created_at)}</span></div>
                <p>{email.subject || "(no subject)"}</p>
                {email.error && <small>{email.error}</small>}
              </button>
              <div className="mail-meta">
                {email.attachment_count ? <Paperclip size={16} /> : null}
                {!email.is_read && <StatusPill value="unread" />}
                <StatusPill value={email.status} />
                <ChevronRight size={18} />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function EmailDetail({ id, returnRoute }: { id: string; returnRoute?: string }) {
  const { data, loading, error } = useAsync<EmailItem>(() => api(`/api/emails/${id}`), [id]);
  if (loading) return <EmptyState title="Opening message" icon={RefreshCw} />;
  if (error) return <div className="alert">{error}</div>;
  if (!data) return null;
  return (
    <article className="panel email-detail">
      <header>
        <button onClick={() => returnRoute ? setRoute(returnRoute) : history.back()}><ChevronRight className="back" size={17} />{returnRoute === "attachments" ? "Back to attachments" : "Back"}</button>
        <StatusPill value={data.status} />
      </header>
      <h2>{data.subject || "(no subject)"}</h2>
      <div className="meta-grid">
        <span>From</span><strong>{data.from_addr}</strong>
        <span>To</span><strong>{data.to_addr}</strong>
      </div>
      <pre className="body-text">{data.text_body}</pre>
      {data.html_body && <iframe className="html-frame" sandbox="" srcDoc={data.html_body} title="HTML message body" />}
      {!!data.attachments?.length && (
        <div className="attachment-strip">
          {data.attachments.map((att) => <AttachmentChip key={att.id} att={att} />)}
        </div>
      )}
    </article>
  );
}

function Drafts() {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const { data, loading, error, reload } = useAsync<Draft[]>(() => api(`/api/drafts?q=${encodeURIComponent(query)}`), [query]);
  const create = async () => {
    const draft = await api<{ id: string }>("/api/drafts", { method: "POST", body: JSON.stringify({}) });
    setRoute(`compose:${draft.id}`);
  };
  const remove = async (id: string) => {
    if (!confirm("Delete this draft?")) return;
    await api(`/api/drafts/${id}`, { method: "DELETE" });
    reload();
  };
  const toggle = (id: string) => setSelected((prev) => prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]);
  const bulkRemove = async () => {
    if (!selected.length || !confirm(`Delete ${selected.length} drafts?`)) return;
    await api("/api/drafts", { method: "DELETE", body: JSON.stringify({ ids: selected }) });
    setSelected([]);
    reload();
  };
  return (
    <div className="stack">
      <div className="section-head">
        <h2>Drafts</h2>
        <button className="primary" onClick={create}><Plus size={17} />New draft</button>
      </div>
      <div className="panel toolbar">
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search subject or recipient" />
        {!!selected.length && <button className="danger" onClick={bulkRemove}><Trash2 size={16} />Delete selected {selected.length}</button>}
      </div>
      {error && <div className="alert">{error}</div>}
      {loading ? <EmptyState title="Loading drafts" icon={RefreshCw} /> : !data?.length ? <EmptyState title="No drafts" icon={FileText} /> : (
        <div className="table">
          {data.map((draft) => (
            <div className="table-row" key={draft.id}>
              <button className="icon-button" onClick={() => toggle(draft.id)}>{selected.includes(draft.id) ? <CheckSquare size={17} /> : <Square size={17} />}</button>
              <button className="link-row" onClick={() => setRoute(`compose:${draft.id}`)}>
                <strong>{draft.subject || "(no subject)"}</strong>
                <span>{draft.to_addr || "No recipient"}</span>
                <span>{formatDate(draft.updated_at)}</span>
              </button>
              <button className="icon-button danger" aria-label="DeleteDrafts" onClick={() => remove(draft.id)}><Trash2 size={17} /></button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Compose({ draftId }: { draftId?: string }) {
  const [mailboxes, setMailboxes] = useState<Mailbox[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [notice, setNotice] = useState("");
  const [saving, setSaving] = useState(false);
  const [savedPulse, setSavedPulse] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [dragging, setDragging] = useState(false);
  const [preview, setPreview] = useState(false);
  const [wideEditor, setWideEditor] = useState(false);
  const textRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    api<Mailbox[]>("/api/mailboxes").then(setMailboxes).catch((err) => setNotice(err.message));
    const load = async () => {
      if (draftId) {
        setDraft(await api<Draft>(`/api/drafts/${draftId}`));
      } else {
        const created = await api<{ id: string }>("/api/drafts", { method: "POST", body: JSON.stringify({}) });
        setRoute(`compose:${created.id}`);
      }
    };
    void load().catch((err) => setNotice(err.message));
  }, [draftId]);

  useEffect(() => {
    if (!draft?.id) return;
    const timer = window.setTimeout(() => {
      setSaving(true);
      api(`/api/drafts/${draft.id}`, { method: "PATCH", body: JSON.stringify(draft) })
        .catch((err) => setNotice(err.message))
        .finally(() => {
          setSaving(false);
          setSavedPulse(true);
          window.setTimeout(() => setSavedPulse(false), 1400);
        });
    }, 2000);
    return () => window.clearTimeout(timer);
  }, [draft?.mailbox_id, draft?.to_addr, draft?.cc, draft?.bcc, draft?.subject, draft?.text_body, draft?.html_body]);

  const update = (patch: Partial<Draft>) => setDraft((d) => (d ? { ...d, ...patch } : d));
  const upload = async (file: File) => {
    if (!draft?.id) return;
    const form = new FormData();
    form.append("draft_id", draft.id);
    form.append("file", file);
    const att = await api<Attachment>("/api/attachments/upload", { method: "POST", body: form, headers: {} });
    setDraft({ ...draft, attachments: [...(draft.attachments || []), att] });
  };
  const removeAttachment = async (attId: string) => {
    await api(`/api/attachments/${attId}`, { method: "DELETE" });
    setDraft((d) => d ? { ...d, attachments: (d.attachments || []).filter((att) => att.id !== attId) } : d);
  };
  const validate = () => {
    const errors: Record<string, string> = {};
    const emailRe = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;
    const toList = (draft?.to_addr || "").split(/[,\n;]/).map((x) => x.trim()).filter(Boolean);
    if (!toList.length) errors.to_addr = "Enter at least one recipient";
    const bad = toList.find((addr) => !emailRe.test(addr));
    if (bad) errors.to_addr = `Invalid address: ${bad}`;
    if (!draft?.subject?.trim()) errors.subject = "The subject is empty. You can still send, but adding one is recommended.";
    setFieldErrors(errors);
    return !errors.to_addr;
  };
  const sendMail = async () => {
    if (!draft) return;
    setNotice("");
    if (!validate()) return;
    try {
      const sent = await api<{ id: string }>("/api/emails/send", {
        method: "POST",
        body: JSON.stringify({ draft_id: draft.id, mailbox_id: draft.mailbox_id, attachment_ids: draft.attachments?.map((a) => a.id) || [] })
      });
      setNotice(`Queued for sending: ${sent.id}`);
      setRoute("sent");
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "Sending failed");
    }
  };
  const insertAgentOutput = (text: string, mode: "append" | "replace" | "selection") => {
    const current = draft?.text_body || "";
    if (mode === "replace") update({ text_body: text });
    else if (mode === "selection" && textRef.current) {
      const start = textRef.current.selectionStart;
      const end = textRef.current.selectionEnd;
      update({ text_body: current.slice(0, start) + text + current.slice(end) });
    } else update({ text_body: `${current}${current ? "\n\n" : ""}${text}` });
  };
  const wrapSelection = (before: string, after = before, fallback = "text") => {
    const current = draft?.text_body || "";
    const start = textRef.current?.selectionStart ?? current.length;
    const end = textRef.current?.selectionEnd ?? current.length;
    const picked = current.slice(start, end) || fallback;
    update({ text_body: `${current.slice(0, start)}${before}${picked}${after}${current.slice(end)}` });
    window.setTimeout(() => textRef.current?.focus(), 0);
  };

  if (!draft) return <EmptyState title="Preparing draft" icon={RefreshCw} />;
  return (
    <div className={`compose-layout ${wideEditor ? "wide" : ""}`}>
      <section
        className={`panel composer ${dragging ? "dragging" : ""}`}
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          Array.from(e.dataTransfer.files).forEach((file) => upload(file).catch((err) => setNotice(err.message)));
        }}
      >
        <div className="compose-head">
          <select value={draft.mailbox_id || ""} onChange={(e) => update({ mailbox_id: e.target.value })}>
            <option value="">Select a sender mailbox</option>
            {mailboxes.filter((m) => ["active", "send_only"].includes(m.status)).map((m) => <option value={m.id} key={m.id}>{m.email}{m.alias ? ` · ${m.alias}` : ""}</option>)}
          </select>
          <span className={savedPulse ? "save-pulse" : ""}>{saving ? "Saving..." : "Draft saved"}</span>
          {draft.id && <button onClick={() => setRoute(`compose:${draft.id}:history`)}><FileText size={16} />History</button>}
          <button className="primary" onClick={sendMail}><Send size={17} />Send</button>
        </div>
        {notice && <div className="alert">{notice}</div>}
        <input value={draft.to_addr || ""} onChange={(e) => update({ to_addr: e.target.value })} placeholder="To" />
        {fieldErrors.to_addr && <small className="field-error">{fieldErrors.to_addr}</small>}
        <div className="split">
          <input value={draft.cc || ""} onChange={(e) => update({ cc: e.target.value })} placeholder="Cc" />
          <input value={draft.bcc || ""} onChange={(e) => update({ bcc: e.target.value })} placeholder="Bcc" />
        </div>
        <input className="subject" value={draft.subject || ""} onChange={(e) => update({ subject: e.target.value })} placeholder="Subject" />
        {fieldErrors.subject && <small className="field-warning">{fieldErrors.subject}</small>}
        <div className="editor-toolbar" aria-label="Editor toolbar">
          <button title="Bold" onClick={() => wrapSelection("**")}><strong>B</strong></button>
          <button title="Italic" onClick={() => wrapSelection("*")}><em>I</em></button>
          <button title="Underline" onClick={() => wrapSelection("<u>", "</u>")}>U</button>
          <button title="List" onClick={() => wrapSelection("- ", "", "List item")}><FileText size={16} /></button>
          <button title="Link" onClick={() => wrapSelection("[", "](https://)", "Link text")}><Copy size={16} /></button>
          <button title="Code" onClick={() => wrapSelection("`")}><span>{"<>"}</span></button>
          <button title="Preview" className={preview ? "active" : ""} onClick={() => setPreview((v) => !v)}><Eye size={16} /></button>
          <button title="Fullscreen editor" className={wideEditor ? "active" : ""} onClick={() => setWideEditor((v) => !v)}><ChevronRight size={16} /></button>
        </div>
        {preview ? <pre className="body-text editor-preview">{draft.text_body || "No body text"}</pre> : <textarea ref={textRef} value={draft.text_body || ""} onChange={(e) => update({ text_body: e.target.value })} placeholder="Body" />}
        <div className="attachment-strip">
          {(draft.attachments || []).map((att) => <AttachmentCard key={att.id} att={att} onRemove={() => removeAttachment(att.id).catch((err) => setNotice(err.message))} />)}
          <label className="upload-button">
            <Upload size={17} />
            Upload or drop attachments
            <input type="file" onChange={(e) => e.target.files?.[0] && upload(e.target.files[0]).catch((err) => setNotice(err.message))} />
          </label>
        </div>
      </section>
      <AgentPanel draft={draft} onInsert={insertAgentOutput} />
    </div>
  );
}

function AgentPanel({ draft, onInsert }: { draft: Draft; onInsert: (text: string, mode: "append" | "replace" | "selection") => void }) {
  const [command, setCommand] = useState("generate_email");
  const [input, setInput] = useState("");
  const [job, setJob] = useState<AgentJob | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!job?.id || !["pending", "processing", "retrying"].includes(job.status)) return;
    const timer = window.setInterval(async () => {
      const next = await api<AgentJob>(`/api/agent/jobs/${job.id}`);
      setJob(next);
      if (!["pending", "processing", "retrying"].includes(next.status)) window.clearInterval(timer);
    }, 1800);
    return () => window.clearInterval(timer);
  }, [job?.id, job?.status]);
  const generate = async () => {
    setBusy(true);
    setError("");
    try {
      const created = await api<AgentJob>("/api/agent/generate", {
        method: "POST",
        body: JSON.stringify({ draft_id: draft.id, command, input: `${input}\n\nCurrent draft:\n${draft.text_body || ""}` })
      });
      setJob(created);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Agent request failed");
    } finally {
      setBusy(false);
    }
  };
  const retry = async () => {
    if (!job) return;
    setJob(await api<AgentJob>(`/api/agent/jobs/${job.id}/retry`, { method: "POST" }));
  };
  return (
    <aside className="panel agent">
      <div className="section-head">
        <h2><Bot size={19} />AI</h2>
        <button disabled={busy} onClick={generate}><Sparkles size={17} />Generate</button>
      </div>
      <select value={command} onChange={(e) => setCommand(e.target.value)}>
        <option value="generate_email">Generate email</option>
        <option value="draft_reply">Draft reply</option>
        <option value="translate_en">Translate to English</option>
        <option value="reply_email">Reply to email</option>
        <option value="polish">Polish</option>
        <option value="rewrite_tone">Rewrite tone</option>
        <option value="summarize">Summarize received email</option>
        <option value="subject">Generate subject</option>
        <option value="reply_suggestions">Suggest replies</option>
      </select>
      <textarea value={input} onChange={(e) => setInput(e.target.value)} placeholder="Enter intent or context" />
      {error && <div className="alert">{error}</div>}
      {job && (
        <div className="agent-result">
          <StatusPill value={job.status} />
          {job.error && <small>{job.error}</small>}
          {job.output && <div className="candidate-list">{job.output.split(/\n{2,}/).filter(Boolean).map((part, idx) => <article className="candidate" key={idx}><span>Candidate {idx + 1}</span><p>{part}</p><div className="button-row"><button onClick={() => onInsert(part, "append")}><Plus size={16} />Insert</button><button onClick={() => onInsert(part, "selection")}><PenLine size={16} />Replace selection</button></div></article>)}</div>}
          {job.output && (
            <div className="button-row">
              <button onClick={() => onInsert(job.output || "", "append")}><Plus size={16} />Insert</button>
              <button onClick={() => onInsert(job.output || "", "selection")}><PenLine size={16} />Replace selection</button>
              <button onClick={() => onInsert(job.output || "", "replace")}><Check size={16} />Replace body</button>
              <button onClick={() => navigator.clipboard.writeText(job.output || "")}><Copy size={16} />Copy</button>
            </div>
          )}
          {job.status === "failed" && <button onClick={retry}><RefreshCw size={16} />Retry</button>}
        </div>
      )}
    </aside>
  );
}

function AttachmentIcon({ type }: { type?: string }) {
  if (type === "image") return <Image size={17} />;
  if (type === "pdf" || type === "document") return <FileText size={17} />;
  if (type === "archive") return <Archive size={17} />;
  return <Paperclip size={17} />;
}

function AttachmentPreview({ att }: { att: Attachment }) {
  const icon = <AttachmentIcon type={att.file_type} />;
  if (att.file_type === "image") {
    return <ImageAttachmentPreview att={att} />;
  }
  return (
    <div className={`attachment-preview type-${att.file_type || "file"}`}>
      {icon}
      <strong>{(att.file_type || "file").toUpperCase()}</strong>
    </div>
  );
}

function ImageAttachmentPreview({ att }: { att: Attachment }) {
  const [url, setUrl] = useState("");
  useEffect(() => {
    let active = true;
    let objectUrl = "";
    const token = localStorage.getItem(tokenKey);
    fetch(`/api/attachments/${att.id}/download`, { headers: token ? { Authorization: `Bearer ${token}` } : {} })
      .then((res) => res.ok ? res.blob() : Promise.reject(new Error("preview failed")))
      .then((blob) => {
        if (!active) return;
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      })
      .catch(() => undefined);
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [att.id]);
  return (
    <div className="attachment-preview image-preview">
      {url ? <img src={url} alt={att.filename} /> : <Image size={34} />}
    </div>
  );
}

function AttachmentCard({ att, onRemove }: { att: Attachment; onRemove?: () => void }) {
  return (
    <div className="attachment-card">
      <AttachmentIcon type={att.file_type} />
      <div>
        <strong>{att.filename}</strong>
        <small>{formatBytes(att.size_bytes)} · {att.content_type || att.file_type || "file"}</small>
      </div>
      <AttachmentChip att={att} />
      {onRemove && <button className="icon-button danger" aria-label="Remove attachment" onClick={onRemove}><X size={16} /></button>}
    </div>
  );
}

function AttachmentChip({ att }: { att: Attachment }) {
  const download = async () => {
    const token = localStorage.getItem(tokenKey);
    const res = await fetch(`/api/attachments/${att.id}/download`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {}
    });
    if (!res.ok) throw new Error("Download failed");
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = att.filename;
    link.click();
    URL.revokeObjectURL(url);
  };
  return (
    <button className="attachment" onClick={() => download().catch(console.error)}>
      <Paperclip size={16} />
      <span>{att.filename}</span>
      <small>{formatBytes(att.size_bytes)}</small>
      <Download size={15} />
    </button>
  );
}

function Attachments({ user }: { user: User }) {
  const [query, setQuery] = useState("");
  const [type, setType] = useState("");
  const [sort, setSort] = useState("created_desc");
  const { data, loading, error, reload } = useAsync<Attachment[]>(() => api(`/api/attachments?q=${encodeURIComponent(query)}&type=${type}&sort=${sort}`), [query, type, sort]);
  const cleanup = async () => {
    if (!confirm("Delete attachments past retention or without a linked message?")) return;
    await api("/api/attachments/cleanup", { method: "POST", body: JSON.stringify({ retention_days: 30 }) });
    reload();
  };
  return (
    <div className="stack">
      <div className="section-head">
        <h2>Attachments</h2>
        {user.role === "admin" && <button onClick={cleanup}><Trash2 size={17} />Clean up</button>}
      </div>
      <div className="panel toolbar">
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search filenames" />
        <select value={type} onChange={(e) => setType(e.target.value)}>
          <option value="">All types</option>
          <option value="image">Images</option>
          <option value="pdf">PDF</option>
          <option value="document">Documents</option>
          <option value="archive">Archives</option>
        </select>
        <select value={sort} onChange={(e) => setSort(e.target.value)}>
          <option value="created_desc">Newest uploads</option>
          <option value="created_asc">Oldest uploads</option>
          <option value="name">Filename</option>
          <option value="size">Size</option>
        </select>
      </div>
      {error && <div className="alert">{error}</div>}
      {loading ? <EmptyState title="Loading attachments" icon={RefreshCw} /> : !data?.length ? <EmptyState title="No attachments" icon={Paperclip} /> : (
        <div className="attachment-grid">{data.map((att) => <AttachmentTile key={att.id} att={att} />)}</div>
      )}
    </div>
  );
}

function AttachmentTile({ att }: { att: Attachment }) {
  const openTarget = () => {
    if (att.email_id) setRoute(`email:${att.email_id}:attachments`);
    else if (att.draft_id) setRoute(`compose:${att.draft_id}`);
  };
  return (
    <article className="attachment-tile">
      <AttachmentPreview att={att} />
      <div className="attachment-tile-body">
        <strong title={att.filename}>{att.filename}</strong>
        <small>{formatDate(att.created_at)}</small>
        <span>{formatBytes(att.size_bytes)} · {att.content_type || att.file_type || "file"}</span>
        <span>{att.email_subject || att.draft_subject || "No linked subject"}</span>
      </div>
      <div className="attachment-tile-actions">
        <AttachmentChip att={att} />
        {(att.email_id || att.draft_id) && <button onClick={openTarget}><ChevronRight size={15} />Open</button>}
      </div>
    </article>
  );
}

function Usage() {
  const { data, loading, error } = useAsync<{ limits: Record<string, number>; usage: Record<string, any> }>(() => api("/api/usage"), []);
  const [days, setDays] = useState(7);
  const trends = useAsync<{ counters: any[]; mailboxes: any[] }>(() => api(`/api/usage/trends?days=${days}`), [days]);
  if (loading) return <EmptyState title="Loading usage" icon={RefreshCw} />;
  if (error) return <div className="alert">{error}</div>;
  if (!data) return null;
  const items = [
    ["Mailbox", data.usage.mailboxes, data.limits.max_mailboxes],
    ["Sent today", data.usage.send.count, data.limits.max_send_per_day],
    ["Received today", data.usage.receive.count, data.limits.max_receive_per_day],
    ["Attachment storage", formatBytes(data.usage.attachment_bytes), formatBytes(data.limits.max_attachment_total_bytes)],
    ["Tokens", data.usage.tokens.count, "Auth Center"]
  ];
  const localQuotaItems = items.filter(([label]) => label !== "Tokens");
  const tokenItem = items.find(([label]) => label === "Tokens");
  return (
    <div className="stack">
      <div className="usage-explainer panel">
        <div>
          <h2>Usage and limits</h2>
          <p>Auth Center controls token quotas. This app enforces mailbox, mail, and attachment limits by role.</p>
        </div>
        {tokenItem && <div className="token-card"><span>{tokenItem[0]}</span><strong>{tokenItem[1]}</strong><small>{String(tokenItem[2])}</small></div>}
      </div>
      <div className="metric-grid compact-metrics">{localQuotaItems.map(([label, used, limit]) => <div className="metric" key={label}><span>{label}</span><strong>{used}</strong><small>Limit: {String(limit)}</small></div>)}</div>
      <div className="section-head">
        <h2>Usage trends</h2>
        <div className="segments">{[7, 30, 90].map((d) => <button className={days === d ? "active" : ""} onClick={() => setDays(d)} key={d}>{d} days</button>)}</div>
      </div>
      <TrendChart rows={trends.data?.counters || []} />
    </div>
  );
}

function TrendChart({ rows }: { rows: Array<{ day: string; type: string; count: number; bytes: number }> }) {
  const days = Array.from(new Set(rows.map((r) => r.day)));
  const types = [
    { key: "send", label: "Send" },
    { key: "receive", label: "Receive" },
    { key: "attachment", label: "Attachment size" }
  ];
  const max = Math.max(1, ...rows.filter((r) => r.type !== "tokens").map((r) => r.type === "attachment" ? r.bytes : r.count));
  return (
    <div className="panel trend-chart">
      {!rows.length ? <EmptyState title="No trend data" icon={BarChart3} /> : types.map((type) => (
        <div className="trend-row" key={type.key}>
          <strong>{type.label}</strong>
          <div className="trend-bars">
            {days.map((day) => {
              const item = rows.find((r) => r.day === day && r.type === type.key);
              const value = item ? (type.key === "attachment" ? item.bytes : item.count) : 0;
              return <span key={day} style={{ height: `${Math.max(4, (value / max) * 100)}%` }} title={`${day}: ${type.key === "attachment" ? formatBytes(value) : value}`} />;
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

function SettingsPage({ user }: { user: User }) {
  const authUrl = `https://accounts.aryuki.com/${user.id}`;
  const [displayName, setDisplayName] = useState(user.display_name || user.name || "");
  const [avatarUrl, setAvatarUrl] = useState(user.avatar_url || "");
  const [theme, setTheme] = useState(user.theme || "system");
  const [draftRetentionDays, setDraftRetentionDays] = useState(user.draft_retention_days || 7);
  const [notice, setNotice] = useState("");
  const save = async () => {
    await api("/api/me/settings", { method: "PATCH", body: JSON.stringify({ display_name: displayName, avatar_url: avatarUrl, language: "en", theme, draft_retention_days: draftRetentionDays }) });
    localStorage.setItem("theme", theme === "system" ? "" : theme);
    setNotice("Settings saved");
  };
  return (
    <div className="panel settings-page compact-settings">
      <h2>Personal settings</h2>
      {notice && <div className="alert">{notice}</div>}
      <div className="meta-grid compact-meta">
        <span>Username</span><strong>{user.username}</strong>
        <span>Role</span><strong>{roleName(user)}</strong>
      </div>
      <div className="settings-form-grid">
        <label>Display name<input value={displayName} onChange={(e) => setDisplayName(e.target.value)} /></label>
        <label>Avatar URL<input value={avatarUrl} onChange={(e) => setAvatarUrl(e.target.value)} /></label>
        <label>Theme<select value={theme} onChange={(e) => setTheme(e.target.value as any)}><option value="system">System</option><option value="light">Light</option><option value="dark">Dark</option></select></label>
        <label>Auto-delete drafts<select value={draftRetentionDays} onChange={(e) => setDraftRetentionDays(Number(e.target.value))}><option value={1}>1 day</option><option value={3}>3 days</option><option value={7}>1 week</option><option value={30}>1 month</option></select></label>
      </div>
      <div className="settings-actions">
        <button className="primary small-button" onClick={save}><Check size={15} />Save</button>
        <a className="outline-link" href={`${authUrl}/change-password`} target="_blank" rel="noreferrer"><Shield size={15} />Change password</a>
        <a className="outline-link" href={authUrl} target="_blank" rel="noreferrer"><Shield size={15} />Auth Center</a>
      </div>
    </div>
  );
}

function AdminUsers() {
  const [query, setQuery] = useState("");
  const [status, setStatusFilter] = useState("");
  const { data, loading, error, reload } = useAsync<any[]>(() => api(`/api/admin/users?q=${encodeURIComponent(query)}&status=${status}`), [query, status]);
  const roles = useAsync<any[]>(() => api("/api/admin/roles"), []);
  const setStatus = async (user: any, status: string) => {
    await api(`/api/admin/users/${user.id}/status`, { method: "PATCH", body: JSON.stringify({ status }) });
    reload();
  };
  const setUserRole = async (user: any, roleId: string) => {
    await api(`/api/admin/users/${user.id}/app-role`, { method: "PATCH", body: JSON.stringify({ role_id: roleId || null }) });
    reload();
  };
  const resetCounters = async (user: any) => {
    await api(`/api/admin/users/${user.id}/reset-counters`, { method: "POST", body: JSON.stringify({ types: ["send", "receive"] }) });
    reload();
  };
  const exportCsv = () => {
    const rows = data || [];
    const header = ["username", "received", "sent", "mailboxes", "created_at", "status", "role", "attachment_mb"].join(",");
    const csv = [header, ...rows.map((u) => [u.username, u.received_count || 0, u.sent_count || 0, u.mailbox_count || 0, u.created_at, u.status, u.role, ((u.attachment_bytes || 0) / 1024 / 1024).toFixed(2)].join(","))].join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "mail-agent-users.csv";
    link.click();
    URL.revokeObjectURL(url);
  };
  if (loading) return <EmptyState title="Loading users" icon={RefreshCw} />;
  if (error) return <div className="alert">{error}</div>;
  return (
    <div className="stack">
      <div className="panel toolbar">
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search users" />
        <select value={status} onChange={(e) => setStatusFilter(e.target.value)}><option value="">All statuses</option><option value="active">active</option><option value="frozen">frozen</option></select>
        <button onClick={reload}><RefreshCw size={16} />Refresh</button>
        <button onClick={exportCsv}><Download size={16} />Export</button>
      </div>
      <div className="cloud-table admin-table">
        <div className="cloud-table-head admin-user-row">
          <span></span><strong>User email</strong><span>Received</span><span>Sent</span><span>Mailboxes</span><span>Joined</span><span>Status</span><span>Role type</span><span>Attachment storage</span><span>Actions</span>
        </div>
        {data?.map((u) => <AdminUserRow key={u.id} user={u} roles={roles.data || []} onRole={setUserRole} onStatus={setStatus} onReset={resetCounters} />)}
      </div>
    </div>
  );
}

function AdminUserRow({ user, roles, onRole, onStatus, onReset }: { user: any; roles: any[]; onRole: (u: any, roleId: string) => void; onStatus: (u: any, s: string) => void; onReset: (u: any) => void }) {
  const [expanded, setExpanded] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [roleOpen, setRoleOpen] = useState(false);
  const [roleId, setRoleId] = useState(user.app_role_id || "");
  const sendPercent = Math.min(100, ((user.sent_count || 0) / Math.max(1, Number(user.max_send_per_day || 1))) * 100);
  const attachmentPercent = Math.min(100, ((user.attachment_bytes || 0) / Math.max(1, Number(user.max_attachment_total_bytes || 1))) * 100);
  return (
    <div className="cloud-table-item">
      <div className="cloud-table-row admin-user-row">
        <button className="icon-button" aria-label="Expand user details" onClick={() => setExpanded((v) => !v)}><ChevronRight className={expanded ? "rotate" : ""} size={16} /></button>
        <strong>{user.username}</strong>
        <span>{user.received_count || 0}</span>
        <span>{user.sent_count || 0}</span>
        <span>{user.mailbox_count || 0}</span>
        <span>{formatDate(user.created_at)}</span>
        <StatusPill value={user.status} />
        <StatusPill value={roleName(user)} />
        <span>{formatBytes(user.attachment_bytes || 0)}</span>
        <div className="dropdown table-actions">
          <button onClick={() => setMenuOpen((v) => !v)}>Actions <MoreHorizontal size={15} /></button>
          {menuOpen && (
            <div className="dropdown-menu right">
              <button onClick={() => { setRoleOpen(true); setMenuOpen(false); }}><UserCog size={16} />Change role</button>
              <button onClick={() => { onStatus(user, user.status === "active" ? "frozen" : "active"); setMenuOpen(false); }}><Shield size={16} />{user.status === "active" ? "Disable" : "Enable"}</button>
              <button onClick={() => { onReset(user); setMenuOpen(false); }}><RefreshCw size={16} />Reset today's quota</button>
              <button onClick={() => { setRoute("admin-mailboxes"); setMenuOpen(false); }}><Mail size={16} />View mailboxes</button>
            </div>
          )}
        </div>
      </div>
      {expanded && (
        <div className="user-expand">
          <div className="detail-grid">
            <span>Registration IP</span><strong>{user.last_login_ip || "Not recorded"}</strong>
            <span>Last sign-in</span><strong>{user.last_login_at ? formatDate(user.last_login_at) : "Not recorded"}</strong>
            <span>Device and browser</span><strong>{user.last_login_user_agent || "Not recorded"}</strong>
          </div>
          <div className="quota-grid">
            <QuotaBar label="Messages sent" value={user.sent_count || 0} limit={user.max_send_per_day} percent={sendPercent} />
            <QuotaBar label="Attachment storage" value={formatBytes(user.attachment_bytes || 0)} limit={formatBytes(user.max_attachment_total_bytes || 0)} percent={attachmentPercent} />
            <QuotaBar label="Mailboxes" value={user.mailbox_count || 0} limit={user.max_mailboxes} percent={Math.min(100, ((user.mailbox_count || 0) / Math.max(1, Number(user.max_mailboxes || 1))) * 100)} />
          </div>
          <div className="quota-readonly">
            <span>Role: <strong>{roleName(user)}</strong></span>
            <span>Mailbox limit: <strong>{user.max_mailboxes}</strong></span>
            <span>Daily sent: <strong>{user.max_send_per_day}</strong></span>
            <span>Daily received: <strong>{user.max_receive_per_day}</strong></span>
            <span>Attachment limit: <strong>{formatBytes(user.max_attachment_total_bytes || 0)}</strong></span>
          </div>
        </div>
      )}
      {roleOpen && (
        <div className="modal-backdrop" role="dialog" aria-modal="true">
          <section className="modal small-modal">
            <div className="section-head">
              <h2>Change user role</h2>
              <button className="icon-button" onClick={() => setRoleOpen(false)}><X size={16} /></button>
            </div>
            <p className="muted">Roles determine accessible pages and synchronize mailbox, mail, and attachment quotas. Auth Center still controls token quotas.</p>
            <label>Select role<select value={roleId} onChange={(e) => setRoleId(e.target.value)}>{roles.map((role) => <option key={role.id} value={role.id}>{roleName(role)}{role.is_default ? " · Default" : ""}</option>)}</select></label>
            <div className="button-row compact-actions"><button onClick={() => setRoleOpen(false)}>Cancel</button><button className="primary" onClick={() => { onRole(user, roleId); setRoleOpen(false); }}><Check size={16} />Save</button></div>
          </section>
        </div>
      )}
    </div>
  );
}

function QuotaBar({ label, value, limit, percent }: { label: string; value: string | number; limit: string | number; percent: number }) {
  return (
    <div className="quota-bar">
      <div><strong>{label}</strong><span>{value}/{limit}</span></div>
      <i><b style={{ width: `${percent}%` }} /></i>
    </div>
  );
}

function AdminMailboxes() {
  const [query, setQuery] = useState("");
  const [status, setStatusFilter] = useState("");
  const [sort, setSort] = useState("created_desc");
  const { data, loading, error, reload } = useAsync<Mailbox[]>(() => api(`/api/admin/mailboxes?q=${encodeURIComponent(query)}&status=${status}&sort=${sort}`), [query, status, sort]);
  const update = async (box: Mailbox, status: string) => {
    await api(`/api/admin/mailboxes/${box.id}/status`, { method: "PATCH", body: JSON.stringify({ status }) });
    reload();
  };
  if (loading) return <EmptyState title="Loading mailboxes" icon={RefreshCw} />;
  if (error) return <div className="alert">{error}</div>;
  return (
    <div className="stack">
      <div className="panel toolbar">
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search address, alias, or user" />
        <select value={status} onChange={(e) => setStatusFilter(e.target.value)}><option value="">All statuses</option>{["active", "disabled", "receive_only", "send_only", "frozen", "deleted"].map((s) => <option key={s}>{s}</option>)}</select>
        <select value={sort} onChange={(e) => setSort(e.target.value)}><option value="created_desc">Newest</option><option value="local_part">Address</option><option value="owner">Users</option><option value="status">Status</option></select>
      </div>
      <div className="table">
        {data?.map((box) => (
          <div className="table-row" key={box.id}>
            <strong>{box.email}</strong>
            <span>{box.alias || "No alias"}</span>
            <span>{box.username}</span>
            <span>Received {box.inbound_count || 0} / Sent {box.outbound_count || 0}</span>
            <select value={box.status} onChange={(e) => update(box, e.target.value)}>
              {["active", "disabled", "receive_only", "send_only", "frozen", "deleted"].map((s) => <option key={s}>{s}</option>)}
            </select>
          </div>
        ))}
      </div>
    </div>
  );
}

function AdminAnalysis() {
  const [days, setDays] = useState(7);
  const { data, loading, error } = useAsync<{ users: any[]; by_day: any[] }>(() => api(`/api/admin/analysis?days=${days}`), [days]);
  if (loading) return <EmptyState title="Loading analytics" icon={RefreshCw} />;
  if (error) return <div className="alert">{error}</div>;
  const users = data?.users || [];
  const totals = users.reduce((acc, u) => ({
    tokens: acc.tokens + u.tokens,
    sent: acc.sent + u.sent,
    received: acc.received + u.received,
    attachments: acc.attachments + u.attachment_bytes
  }), { tokens: 0, sent: 0, received: 0, attachments: 0 });
  const downloadCsv = async () => {
    const token = localStorage.getItem(tokenKey);
    const res = await fetch(`/api/admin/analysis?days=${days}&format=csv`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "mail-agent-analysis.csv";
    link.click();
    URL.revokeObjectURL(url);
  };
  return (
    <div className="stack">
      <div className="section-head">
        <h2>Analysis</h2>
        <div className="button-row">
          <div className="segments">{[1, 7, 30].map((d) => <button className={days === d ? "active" : ""} onClick={() => setDays(d)} key={d}>{d === 1 ? "Today" : `${d} days`}</button>)}</div>
          <button onClick={downloadCsv}><Download size={16} />CSV</button>
        </div>
      </div>
      <div className="metric-grid">
        <div className="metric"><span>Tokens</span><strong>{totals.tokens}</strong><small>Auth Center + local records</small></div>
        <div className="metric"><span>Send</span><strong>{totals.sent}</strong><small>Queue/Resend</small></div>
        <div className="metric"><span>Receive</span><strong>{totals.received}</strong><small>Email Worker</small></div>
        <div className="metric"><span>Attachments</span><strong>{formatBytes(totals.attachments)}</strong><small>R2</small></div>
      </div>
      <div className="charts">
        <TrendLine title="Mail trends" rows={data?.by_day || []} />
        <BarChart title="Token usage" rows={users.map((u) => ({ label: u.username, value: u.tokens }))} />
        <BarChart title="Mailbox ranking" rows={users.map((u) => ({ label: u.username, value: u.mailboxes }))} />
        <BarChart title="Attachment usage ranking" rows={users.map((u) => ({ label: u.username, value: u.attachment_bytes, display: formatBytes(u.attachment_bytes) }))} />
        <BarChart title="Agent requests" rows={users.map((u) => ({ label: u.username, value: u.agent_jobs }))} />
      </div>
    </div>
  );
}

function BarChart({ title, rows }: { title: string; rows: Array<{ label: string; value: number; display?: string }> }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <div className="panel chart">
      <h3>{title}</h3>
      {!rows.length ? <EmptyState title="No data" icon={BarChart3} /> : rows.map((row) => (
        <div className="bar-row" key={row.label}>
          <span>{row.label}</span>
          <div><i style={{ width: `${Math.max(2, (row.value / max) * 100)}%` }} /></div>
          <strong>{row.display || row.value}</strong>
        </div>
      ))}
    </div>
  );
}

function TrendLine({ title, rows }: { title: string; rows: Array<{ day: string; direction: string; count: number }> }) {
  const days = Array.from(new Set(rows.map((r) => r.day)));
  const max = Math.max(1, ...rows.map((r) => r.count));
  return (
    <div className="panel chart">
      <h3>{title}</h3>
      {!rows.length ? <EmptyState title="No trend data" icon={BarChart3} /> : ["inbound", "outbound"].map((direction) => (
        <div className="trend-row" key={direction}>
          <strong>{direction}</strong>
          <div className="trend-bars">
            {days.map((day) => {
              const value = rows.find((r) => r.day === day && r.direction === direction)?.count || 0;
              return <span key={day} style={{ height: `${Math.max(4, (value / max) * 100)}%` }} title={`${day}: ${value}`} />;
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

const permissionTree = [
  { key: "mailboxes", label: "Mailboxes", children: ["Mailboxes", "Add mailbox"] },
  { key: "emails", label: "Mail management", children: ["Inbox", "Sent", "Starred"] },
  { key: "drafts", label: "Drafts and compose", children: ["Compose", "Drafts", "Draft attachments"] },
  { key: "attachments", label: "Attachments", children: ["Attachment list", "Attachment downloads"] },
  { key: "usage", label: "Usage page", children: ["Local quotas", "Trends"] },
  { key: "settings", label: "Personal settings", children: ["Profile", "Auto-delete drafts"] },
  { key: "users", label: "User management", children: ["Users", "Change role"] },
  { key: "roles", label: "Roles and permissions", children: ["Role management", "Permissions"] },
  { key: "system", label: "System settings", children: ["Landing background"] },
  { key: "analysis", label: "Analytics", children: ["Trends", "CSV Export"] },
  { key: "audit", label: "System logs", children: ["Audit logs"] }
];

function AdminRoles() {
  const { data, loading, error, reload } = useAsync<any[]>(() => api("/api/admin/roles"), []);
  const [editing, setEditing] = useState<any | null>(null);
  const create = async () => {
    const name = prompt("Role name");
    if (!name) return;
    await api("/api/admin/roles", { method: "POST", body: JSON.stringify({ name, role_key: name, permissions: ["mailboxes"] }) });
    reload();
  };
  const remove = async (role: any) => {
    if (!confirm(`Delete role ${roleName(role)}?`)) return;
    await api(`/api/admin/roles/${role.id}`, { method: "DELETE" });
    reload();
  };
  if (loading) return <EmptyState title="Loading roles" icon={KeyRound} />;
  if (error) return <div className="alert">{error}</div>;
  return (
    <div className="stack">
      <div className="section-head">
        <h2>Role management</h2>
        <button className="primary" onClick={create}><Plus size={16} />New role</button>
      </div>
      <div className="cloud-table">
        <div className="cloud-table-head role-row"><strong>Role name</strong><span>Order</span><span>Description</span><span>Status</span><span>Default</span><span>Actions</span></div>
        {data?.map((role) => <RoleRow key={role.id} role={role} onEdit={setEditing} onDelete={remove} />)}
      </div>
      {editing && <RoleEditor role={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); reload(); }} />}
    </div>
  );
}

function RoleRow({ role, onEdit, onDelete }: { role: any; onEdit: (role: any) => void; onDelete: (role: any) => void }) {
  const [menuOpen, setMenuOpen] = useState(false);
  return (
    <div className="cloud-table-row role-row">
      <strong>{roleName(role)} {role.is_default ? <span className="mini-tag">Default</span> : null}</strong>
      <span>{role.sort_order}</span>
      <span>{roleDescription(role)}</span>
      <StatusPill value={role.is_system ? "system" : "custom"} />
      <span>{role.is_default ? "Yes" : "No"}</span>
      <div className="dropdown">
        <button onClick={() => setMenuOpen((v) => !v)}>Actions <MoreHorizontal size={15} /></button>
        {menuOpen && (
          <div className="dropdown-menu right">
            <button onClick={() => { onEdit(role); setMenuOpen(false); }}><PenLine size={16} />Edit</button>
            <button onClick={() => { onEdit({ ...role, is_default: 1 }); setMenuOpen(false); }}><Check size={16} />Set as default</button>
            {!role.is_system && <button className="danger" onClick={() => onDelete(role)}><Trash2 size={16} />Delete</button>}
          </div>
        )}
      </div>
    </div>
  );
}

function RoleEditor({ role, onClose, onSaved }: { role: any; onClose: () => void; onSaved: () => void }) {
  const [draft, setDraft] = useState({
    ...role,
    name: roleName(role),
    description: roleDescription(role),
    permissions: Array.isArray(role.permissions) ? role.permissions : JSON.parse(role.permissions || "[]"),
    limits: JSON.parse(role.limits_json || "{}")
  });
  const togglePermission = (key: string) => {
    setDraft((prev: any) => {
      const set = new Set(prev.permissions);
      set.has(key) ? set.delete(key) : set.add(key);
      return { ...prev, permissions: Array.from(set) };
    });
  };
  const save = async () => {
    await api(`/api/admin/roles/${role.id}`, { method: "PATCH", body: JSON.stringify(draft) });
    onSaved();
  };
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true">
      <section className="modal role-modal">
        <div className="section-head">
          <h2>Edit role permissions</h2>
          <button className="icon-button" onClick={onClose} aria-label="Close"><X size={17} /></button>
        </div>
        <div className="split">
          <label>Role name<input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} /></label>
          <label>Order<input type="number" value={draft.sort_order} onChange={(e) => setDraft({ ...draft, sort_order: Number(e.target.value) })} /></label>
        </div>
        <label>Description<input value={draft.description || ""} onChange={(e) => setDraft({ ...draft, description: e.target.value })} /></label>
        <div className="permission-tree">
          {permissionTree.map((node) => (
            <div className="permission-node" key={node.key}>
              <label><input type="checkbox" checked={draft.permissions.includes(node.key)} onChange={() => togglePermission(node.key)} /> {node.label}</label>
              <div>{node.children.map((child) => <span key={child}>{child}</span>)}</div>
            </div>
          ))}
        </div>
        <div className="limit-editor">
          <label>Maximum mailboxes<input type="number" disabled={draft.role_key === "admin"} value={draft.limits.max_mailboxes ?? ""} onChange={(e) => setDraft({ ...draft, limits: { ...draft.limits, max_mailboxes: Number(e.target.value) } })} /></label>
          <label>Daily sent<input type="number" disabled={draft.role_key === "admin"} value={draft.limits.max_send_per_day ?? ""} onChange={(e) => setDraft({ ...draft, limits: { ...draft.limits, max_send_per_day: Number(e.target.value) } })} /></label>
          <label>Daily received<input type="number" disabled={draft.role_key === "admin"} value={draft.limits.max_receive_per_day ?? ""} onChange={(e) => setDraft({ ...draft, limits: { ...draft.limits, max_receive_per_day: Number(e.target.value) } })} /></label>
          <label>Attachment limit(MB)<input type="number" disabled={draft.role_key === "admin"} value={draft.limits.max_attachment_total_mb ?? ""} onChange={(e) => setDraft({ ...draft, limits: { ...draft.limits, max_attachment_total_mb: Number(e.target.value) } })} /></label>
        </div>
        {draft.role_key === "admin" && <div className="alert">Administrator quotas are unlimited, but usage is still tracked.</div>}
        <div className="button-row">
          <button onClick={onClose}>Cancel</button>
          <button className="primary" onClick={save}><Check size={16} />Save</button>
        </div>
      </section>
    </div>
  );
}

function AdminSystemSettings() {
  const { data, loading, error, reload } = useAsync<any>(() => api("/api/admin/system-settings"), []);
  const [draft, setDraft] = useState<Record<string, any>>({});
  useEffect(() => { if (data?.settings) setDraft(data.settings); }, [data]);
  const save = async () => {
    await api("/api/admin/system-settings", { method: "PATCH", body: JSON.stringify({ landing_background_opacity: draft.landing_background_opacity }) });
    reload();
  };
  const uploadBg = async (file: File) => {
    const form = new FormData();
    form.append("file", file);
    await api("/api/admin/system-settings/background", { method: "POST", body: form, headers: {} });
    reload();
  };
  const removeBg = async () => {
    if (!confirm("Delete the custom landing background?")) return;
    await api("/api/admin/system-settings/background", { method: "DELETE" });
    reload();
  };
  const setOpacity = (value: number) => setDraft((prev) => ({ ...prev, landing_background_opacity: Math.max(0, Math.min(1, Number(value.toFixed(2)))) }));
  if (loading) return <EmptyState title="Loading system settings" icon={Settings} />;
  if (error) return <div className="alert">{error}</div>;
  return (
    <div className="panel landing-settings">
      <div className="section-head">
        <h2><Image size={18} />Landing background</h2>
        <button className="primary small-button" onClick={save}><Check size={15} />Save</button>
      </div>
      <div className="landing-bg-editor">
        <div className="landing-preview">
          {draft.landing_background_url ? <img src={`${draft.landing_background_url}?v=${Date.now()}`} alt="Landing background preview" /> : <div className="default-bg-preview">Current default background</div>}
          <i style={{ opacity: Number(draft.landing_background_opacity ?? 0.18) }} />
        </div>
        <div className="stack compact-stack">
          <label className="upload-button">
            <Upload size={16} />
            Upload background
            <input type="file" accept="image/*" onChange={(e) => e.target.files?.[0] && uploadBg(e.target.files[0]).catch(console.error)} />
          </label>
          <label>Opacity
            <div className="number-stepper">
              <button onClick={() => setOpacity(Number(draft.landing_background_opacity ?? 0.18) - 0.05)}>-</button>
              <input type="number" min={0} max={1} step={0.05} value={draft.landing_background_opacity ?? 0.18} onChange={(e) => setOpacity(Number(e.target.value))} />
              <button onClick={() => setOpacity(Number(draft.landing_background_opacity ?? 0.18) + 0.05)}>+</button>
            </div>
          </label>
          {draft.landing_background_url && <button className="danger" onClick={removeBg}><Trash2 size={16} />Remove uploaded image</button>}
        </div>
      </div>
    </div>
  );
}

function SettingsCard({ title, icon: Icon, children }: { title: string; icon: React.ElementType; children: React.ReactNode }) {
  return <section className="panel settings-card"><h2><Icon size={18} />{title}</h2>{children}</section>;
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <label className="toggle-row">
      <span>{label}</span>
      <button className={`switch ${checked ? "on" : ""}`} onClick={() => onChange(!checked)} type="button" aria-pressed={checked}><i /></button>
    </label>
  );
}

function AdminAudit() {
  const [query, setQuery] = useState("");
  const [action, setAction] = useState("");
  const { data, loading, error } = useAsync<any[]>(() => api(`/api/admin/audit-logs?q=${encodeURIComponent(query)}&action=${encodeURIComponent(action)}`), [query, action]);
  if (loading) return <EmptyState title="Loading audit logs" icon={RefreshCw} />;
  if (error) return <div className="alert">{error}</div>;
  return (
    <div className="stack">
      <div className="panel toolbar">
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search user, action, or target" />
        <input value={action} onChange={(e) => setAction(e.target.value)} placeholder="Event type" />
      </div>
      <div className="table">
        {data?.map((log) => (
          <div className="table-row audit-row" key={log.id}>
            <strong>{log.action}</strong>
            <span>{log.actor_username || "system"}</span>
            <span>{log.target_type}:{log.target_id}</span>
            <span>{formatDate(log.created_at)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function App() {
  const [token, setToken] = useState(localStorage.getItem(tokenKey));
  const { data, error, reload } = useAsync<{ user: User }>(() => api("/api/me"), [token]);
  const logout = async () => {
    localStorage.removeItem(tokenKey);
    setToken(null);
    const fallback = {
      auth_center_url: "https://accounts.aryuki.com",
      callback_url: `${window.location.origin}/sso-callback`
    };
    const config = await api<typeof fallback>("/api/public-config").catch(() => fallback);
    const redirect = new URL(config.callback_url, window.location.origin).origin;
    window.location.href = `${config.auth_center_url}/logout?redirect=${encodeURIComponent(redirect)}`;
  };
  if (window.location.pathname === "/sso-callback") return <Callback onDone={() => { setToken(localStorage.getItem(tokenKey)); void reload(); }} />;
  if (!token || error) return <Login />;
  if (!data) return <main className="login"><RefreshCw className="spin" /></main>;
  return <Shell user={data.user} onLogout={() => void logout()} />;
}

createRoot(document.getElementById("root")!).render(<App />);
