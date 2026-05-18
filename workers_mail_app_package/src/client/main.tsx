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
  language?: "zh" | "en";
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
const langKey = "mail_agent_language";
const translations = {
  zh: {
    login: "使用 Auth Center 登录",
    mailboxes: "邮箱列表",
    inbox: "收件箱",
    sent: "发件箱",
    compose: "写邮件",
    drafts: "草稿箱",
    attachments: "附件管理",
    usage: "用量 / 配额",
    settings: "设置",
    search: "搜索",
    createMailbox: "创建邮箱",
    emptyEmails: "没有邮件",
    send: "发送",
    saved: "Draft saved"
  },
  en: {
    login: "Sign in with Auth Center",
    mailboxes: "Mailboxes",
    inbox: "Inbox",
    sent: "Sent",
    compose: "Compose",
    drafts: "Drafts",
    attachments: "Attachments",
    usage: "Usage / Quotas",
    settings: "Settings",
    search: "Search",
    createMailbox: "Create mailbox",
    emptyEmails: "No emails yet",
    send: "Send",
    saved: "Draft saved"
  }
};
type Lang = keyof typeof translations;
const getLang = (): Lang => (localStorage.getItem(langKey) === "en" ? "en" : "zh");
const t = (key: keyof typeof translations.zh) => translations[getLang()][key] || translations.zh[key];
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
      setError(err instanceof Error ? err.message : "加载失败");
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
          <p>创建临时邮箱、收发邮件、管理附件，并用 Gemini Agent 快速生成回复。</p>
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
          <h2>安全登录</h2>
          <p>通过 Auth Center 登录后，后端会在每次 API 请求中校验身份和权限。</p>
          <button className="primary" onClick={login}>
            <Shield size={18} />
            使用 Auth Center 登录
          </button>
        </div>
      </section>
    </main>
  );
}

function Callback({ onDone }: { onDone: () => void }) {
  const [message, setMessage] = useState("正在完成登录...");
  useEffect(() => {
    const token = new URLSearchParams(window.location.search).get("token");
    if (!token) {
      setMessage("登录回调缺少 token");
      return;
    }
    api<{ token: string }>("/api/sso-callback", { method: "POST", body: JSON.stringify({ token }) })
      .then(() => {
        localStorage.setItem(tokenKey, token);
        window.history.replaceState({}, "", "/");
        onDone();
      })
      .catch((err) => setMessage(err instanceof Error ? err.message : "登录失败"));
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
    ["mailboxes", "邮箱管理", Mail],
    ["inbox", "收件箱", Inbox],
    ["sent", "发件箱", Send],
    ["starred", "星标邮件", Star],
    ["compose", "写邮件", PenLine],
    ["drafts", "草稿", FileText],
    ["attachments", "附件", Paperclip],
    ["usage", "用量", BarChart3],
    ["settings", "个人设置", Settings]
  ] as const;
  const adminNav = [
    ["admin-analysis", "分析统计", BarChart3],
    ["admin-users", "用户列表", Users],
    ["admin-mailboxes", "邮件列表", Archive],
    ["admin-roles", "权限控制", KeyRound],
    ["admin-system", "系统设置", SlidersHorizontal],
    ["admin-audit", "系统日志", Shield]
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
      {sidebarOpen && <button className="sidebar-scrim" aria-label="关闭导航" onClick={() => setSidebarOpen(false)} />}
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
          <button className="icon-button menu-button" aria-label="打开导航" onClick={() => setSidebarOpen(true)}><Menu size={19} /></button>
          <div className="page-title"><strong>{routeLabel(route)}</strong></div>
          <GlobalSearch label={routeLabel(route)} />
          <div className="top-actions">
            <button className="round-primary" title="写邮件" onClick={() => setRoute("compose")}><PenLine size={18} /></button>
            <button className="icon-button" aria-label="切换主题" onClick={() => setDark(!dark)}>{dark ? <Sun size={18} /> : <Moon size={18} />}</button>
            <div className="avatar">{user.avatar_url ? <img src={user.avatar_url} alt={user.username} /> : user.username.slice(0, 1).toUpperCase()}</div>
            <strong>{user.username}</strong>
            <button className="icon-button" aria-label="退出登录" onClick={onLogout}><LogOut size={18} /></button>
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
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={`${label} · ${t("search")}`} />
      {results && (
        <div className="search-popover">
          {!count && <span className="muted">无结果</span>}
          {!!results.mailboxes?.length && <SearchGroup title="邮箱" rows={results.mailboxes} render={(row: any) => <button onClick={() => { setRoute("mailboxes"); setQ(""); }}>{row.email}<small>{row.alias}</small></button>} />}
          {!!results.emails?.length && <SearchGroup title="邮件" rows={results.emails} render={(row: any) => <button onClick={() => { setRoute(`email:${row.id}`); setQ(""); }}>{row.subject || "(no subject)"}<small>{row.from_addr || row.to_addr}</small></button>} />}
          {!!results.attachments?.length && <SearchGroup title="附件" rows={results.attachments} render={(row: any) => <button onClick={() => { setRoute("attachments"); setQ(""); }}>{row.filename}<small>{formatBytes(row.size_bytes)}</small></button>} />}
          {!!results.users?.length && <SearchGroup title="用户" rows={results.users} render={(row: any) => <button onClick={() => { setRoute("admin-users"); setQ(""); }}>{row.username}<small>{row.status}</small></button>} />}
        </div>
      )}
    </div>
  );
}

function SearchGroup({ title, rows, render }: { title: string; rows: any[]; render: (row: any) => React.ReactNode }) {
  return <section><strong>{title}</strong>{rows.map((row) => <React.Fragment key={row.id}>{render(row)}</React.Fragment>)}</section>;
}

function routeLabel(route: string) {
  if (route.startsWith("email:")) return "邮件详情";
  if (route.startsWith("compose:")) return "写邮件";
  const labels: Record<string, string> = {
    mailboxes: "邮箱列表",
    inbox: "收件箱",
    sent: "发件箱",
    starred: "星标邮件",
    compose: "写邮件",
    drafts: "草稿箱",
    attachments: "附件管理",
    usage: "用量 / 配额",
    settings: "设置",
    "admin-users": "用户管理",
    "admin-mailboxes": "邮箱管理",
    "admin-analysis": "Analysis",
    "admin-roles": "权限控制",
    "admin-system": "系统设置",
    "admin-audit": "审计日志"
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
  if (route.startsWith("compose:")) return can("drafts") ? <Compose draftId={route.slice(8)} /> : <EmptyState title="当前身份无权使用写邮件" icon={Shield} />;
  if (route === "inbox") return can("emails") ? <EmailList direction="inbound" /> : <EmptyState title="当前身份无权查看邮件" icon={Shield} />;
  if (route === "sent") return can("emails") ? <EmailList direction="outbound" /> : <EmptyState title="当前身份无权查看发件箱" icon={Shield} />;
  if (route === "starred") return can("emails") ? <EmailList starredOnly /> : <EmptyState title="当前身份无权查看星标邮件" icon={Shield} />;
  if (route === "compose") return can("drafts") ? <Compose /> : <EmptyState title="当前身份无权写邮件" icon={Shield} />;
  if (route === "drafts") return can("drafts") ? <Drafts /> : <EmptyState title="当前身份无权查看草稿" icon={Shield} />;
  if (route === "attachments") return can("attachments") ? <Attachments user={user} /> : <EmptyState title="当前身份无权查看附件" icon={Shield} />;
  if (route === "usage") return can("usage") ? <Usage /> : <EmptyState title="当前身份无权查看用量" icon={Shield} />;
  if (route === "settings") return <SettingsPage user={user} />;
  if (route === "admin-users") return can("users") ? <AdminUsers /> : <EmptyState title="当前身份无权管理用户" icon={Shield} />;
  if (route === "admin-mailboxes") return can("emails") || can("mailboxes") ? <AdminMailboxes /> : <EmptyState title="当前身份无权管理邮箱" icon={Shield} />;
  if (route === "admin-analysis") return can("analysis") ? <AdminAnalysis /> : <EmptyState title="当前身份无权查看分析" icon={Shield} />;
  if (route === "admin-roles") return can("roles") ? <AdminRoles /> : <EmptyState title="当前身份无权管理权限" icon={Shield} />;
  if (route === "admin-system") return can("system") ? <AdminSystemSettings /> : <EmptyState title="当前身份无权管理系统设置" icon={Shield} />;
  if (route === "admin-audit") return can("audit") ? <AdminAudit /> : <EmptyState title="当前身份无权查看审计日志" icon={Shield} />;
  return can("mailboxes") ? <Mailboxes /> : <EmptyState title="当前身份无权查看邮箱" icon={Shield} />;
}

function DraftHistory({ draftId }: { draftId: string }) {
  const { data, loading, error } = useAsync<any[]>(() => api(`/api/drafts/${draftId}/history`), [draftId]);
  if (loading) return <EmptyState title="正在加载草稿历史" icon={RefreshCw} />;
  if (error) return <div className="alert">{error}</div>;
  return (
    <div className="stack">
      <div className="section-head">
        <h2>草稿历史</h2>
        <button onClick={() => setRoute(`compose:${draftId}`)}><ChevronRight className="back" size={17} />返回草稿</button>
      </div>
      {!data?.length ? <EmptyState title="暂无历史版本" icon={FileText} /> : data.map((v) => (
        <article className="panel" key={v.id}>
          <strong>{v.subject || "(no subject)"}</strong>
          <small>{new Date(v.created_at).toLocaleString()}</small>
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
      setNotice(err instanceof Error ? err.message : "创建失败");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="mail-workbench">
      <aside className="mailbox-rail panel">
        <div className="section-head">
          <h2>Cloud 邮箱</h2>
          <button className="icon-button primary" disabled={busy} onClick={() => setCreateOpen(true)} title="新增邮箱"><Plus size={18} /></button>
        </div>
        <div className="toolbar compact-toolbar">
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="搜索邮箱或别名" />
          <select value={sort} onChange={(e) => setSort(e.target.value)} title="排序">
            <option value="created_desc">最新</option>
            <option value="created_asc">最早</option>
            <option value="local_part">地址</option>
            <option value="status">状态</option>
          </select>
        </div>
        {notice && <div className="alert">{notice}</div>}
        {error && <div className="alert">{error}</div>}
        {loading ? <EmptyState title="正在加载邮箱" icon={RefreshCw} /> : !data?.length ? <EmptyState title="还没有邮箱" /> : (
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
                <span className="eyebrow">当前邮箱</span>
                <h2>{selected.email}</h2>
                {selected.alias && <p>{selected.alias}</p>}
              </div>
              <div className="summary-stats">
                <span>收件 <strong>{selected.inbound_count || 0}</strong></span>
                <span>发件 <strong>{selected.outbound_count || 0}</strong></span>
                <span>附件 <strong>{formatBytes(selected.attachment_bytes || 0)}</strong></span>
              </div>
            </div>
            <EmailList mailboxId={selected.id} compactTitle="邮件列表" />
          </>
        ) : <EmptyState title="选择一个邮箱查看邮件" icon={Mail} />}
      </section>
      {createOpen && (
        <div className="modal-backdrop" role="dialog" aria-modal="true">
          <section className="modal small-modal">
            <div className="section-head">
              <h2>新增邮箱</h2>
              <button className="icon-button" onClick={() => setCreateOpen(false)}><X size={16} /></button>
            </div>
            <label>邮箱地址<div className="input-suffix"><input value={local} onChange={(e) => setLocal(e.target.value)} placeholder="new-address" /><span>@112327.xyz</span></div></label>
            <label>别名 / 用途<input value={alias} onChange={(e) => setAlias(e.target.value)} placeholder="例如：购物、测试、注册" /></label>
            <div className="button-row compact-actions"><button onClick={() => setCreateOpen(false)}>取消</button><button className="primary" disabled={busy} onClick={createMailbox}><Plus size={16} />创建</button></div>
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
    if (!confirm(`确定删除 ${box.email}？`)) return;
    await api(`/api/mailboxes/${box.id}`, { method: "DELETE" });
    onReload();
  };
  return (
    <article className={`mailbox-card cloud ${active ? "active" : ""}`}>
      <button className="mailbox-main" onClick={onSelect}>
        <span className="mailbox-badge"><Mail size={18} /></span>
        <span>
          <strong>{box.email}</strong>
          <small>{box.alias || "未设置别名"}</small>
        </span>
      </button>
      <div className="mailbox-stats">
        <span>收 {box.inbound_count || 0}</span>
        <span>发 {box.outbound_count || 0}</span>
        <span>{formatBytes(box.attachment_bytes || 0)}</span>
      </div>
      <div className="mailbox-card-footer">
        <StatusPill value={box.status} />
        <div className="dropdown">
          <button className="icon-button" aria-label="邮箱操作" onClick={() => setMenuOpen((v) => !v)}><MoreHorizontal size={17} /></button>
          {menuOpen && (
            <div className="dropdown-menu">
              <label>别名<input value={alias} onChange={(e) => setAlias(e.target.value)} /></label>
              <button onClick={saveAlias}><Check size={16} />保存别名</button>
              {["active", "disabled", "receive_only", "send_only", "frozen"].map((s) => <button key={s} onClick={() => update(s)}>{s}</button>)}
              <button className="danger" onClick={remove}><Trash2 size={16} />删除邮箱</button>
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
  const title = compactTitle || (starredOnly ? "星标邮件" : direction === "outbound" ? "发件箱" : "收件箱");
  return (
    <div className="stack">
      <div className="section-head">
        <h2>{title}</h2>
        <button onClick={reload}><RefreshCw size={17} />刷新</button>
      </div>
      <div className="panel toolbar">
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="搜索主题、发件人、收件人或正文" />
        <select value={read} onChange={(e) => setRead(e.target.value)}>
          <option value="">全部</option>
          <option value="unread">未读</option>
          <option value="read">已读</option>
        </select>
        <select value={folder} onChange={(e) => setFolder(e.target.value)}>
          <option value="">邮件</option>
          <option value="archive">归档</option>
          <option value="trash">垃圾箱</option>
        </select>
        <label className="check-filter"><input type="checkbox" checked={hasAttachment} onChange={(e) => setHasAttachment(e.target.checked)} /> 有附件</label>
      </div>
      {!!selected.length && (
        <div className="action-bar">
          <strong>已选择 {selected.length}</strong>
          <button onClick={() => bulk("mark_read")}><Eye size={16} />标为已读</button>
          <button onClick={() => bulk("mark_unread")}><Mail size={16} />标为未读</button>
          <button onClick={() => bulk("archive")}><Archive size={16} />归档</button>
          <button className="danger" onClick={() => bulk("delete")}><Trash2 size={16} />删除</button>
        </div>
      )}
      {error && <div className="alert">{error}</div>}
      {loading ? <EmptyState title="正在加载邮件" icon={RefreshCw} /> : !data?.length ? <EmptyState title="没有邮件" icon={Inbox} /> : (
        <div className="mail-list">
          {data.map((email) => (
            <div className={`mail-row ${email.is_read ? "" : "unread"}`} key={email.id}>
              <button className="icon-button" aria-label="选择邮件" onClick={() => toggle(email.id)}>{selected.includes(email.id) ? <CheckSquare size={18} /> : <Square size={18} />}</button>
              <button className={`icon-button star-button ${(optimisticStars[email.id] ?? email.is_starred) ? "active" : ""}`} aria-label={(optimisticStars[email.id] ?? email.is_starred) ? "取消星标" : "星标邮件"} onClick={() => star(email).catch(console.error)}><Star size={18} /></button>
              <button className="mail-copy" onClick={() => setRoute(`email:${email.id}`)}>
                <div><strong>{email.direction === "inbound" ? email.from_addr : email.to_addr}</strong><span>{new Date(email.created_at).toLocaleString()}</span></div>
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
  if (loading) return <EmptyState title="正在打开邮件" icon={RefreshCw} />;
  if (error) return <div className="alert">{error}</div>;
  if (!data) return null;
  return (
    <article className="panel email-detail">
      <header>
        <button onClick={() => returnRoute ? setRoute(returnRoute) : history.back()}><ChevronRight className="back" size={17} />{returnRoute === "attachments" ? "返回附件" : "返回"}</button>
        <StatusPill value={data.status} />
      </header>
      <h2>{data.subject || "(no subject)"}</h2>
      <div className="meta-grid">
        <span>From</span><strong>{data.from_addr}</strong>
        <span>To</span><strong>{data.to_addr}</strong>
      </div>
      <pre className="body-text">{data.text_body}</pre>
      {data.html_body && <iframe className="html-frame" sandbox="" srcDoc={data.html_body} title="HTML 邮件内容" />}
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
    if (!confirm("确定删除这份草稿？")) return;
    await api(`/api/drafts/${id}`, { method: "DELETE" });
    reload();
  };
  const toggle = (id: string) => setSelected((prev) => prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]);
  const bulkRemove = async () => {
    if (!selected.length || !confirm(`确定删除 ${selected.length} 份草稿？`)) return;
    await api("/api/drafts", { method: "DELETE", body: JSON.stringify({ ids: selected }) });
    setSelected([]);
    reload();
  };
  return (
    <div className="stack">
      <div className="section-head">
        <h2>草稿箱</h2>
        <button className="primary" onClick={create}><Plus size={17} />新草稿</button>
      </div>
      <div className="panel toolbar">
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="搜索主题或收件人" />
        {!!selected.length && <button className="danger" onClick={bulkRemove}><Trash2 size={16} />批量删除 {selected.length}</button>}
      </div>
      {error && <div className="alert">{error}</div>}
      {loading ? <EmptyState title="正在加载草稿" icon={RefreshCw} /> : !data?.length ? <EmptyState title="没有草稿" icon={FileText} /> : (
        <div className="table">
          {data.map((draft) => (
            <div className="table-row" key={draft.id}>
              <button className="icon-button" onClick={() => toggle(draft.id)}>{selected.includes(draft.id) ? <CheckSquare size={17} /> : <Square size={17} />}</button>
              <button className="link-row" onClick={() => setRoute(`compose:${draft.id}`)}>
                <strong>{draft.subject || "(no subject)"}</strong>
                <span>{draft.to_addr || "未填写收件人"}</span>
                <span>{new Date(draft.updated_at).toLocaleString()}</span>
              </button>
              <button className="icon-button danger" aria-label="删除草稿" onClick={() => remove(draft.id)}><Trash2 size={17} /></button>
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
    if (!toList.length) errors.to_addr = "至少填写一个 To 收件人";
    const bad = toList.find((addr) => !emailRe.test(addr));
    if (bad) errors.to_addr = `地址格式不正确：${bad}`;
    if (!draft?.subject?.trim()) errors.subject = "主题为空，仍可发送，但建议补充";
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
      setNotice(`已进入发送队列：${sent.id}`);
      setRoute("sent");
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "发送失败");
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
  const wrapSelection = (before: string, after = before, fallback = "文本") => {
    const current = draft?.text_body || "";
    const start = textRef.current?.selectionStart ?? current.length;
    const end = textRef.current?.selectionEnd ?? current.length;
    const picked = current.slice(start, end) || fallback;
    update({ text_body: `${current.slice(0, start)}${before}${picked}${after}${current.slice(end)}` });
    window.setTimeout(() => textRef.current?.focus(), 0);
  };

  if (!draft) return <EmptyState title="正在准备草稿" icon={RefreshCw} />;
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
            <option value="">选择发件邮箱</option>
            {mailboxes.filter((m) => ["active", "send_only"].includes(m.status)).map((m) => <option value={m.id} key={m.id}>{m.email}{m.alias ? ` · ${m.alias}` : ""}</option>)}
          </select>
          <span className={savedPulse ? "save-pulse" : ""}>{saving ? "保存中..." : "Draft saved"}</span>
          {draft.id && <button onClick={() => setRoute(`compose:${draft.id}:history`)}><FileText size={16} />历史</button>}
          <button className="primary" onClick={sendMail}><Send size={17} />发送</button>
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
        <div className="editor-toolbar" aria-label="编辑器工具栏">
          <button title="加粗" onClick={() => wrapSelection("**")}><strong>B</strong></button>
          <button title="斜体" onClick={() => wrapSelection("*")}><em>I</em></button>
          <button title="下划线" onClick={() => wrapSelection("<u>", "</u>")}>U</button>
          <button title="列表" onClick={() => wrapSelection("- ", "", "列表项")}><FileText size={16} /></button>
          <button title="链接" onClick={() => wrapSelection("[", "](https://)", "链接文本")}><Copy size={16} /></button>
          <button title="代码" onClick={() => wrapSelection("`")}><span>{"<>"}</span></button>
          <button title="预览" className={preview ? "active" : ""} onClick={() => setPreview((v) => !v)}><Eye size={16} /></button>
          <button title="全屏编辑" className={wideEditor ? "active" : ""} onClick={() => setWideEditor((v) => !v)}><ChevronRight size={16} /></button>
        </div>
        {preview ? <pre className="body-text editor-preview">{draft.text_body || "暂无正文"}</pre> : <textarea ref={textRef} value={draft.text_body || ""} onChange={(e) => update({ text_body: e.target.value })} placeholder="正文" />}
        <div className="attachment-strip">
          {(draft.attachments || []).map((att) => <AttachmentCard key={att.id} att={att} onRemove={() => removeAttachment(att.id).catch((err) => setNotice(err.message))} />)}
          <label className="upload-button">
            <Upload size={17} />
            上传或拖拽附件
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
      setError(err instanceof Error ? err.message : "Agent 请求失败");
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
        <button disabled={busy} onClick={generate}><Sparkles size={17} />生成</button>
      </div>
      <select value={command} onChange={(e) => setCommand(e.target.value)}>
        <option value="generate_email">生成邮件</option>
        <option value="draft_reply">Draft reply</option>
        <option value="translate_en">Translate to English</option>
        <option value="reply_email">回复邮件</option>
        <option value="polish">润色</option>
        <option value="rewrite_tone">改写语气</option>
        <option value="summarize">总结收到的邮件</option>
        <option value="subject">生成主题</option>
        <option value="reply_suggestions">生成回复建议</option>
      </select>
      <textarea value={input} onChange={(e) => setInput(e.target.value)} placeholder="输入意图或上下文" />
      {error && <div className="alert">{error}</div>}
      {job && (
        <div className="agent-result">
          <StatusPill value={job.status} />
          {job.error && <small>{job.error}</small>}
          {job.output && <div className="candidate-list">{job.output.split(/\n{2,}/).filter(Boolean).map((part, idx) => <article className="candidate" key={idx}><span>Candidate {idx + 1}</span><p>{part}</p><div className="button-row"><button onClick={() => onInsert(part, "append")}><Plus size={16} />插入</button><button onClick={() => onInsert(part, "selection")}><PenLine size={16} />替换选区</button></div></article>)}</div>}
          {job.output && (
            <div className="button-row">
              <button onClick={() => onInsert(job.output || "", "append")}><Plus size={16} />插入</button>
              <button onClick={() => onInsert(job.output || "", "selection")}><PenLine size={16} />替换选区</button>
              <button onClick={() => onInsert(job.output || "", "replace")}><Check size={16} />替换正文</button>
              <button onClick={() => navigator.clipboard.writeText(job.output || "")}><Copy size={16} />复制</button>
            </div>
          )}
          {job.status === "failed" && <button onClick={retry}><RefreshCw size={16} />重试</button>}
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
      {onRemove && <button className="icon-button danger" aria-label="移除附件" onClick={onRemove}><X size={16} /></button>}
    </div>
  );
}

function AttachmentChip({ att }: { att: Attachment }) {
  const download = async () => {
    const token = localStorage.getItem(tokenKey);
    const res = await fetch(`/api/attachments/${att.id}/download`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {}
    });
    if (!res.ok) throw new Error("下载失败");
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
    if (!confirm("确定清理超过保留期或未关联的附件？")) return;
    await api("/api/attachments/cleanup", { method: "POST", body: JSON.stringify({ retention_days: 30 }) });
    reload();
  };
  return (
    <div className="stack">
      <div className="section-head">
        <h2>附件管理</h2>
        {user.role === "admin" && <button onClick={cleanup}><Trash2 size={17} />清理</button>}
      </div>
      <div className="panel toolbar">
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="搜索附件名" />
        <select value={type} onChange={(e) => setType(e.target.value)}>
          <option value="">全部类型</option>
          <option value="image">图片</option>
          <option value="pdf">PDF</option>
          <option value="document">文档</option>
          <option value="archive">压缩包</option>
        </select>
        <select value={sort} onChange={(e) => setSort(e.target.value)}>
          <option value="created_desc">最新上传</option>
          <option value="created_asc">最早上传</option>
          <option value="name">文件名</option>
          <option value="size">大小</option>
        </select>
      </div>
      {error && <div className="alert">{error}</div>}
      {loading ? <EmptyState title="正在加载附件" icon={RefreshCw} /> : !data?.length ? <EmptyState title="没有附件" icon={Paperclip} /> : (
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
        <small>{new Date(att.created_at).toLocaleString()}</small>
        <span>{formatBytes(att.size_bytes)} · {att.content_type || att.file_type || "file"}</span>
        <span>{att.email_subject || att.draft_subject || "未关联邮件标题"}</span>
      </div>
      <div className="attachment-tile-actions">
        <AttachmentChip att={att} />
        {(att.email_id || att.draft_id) && <button onClick={openTarget}><ChevronRight size={15} />转到</button>}
      </div>
    </article>
  );
}

function Usage() {
  const { data, loading, error } = useAsync<{ limits: Record<string, number>; usage: Record<string, any> }>(() => api("/api/usage"), []);
  const [days, setDays] = useState(7);
  const trends = useAsync<{ counters: any[]; mailboxes: any[] }>(() => api(`/api/usage/trends?days=${days}`), [days]);
  if (loading) return <EmptyState title="正在加载用量" icon={RefreshCw} />;
  if (error) return <div className="alert">{error}</div>;
  if (!data) return null;
  const items = [
    ["邮箱", data.usage.mailboxes, data.limits.max_mailboxes],
    ["今日发送", data.usage.send.count, data.limits.max_send_per_day],
    ["今日接收", data.usage.receive.count, data.limits.max_receive_per_day],
    ["附件占用", formatBytes(data.usage.attachment_bytes), formatBytes(data.limits.max_attachment_total_bytes)],
    ["Tokens", data.usage.tokens.count, "Auth Center"]
  ];
  const localQuotaItems = items.filter(([label]) => label !== "Tokens");
  const tokenItem = items.find(([label]) => label === "Tokens");
  return (
    <div className="stack">
      <div className="usage-explainer panel">
        <div>
          <h2>用量与限制</h2>
          <p>Tokens 调用额度由 Auth Center 统一控制；邮箱数、收发数、附件数量与附件大小由本应用按身份权限和本地配额控制。</p>
        </div>
        {tokenItem && <div className="token-card"><span>{tokenItem[0]}</span><strong>{tokenItem[1]}</strong><small>{String(tokenItem[2])}</small></div>}
      </div>
      <div className="metric-grid compact-metrics">{localQuotaItems.map(([label, used, limit]) => <div className="metric" key={label}><span>{label}</span><strong>{used}</strong><small>上限：{String(limit)}</small></div>)}</div>
      <div className="section-head">
        <h2>用量趋势</h2>
        <div className="segments">{[7, 30, 90].map((d) => <button className={days === d ? "active" : ""} onClick={() => setDays(d)} key={d}>{d} 日</button>)}</div>
      </div>
      <TrendChart rows={trends.data?.counters || []} />
    </div>
  );
}

function TrendChart({ rows }: { rows: Array<{ day: string; type: string; count: number; bytes: number }> }) {
  const days = Array.from(new Set(rows.map((r) => r.day)));
  const types = [
    { key: "send", label: "发送" },
    { key: "receive", label: "接收" },
    { key: "attachment", label: "附件大小" }
  ];
  const max = Math.max(1, ...rows.filter((r) => r.type !== "tokens").map((r) => r.type === "attachment" ? r.bytes : r.count));
  return (
    <div className="panel trend-chart">
      {!rows.length ? <EmptyState title="暂无趋势数据" icon={BarChart3} /> : types.map((type) => (
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
  const [language, setLanguage] = useState<Lang>(getLang());
  const [theme, setTheme] = useState(user.theme || "system");
  const [draftRetentionDays, setDraftRetentionDays] = useState(user.draft_retention_days || 7);
  const [notice, setNotice] = useState("");
  const save = async () => {
    await api("/api/me/settings", { method: "PATCH", body: JSON.stringify({ display_name: displayName, avatar_url: avatarUrl, language, theme, draft_retention_days: draftRetentionDays }) });
    localStorage.setItem(langKey, language);
    localStorage.setItem("theme", theme === "system" ? "" : theme);
    setNotice("设置已保存");
  };
  return (
    <div className="panel settings-page compact-settings">
      <h2>个人设置</h2>
      {notice && <div className="alert">{notice}</div>}
      <div className="meta-grid compact-meta">
        <span>Username</span><strong>{user.username}</strong>
        <span>身份</span><strong>{user.app_role_name || user.role}</strong>
      </div>
      <div className="settings-form-grid">
        <label>显示名称<input value={displayName} onChange={(e) => setDisplayName(e.target.value)} /></label>
        <label>头像 URL<input value={avatarUrl} onChange={(e) => setAvatarUrl(e.target.value)} /></label>
        <label>语言<select value={language} onChange={(e) => setLanguage(e.target.value as Lang)}><option value="zh">中文</option><option value="en">English</option></select></label>
        <label>主题<select value={theme} onChange={(e) => setTheme(e.target.value as any)}><option value="system">System</option><option value="light">Light</option><option value="dark">Dark</option></select></label>
        <label>草稿定时删除<select value={draftRetentionDays} onChange={(e) => setDraftRetentionDays(Number(e.target.value))}><option value={1}>1 天</option><option value={3}>3 天</option><option value={7}>1 周</option><option value={30}>1 月</option></select></label>
      </div>
      <div className="settings-actions">
        <button className="primary small-button" onClick={save}><Check size={15} />保存</button>
        <a className="outline-link" href={`${authUrl}/change-password`} target="_blank" rel="noreferrer"><Shield size={15} />修改密码</a>
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
  if (loading) return <EmptyState title="正在加载用户" icon={RefreshCw} />;
  if (error) return <div className="alert">{error}</div>;
  return (
    <div className="stack">
      <div className="panel toolbar">
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="搜索用户" />
        <select value={status} onChange={(e) => setStatusFilter(e.target.value)}><option value="">全部状态</option><option value="active">active</option><option value="frozen">frozen</option></select>
        <button onClick={reload}><RefreshCw size={16} />刷新</button>
        <button onClick={exportCsv}><Download size={16} />导出</button>
      </div>
      <div className="cloud-table admin-table">
        <div className="cloud-table-head admin-user-row">
          <span></span><strong>用户邮箱</strong><span>收件数量</span><span>发件数量</span><span>邮箱数量</span><span>注册时间</span><span>状态</span><span>身份类型</span><span>附件占用</span><span>操作</span>
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
        <button className="icon-button" aria-label="展开用户详情" onClick={() => setExpanded((v) => !v)}><ChevronRight className={expanded ? "rotate" : ""} size={16} /></button>
        <strong>{user.username}</strong>
        <span>{user.received_count || 0}</span>
        <span>{user.sent_count || 0}</span>
        <span>{user.mailbox_count || 0}</span>
        <span>{new Date(user.created_at).toLocaleString()}</span>
        <StatusPill value={user.status} />
        <StatusPill value={user.app_role_name || user.role} />
        <span>{formatBytes(user.attachment_bytes || 0)}</span>
        <div className="dropdown table-actions">
          <button onClick={() => setMenuOpen((v) => !v)}>操作 <MoreHorizontal size={15} /></button>
          {menuOpen && (
            <div className="dropdown-menu right">
              <button onClick={() => { setRoleOpen(true); setMenuOpen(false); }}><UserCog size={16} />修改身份</button>
              <button onClick={() => { onStatus(user, user.status === "active" ? "frozen" : "active"); setMenuOpen(false); }}><Shield size={16} />{user.status === "active" ? "禁用" : "启用"}</button>
              <button onClick={() => { onReset(user); setMenuOpen(false); }}><RefreshCw size={16} />重置今日配额</button>
              <button onClick={() => { setRoute("admin-mailboxes"); setMenuOpen(false); }}><Mail size={16} />查看邮箱列表</button>
            </div>
          )}
        </div>
      </div>
      {expanded && (
        <div className="user-expand">
          <div className="detail-grid">
            <span>注册 IP</span><strong>{user.last_login_ip || "未记录"}</strong>
            <span>最近登录</span><strong>{user.last_login_at ? new Date(user.last_login_at).toLocaleString() : "未记录"}</strong>
            <span>设备与浏览器</span><strong>{user.last_login_user_agent || "未记录"}</strong>
          </div>
          <div className="quota-grid">
            <QuotaBar label="发送次数" value={user.sent_count || 0} limit={user.max_send_per_day} percent={sendPercent} />
            <QuotaBar label="附件占用" value={formatBytes(user.attachment_bytes || 0)} limit={formatBytes(user.max_attachment_total_bytes || 0)} percent={attachmentPercent} />
            <QuotaBar label="邮箱数量" value={user.mailbox_count || 0} limit={user.max_mailboxes} percent={Math.min(100, ((user.mailbox_count || 0) / Math.max(1, Number(user.max_mailboxes || 1))) * 100)} />
          </div>
          <div className="quota-readonly">
            <span>身份：<strong>{user.app_role_name || "默认身份"}</strong></span>
            <span>邮箱上限：<strong>{user.max_mailboxes}</strong></span>
            <span>每日发送：<strong>{user.max_send_per_day}</strong></span>
            <span>每日接收：<strong>{user.max_receive_per_day}</strong></span>
            <span>附件上限：<strong>{formatBytes(user.max_attachment_total_bytes || 0)}</strong></span>
          </div>
        </div>
      )}
      {roleOpen && (
        <div className="modal-backdrop" role="dialog" aria-modal="true">
          <section className="modal small-modal">
            <div className="section-head">
              <h2>修改用户身份</h2>
              <button className="icon-button" onClick={() => setRoleOpen(false)}><X size={16} /></button>
            </div>
            <p className="muted">身份决定用户能看到和使用的页面，也会同步对应的邮箱、收发和附件配额。Tokens 额度仍由 Auth Center 控制。</p>
            <label>选择身份<select value={roleId} onChange={(e) => setRoleId(e.target.value)}>{roles.map((role) => <option key={role.id} value={role.id}>{role.name}{role.is_default ? " · 默认" : ""}</option>)}</select></label>
            <div className="button-row compact-actions"><button onClick={() => setRoleOpen(false)}>取消</button><button className="primary" onClick={() => { onRole(user, roleId); setRoleOpen(false); }}><Check size={16} />保存</button></div>
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
  if (loading) return <EmptyState title="正在加载邮箱" icon={RefreshCw} />;
  if (error) return <div className="alert">{error}</div>;
  return (
    <div className="stack">
      <div className="panel toolbar">
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="搜索邮箱、别名或用户" />
        <select value={status} onChange={(e) => setStatusFilter(e.target.value)}><option value="">全部状态</option>{["active", "disabled", "receive_only", "send_only", "frozen", "deleted"].map((s) => <option key={s}>{s}</option>)}</select>
        <select value={sort} onChange={(e) => setSort(e.target.value)}><option value="created_desc">最新</option><option value="local_part">地址</option><option value="owner">用户</option><option value="status">状态</option></select>
      </div>
      <div className="table">
        {data?.map((box) => (
          <div className="table-row" key={box.id}>
            <strong>{box.email}</strong>
            <span>{box.alias || "无别名"}</span>
            <span>{box.username}</span>
            <span>收 {box.inbound_count || 0} / 发 {box.outbound_count || 0}</span>
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
  if (loading) return <EmptyState title="正在加载分析" icon={RefreshCw} />;
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
          <div className="segments">{[1, 7, 30].map((d) => <button className={days === d ? "active" : ""} onClick={() => setDays(d)} key={d}>{d === 1 ? "今日" : `${d} 日`}</button>)}</div>
          <button onClick={downloadCsv}><Download size={16} />CSV</button>
        </div>
      </div>
      <div className="metric-grid">
        <div className="metric"><span>Tokens</span><strong>{totals.tokens}</strong><small>Auth Center + 本地记录</small></div>
        <div className="metric"><span>发送</span><strong>{totals.sent}</strong><small>Queue/Resend</small></div>
        <div className="metric"><span>接收</span><strong>{totals.received}</strong><small>Email Worker</small></div>
        <div className="metric"><span>附件</span><strong>{formatBytes(totals.attachments)}</strong><small>R2</small></div>
      </div>
      <div className="charts">
        <TrendLine title="收发趋势" rows={data?.by_day || []} />
        <BarChart title="Tokens 用量" rows={users.map((u) => ({ label: u.username, value: u.tokens }))} />
        <BarChart title="邮箱数量排行" rows={users.map((u) => ({ label: u.username, value: u.mailboxes }))} />
        <BarChart title="附件占用排行" rows={users.map((u) => ({ label: u.username, value: u.attachment_bytes, display: formatBytes(u.attachment_bytes) }))} />
        <BarChart title="Agent 生成次数" rows={users.map((u) => ({ label: u.username, value: u.agent_jobs }))} />
      </div>
    </div>
  );
}

function BarChart({ title, rows }: { title: string; rows: Array<{ label: string; value: number; display?: string }> }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <div className="panel chart">
      <h3>{title}</h3>
      {!rows.length ? <EmptyState title="暂无数据" icon={BarChart3} /> : rows.map((row) => (
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
      {!rows.length ? <EmptyState title="暂无趋势数据" icon={BarChart3} /> : ["inbound", "outbound"].map((direction) => (
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
  { key: "mailboxes", label: "邮箱管理", children: ["邮箱列表", "添加邮箱"] },
  { key: "emails", label: "邮件管理", children: ["收件箱", "发件箱", "星标邮件"] },
  { key: "drafts", label: "草稿与写信", children: ["写邮件", "草稿箱", "草稿附件"] },
  { key: "attachments", label: "附件管理", children: ["附件列表", "附件下载"] },
  { key: "usage", label: "用量页面", children: ["本地配额", "趋势图"] },
  { key: "settings", label: "个人设置", children: ["个人资料", "草稿定时删除"] },
  { key: "users", label: "用户管理", children: ["用户列表", "修改身份"] },
  { key: "roles", label: "身份与权限", children: ["角色管理", "权限树"] },
  { key: "system", label: "系统设置", children: ["落地页背景"] },
  { key: "analysis", label: "分析统计", children: ["趋势图", "CSV 导出"] },
  { key: "audit", label: "系统日志", children: ["审计日志"] }
];

function AdminRoles() {
  const { data, loading, error, reload } = useAsync<any[]>(() => api("/api/admin/roles"), []);
  const [editing, setEditing] = useState<any | null>(null);
  const create = async () => {
    const name = prompt("角色名称");
    if (!name) return;
    await api("/api/admin/roles", { method: "POST", body: JSON.stringify({ name, role_key: name, permissions: ["mailboxes"] }) });
    reload();
  };
  const remove = async (role: any) => {
    if (!confirm(`确定删除角色 ${role.name}？`)) return;
    await api(`/api/admin/roles/${role.id}`, { method: "DELETE" });
    reload();
  };
  if (loading) return <EmptyState title="正在加载角色" icon={KeyRound} />;
  if (error) return <div className="alert">{error}</div>;
  return (
    <div className="stack">
      <div className="section-head">
        <h2>角色管理</h2>
        <button className="primary" onClick={create}><Plus size={16} />新增角色</button>
      </div>
      <div className="cloud-table">
        <div className="cloud-table-head role-row"><strong>角色名称</strong><span>排序</span><span>描述</span><span>状态</span><span>是否默认</span><span>操作</span></div>
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
      <strong>{role.name} {role.is_default ? <span className="mini-tag">默认</span> : null}</strong>
      <span>{role.sort_order}</span>
      <span>{role.description || "无描述"}</span>
      <StatusPill value={role.is_system ? "system" : "custom"} />
      <span>{role.is_default ? "是" : "否"}</span>
      <div className="dropdown">
        <button onClick={() => setMenuOpen((v) => !v)}>操作 <MoreHorizontal size={15} /></button>
        {menuOpen && (
          <div className="dropdown-menu right">
            <button onClick={() => { onEdit(role); setMenuOpen(false); }}><PenLine size={16} />修改</button>
            <button onClick={() => { onEdit({ ...role, is_default: 1 }); setMenuOpen(false); }}><Check size={16} />设为默认</button>
            {!role.is_system && <button className="danger" onClick={() => onDelete(role)}><Trash2 size={16} />删除</button>}
          </div>
        )}
      </div>
    </div>
  );
}

function RoleEditor({ role, onClose, onSaved }: { role: any; onClose: () => void; onSaved: () => void }) {
  const [draft, setDraft] = useState({
    ...role,
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
          <h2>编辑角色权限</h2>
          <button className="icon-button" onClick={onClose} aria-label="关闭"><X size={17} /></button>
        </div>
        <div className="split">
          <label>角色名称<input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} /></label>
          <label>排序<input type="number" value={draft.sort_order} onChange={(e) => setDraft({ ...draft, sort_order: Number(e.target.value) })} /></label>
        </div>
        <label>描述<input value={draft.description || ""} onChange={(e) => setDraft({ ...draft, description: e.target.value })} /></label>
        <div className="permission-tree">
          {permissionTree.map((node) => (
            <div className="permission-node" key={node.key}>
              <label><input type="checkbox" checked={draft.permissions.includes(node.key)} onChange={() => togglePermission(node.key)} /> {node.label}</label>
              <div>{node.children.map((child) => <span key={child}>{child}</span>)}</div>
            </div>
          ))}
        </div>
        <div className="limit-editor">
          <label>最大邮箱数<input type="number" disabled={draft.role_key === "admin"} value={draft.limits.max_mailboxes ?? ""} onChange={(e) => setDraft({ ...draft, limits: { ...draft.limits, max_mailboxes: Number(e.target.value) } })} /></label>
          <label>每日发送<input type="number" disabled={draft.role_key === "admin"} value={draft.limits.max_send_per_day ?? ""} onChange={(e) => setDraft({ ...draft, limits: { ...draft.limits, max_send_per_day: Number(e.target.value) } })} /></label>
          <label>每日接收<input type="number" disabled={draft.role_key === "admin"} value={draft.limits.max_receive_per_day ?? ""} onChange={(e) => setDraft({ ...draft, limits: { ...draft.limits, max_receive_per_day: Number(e.target.value) } })} /></label>
          <label>附件上限(MB)<input type="number" disabled={draft.role_key === "admin"} value={draft.limits.max_attachment_total_mb ?? ""} onChange={(e) => setDraft({ ...draft, limits: { ...draft.limits, max_attachment_total_mb: Number(e.target.value) } })} /></label>
        </div>
        {draft.role_key === "admin" && <div className="alert">管理员身份配额不受限制，但用量仍会统计。</div>}
        <div className="button-row">
          <button onClick={onClose}>取消</button>
          <button className="primary" onClick={save}><Check size={16} />保存</button>
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
    if (!confirm("确定删除自定义落地页背景图？")) return;
    await api("/api/admin/system-settings/background", { method: "DELETE" });
    reload();
  };
  const setOpacity = (value: number) => setDraft((prev) => ({ ...prev, landing_background_opacity: Math.max(0, Math.min(1, Number(value.toFixed(2)))) }));
  if (loading) return <EmptyState title="正在加载系统设置" icon={Settings} />;
  if (error) return <div className="alert">{error}</div>;
  return (
    <div className="panel landing-settings">
      <div className="section-head">
        <h2><Image size={18} />落地页背景图</h2>
        <button className="primary small-button" onClick={save}><Check size={15} />保存</button>
      </div>
      <div className="landing-bg-editor">
        <div className="landing-preview">
          {draft.landing_background_url ? <img src={`${draft.landing_background_url}?v=${Date.now()}`} alt="落地页背景预览" /> : <div className="default-bg-preview">当前默认背景</div>}
          <i style={{ opacity: Number(draft.landing_background_opacity ?? 0.18) }} />
        </div>
        <div className="stack compact-stack">
          <label className="upload-button">
            <Upload size={16} />
            上传背景图
            <input type="file" accept="image/*" onChange={(e) => e.target.files?.[0] && uploadBg(e.target.files[0]).catch(console.error)} />
          </label>
          <label>透明度
            <div className="number-stepper">
              <button onClick={() => setOpacity(Number(draft.landing_background_opacity ?? 0.18) - 0.05)}>-</button>
              <input type="number" min={0} max={1} step={0.05} value={draft.landing_background_opacity ?? 0.18} onChange={(e) => setOpacity(Number(e.target.value))} />
              <button onClick={() => setOpacity(Number(draft.landing_background_opacity ?? 0.18) + 0.05)}>+</button>
            </div>
          </label>
          {draft.landing_background_url && <button className="danger" onClick={removeBg}><Trash2 size={16} />删除已上传照片</button>}
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
  if (loading) return <EmptyState title="正在加载审计日志" icon={RefreshCw} />;
  if (error) return <div className="alert">{error}</div>;
  return (
    <div className="stack">
      <div className="panel toolbar">
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="搜索用户、动作或对象" />
        <input value={action} onChange={(e) => setAction(e.target.value)} placeholder="事件类型" />
      </div>
      <div className="table">
        {data?.map((log) => (
          <div className="table-row audit-row" key={log.id}>
            <strong>{log.action}</strong>
            <span>{log.actor_username || "system"}</span>
            <span>{log.target_type}:{log.target_id}</span>
            <span>{new Date(log.created_at).toLocaleString()}</span>
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
