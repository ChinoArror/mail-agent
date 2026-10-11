import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  ChartLine,
  ExternalLink,
  FilePen,
  Gauge,
  Inbox,
  LogOut,
  Mail,
  Mailbox,
  Mails,
  Menu as MenuIcon,
  Moon,
  Paperclip,
  RefreshCw,
  ScrollText,
  ShieldAlert,
  Search,
  Send,
  ShieldCheck,
  ShieldX,
  SlidersHorizontal,
  SquarePen,
  Star,
  Sun,
  UserRoundCog,
  UsersRound,
  X
} from "lucide-react";
import { EmptyState, Menu } from "./components";
import { ApiError, api, formatBytes, resolveDark, routeFromHash, setRoute, startPrefsSync, stopPrefsSync, tokenSecondsLeft, useThemeMode, type User } from "./lib";
import { useFeedback, useScrollLock } from "./ui/feedback";
import { AttachmentsPage, Compose, DraftHistory, Drafts, EmailDetail, EmailList, Mailboxes } from "./pages/mail";
import { AdminAnalysis, AdminAudit, AdminMailboxes, AdminRoles, AdminSystemSettings, AdminUsers, SettingsPage, Usage } from "./pages/admin";

type NavEntry = { key: string; label: string; description: string; icon: React.ElementType; allowed: (can: (k: string) => boolean) => boolean };

const NAV: NavEntry[] = [
  { key: "mailboxes", label: "Mailboxes", description: "Addresses and their messages", icon: Mailbox, allowed: (can) => can("mailboxes") },
  { key: "inbox", label: "Inbox", description: "Received mail", icon: Inbox, allowed: (can) => can("emails") },
  { key: "sent", label: "Sent", description: "Delivered and queued mail", icon: Send, allowed: (can) => can("emails") },
  { key: "starred", label: "Starred", description: "Messages you flagged", icon: Star, allowed: (can) => can("emails") },
  { key: "compose", label: "Compose", description: "Write a new message", icon: SquarePen, allowed: (can) => can("drafts") },
  { key: "drafts", label: "Drafts", description: "Unsent messages", icon: FilePen, allowed: (can) => can("drafts") },
  { key: "attachments", label: "Attachments", description: "Files across all mail", icon: Paperclip, allowed: (can) => can("attachments") },
  { key: "usage", label: "Usage", description: "Quotas and trends", icon: Gauge, allowed: (can) => can("usage") },
  { key: "settings", label: "Personal settings", description: "Profile and preferences", icon: UserRoundCog, allowed: (can) => can("settings") }
];

const ADMIN_NAV: NavEntry[] = [
  { key: "admin-analysis", label: "Analytics", description: "Usage across all users", icon: ChartLine, allowed: (can) => can("analysis") },
  { key: "admin-users", label: "Users", description: "Accounts, roles and quotas", icon: UsersRound, allowed: (can) => can("users") },
  { key: "admin-mailboxes", label: "All mailboxes", description: "Every address on the domain", icon: Mails, allowed: (can) => can("emails") || can("mailboxes") },
  { key: "admin-roles", label: "Access control", description: "Roles and permissions", icon: ShieldCheck, allowed: (can) => can("roles") },
  { key: "admin-system", label: "System settings", description: "Landing page appearance", icon: SlidersHorizontal, allowed: (can) => can("system") },
  { key: "admin-audit", label: "System logs", description: "Audit trail", icon: ScrollText, allowed: (can) => can("audit") }
];

function routeMeta(route: string): { label: string; description: string; icon: React.ElementType } {
  if (route.startsWith("email:")) return { label: "Message", description: "Message details", icon: Mail };
  if (route.startsWith("compose:") && route.endsWith(":history")) return { label: "Draft history", description: "Previous versions", icon: FilePen };
  if (route.startsWith("compose:")) return { label: "Compose", description: "Autosaves every 2 seconds", icon: SquarePen };
  const entry = [...NAV, ...ADMIN_NAV].find((n) => n.key === route);
  return entry ? { label: entry.label, description: entry.description, icon: entry.icon } : { label: "Mail Agent", description: "", icon: Mail };
}

function activeKey(route: string) {
  if (route.startsWith("email:")) return route.endsWith(":attachments") ? "attachments" : "inbox";
  if (route.startsWith("compose:")) return "drafts";
  return route;
}

export function Shell({ user, onLogout }: { user: User; onLogout: () => void }) {
  const [route, setLocalRoute] = useState(routeFromHash());
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [mode, setMode] = useThemeMode();
  const session = useSessionGuard();
  // Each account carries its own appearance settings across devices.
  useEffect(() => {
    void startPrefsSync(user.id);
    return () => stopPrefsSync();
  }, [user.id]);
  // Freeze the page behind the mobile drawer (and close it with Escape / when growing to desktop width).
  useScrollLock(sidebarOpen);
  useEffect(() => {
    if (!sidebarOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setSidebarOpen(false); };
    const mq = window.matchMedia("(min-width: 961px)");
    const onWide = () => { if (mq.matches) setSidebarOpen(false); };
    document.addEventListener("keydown", onKey);
    mq.addEventListener("change", onWide);
    return () => {
      document.removeEventListener("keydown", onKey);
      mq.removeEventListener("change", onWide);
    };
  }, [sidebarOpen]);
  useEffect(() => {
    const fn = () => setLocalRoute(routeFromHash());
    window.addEventListener("hashchange", fn);
    return () => window.removeEventListener("hashchange", fn);
  }, []);
  useEffect(() => {
    setSidebarOpen(false);
    window.scrollTo({ top: 0 });
  }, [route]);
  const can = (key: string) => user.role === "admin" || (user.permissions || []).includes(key);
  const visibleNav = NAV.filter((n) => n.allowed(can));
  const visibleAdmin = user.role === "admin" ? ADMIN_NAV.filter((n) => n.allowed(can)) : [];
  const meta = routeMeta(route);
  const active = activeKey(route);
  const dark = resolveDark(mode);

  return (
    <div className="app">
      {sidebarOpen && <button className="sidebar-scrim" aria-label="Close navigation" onClick={() => setSidebarOpen(false)} />}
      <aside className={`sidebar ${sidebarOpen ? "open" : ""}`} aria-label="Main navigation">
        <button className="brand" onClick={() => setRoute("mailboxes")}>
          <img src="/logo.svg" alt="" width={38} height={38} style={{ borderRadius: 11 }} />
          <span className="brand-text"><strong>Mail Agent</strong><small>Temp mail · AI assist</small></span>
        </button>
        <button className="icon-button sidebar-close" aria-label="Close navigation" onClick={() => setSidebarOpen(false)}><X size={18} /></button>
        <NavList groups={[{ items: visibleNav }, ...(visibleAdmin.length ? [{ label: "Admin", items: visibleAdmin }] : [])]} active={active} />
        <div className="sidebar-footer">© {new Date().getFullYear()} Mail Agent</div>
      </aside>
      <div className="main">
        <header className={`topbar ${searchOpen ? "searching" : ""}`}>
          <button className="icon-button menu-button" aria-label="Open navigation" aria-expanded={sidebarOpen} onClick={() => setSidebarOpen(true)}><MenuIcon size={19} /></button>
          <div className="page-title">
            <meta.icon size={18} />
            <strong>{meta.label}</strong>
            {meta.description && <small>{meta.description}</small>}
          </div>
          <GlobalSearch mobileOpen={searchOpen} onMobileClose={() => setSearchOpen(false)} />
          <div className="top-actions">
            <button className="icon-button search-trigger" aria-label="Search" onClick={() => setSearchOpen(true)}><Search size={18} /></button>
            {can("drafts") && <button className="primary small-button compose-button" onClick={() => setRoute("compose")} title="Compose" aria-label="Compose"><SquarePen size={15} /><span className="hide-md">Compose</span></button>}
            <button className="icon-button hide-sm" aria-label={dark ? "Switch to light theme" : "Switch to dark theme"} title="Toggle theme" onClick={(e) => setMode(dark ? "light" : "dark", { x: e.clientX, y: e.clientY })}>
              {dark ? <Sun size={18} /> : <Moon size={18} />}
            </button>
            <span className="divider" />
            <Menu
              label="Account"
              trigger={({ toggle, open }) => (
                <button className="user-chip" aria-expanded={open} aria-haspopup="menu" onClick={toggle}>
                  <span className="avatar">{user.avatar_url ? <img src={user.avatar_url} alt="" /> : user.username.slice(0, 1).toUpperCase()}</span>
                  <strong>{user.display_name || user.username}</strong>
                </button>
              )}
            >
              {(close) => (
                <>
                  <div className="menu-caption">{user.username}</div>
                  <button role="menuitem" onClick={() => { setRoute("settings"); close(); }}><UserRoundCog size={15} />Personal settings</button>
                  <button role="menuitem" className="show-sm" onClick={(e) => { setMode(dark ? "light" : "dark", { x: e.clientX, y: e.clientY }); close(); }}>{dark ? <Sun size={15} /> : <Moon size={15} />}{dark ? "Light theme" : "Dark theme"}</button>
                  <button role="menuitem" onClick={() => { window.open(`https://accounts.aryuki.com/${user.id}`, "_blank", "noopener"); close(); }}><ExternalLink size={15} />Auth Center account</button>
                  <hr />
                  <button role="menuitem" className="danger" onClick={() => { close(); onLogout(); }}><LogOut size={15} />Sign out</button>
                </>
              )}
            </Menu>
          </div>
        </header>
        {session.status !== "ok" && (
          <div className="session-banner" role="alert">
            <span className="glyph"><ShieldAlert size={16} /></span>
            <div>
              <strong>Verification failed</strong>
              <small>{session.reason}</small>
            </div>
            <button className="small-button" onClick={() => void session.retry()} disabled={session.status === "checking"}>
              <RefreshCw size={15} className={session.status === "checking" ? "spin" : ""} />
              {session.status === "checking" ? "Verifying…" : "Refresh"}
            </button>
          </div>
        )}
        <section className="content">
          <div className="route-view" key={route}>
            <RouteView route={route} user={user} />
          </div>
        </section>
      </div>
    </div>
  );
}

/** Sidebar nav with a single active pill that slides between rows (D6). */
function NavList({ groups, active }: { groups: Array<{ label?: string; items: NavEntry[] }>; active: string }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [pill, setPill] = useState<{ top: number; height: number; visible: boolean }>({ top: 0, height: 40, visible: false });
  const first = useRef(true);
  useLayoutEffect(() => {
    const container = containerRef.current;
    const el = container?.querySelector<HTMLElement>(`[data-nav="${active}"]`);
    if (!container || !el) {
      setPill((p) => ({ ...p, visible: false }));
      return;
    }
    setPill({ top: el.offsetTop, height: el.offsetHeight, visible: true });
  }, [active, groups.map((g) => g.items.length).join()]);
  useEffect(() => { first.current = false; }, []);
  return (
    <div className="nav-group" ref={containerRef} style={{ position: "relative" }}>
      <span
        className="nav-pill"
        aria-hidden="true"
        style={{ transform: `translateY(${pill.top}px)`, height: pill.height, opacity: pill.visible ? 1 : 0, transition: first.current ? "none" : undefined, top: 0 }}
      />
      {groups.map((group, gi) => (
        <React.Fragment key={gi}>
          {group.label && <div className="nav-label">{group.label}</div>}
          {group.items.map((item) => (
            <button key={item.key} data-nav={item.key} className={`nav-item ${active === item.key ? "active" : ""}`} aria-current={active === item.key ? "page" : undefined} onClick={() => setRoute(item.key)}>
              <span className="nav-icon"><item.icon size={18} /></span>
              {item.label}
            </button>
          ))}
        </React.Fragment>
      ))}
    </div>
  );
}

function GlobalSearch({ mobileOpen, onMobileClose }: { mobileOpen: boolean; onMobileClose: () => void }) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<any | null>(null);
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
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
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = /^(INPUT|TEXTAREA|SELECT)$/.test((e.target as HTMLElement)?.tagName) || (e.target as HTMLElement)?.isContentEditable;
      if (e.key === "/" && !typing) {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
        onMobileClose();
      }
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onDown);
    };
  }, []);
  useEffect(() => { if (mobileOpen) window.setTimeout(() => inputRef.current?.focus(), 30); }, [mobileOpen]);
  const go = (route: string) => {
    setRoute(route);
    setQ("");
    setOpen(false);
    onMobileClose();
  };
  const count = results ? Object.values(results).reduce((sum: number, rows: any) => sum + (Array.isArray(rows) ? rows.length : 0), 0) : 0;
  return (
    <div className={`global-search ${mobileOpen ? "open" : ""}`} ref={wrapRef}>
      <Search size={15} />
      <input
        ref={inputRef}
        value={q}
        onFocus={() => setOpen(true)}
        onChange={(e) => { setQ(e.target.value); setOpen(true); }}
        onKeyDown={(e) => { if (e.key === "Escape") { setQ(""); inputRef.current?.blur(); onMobileClose(); } }}
        placeholder="Search mail, mailboxes, files…"
        aria-label="Global search"
      />
      {!q && <kbd>/</kbd>}
      {(q || mobileOpen) && <button className="icon-button sm search-clear" aria-label={q ? "Clear search" : "Close search"} onClick={() => { if (q) setQ(""); else onMobileClose(); }}><X size={14} /></button>}
      {open && results && (
        <div className="search-popover">
          {!count && <span className="muted">No results for “{q}”</span>}
          {!!results.mailboxes?.length && <SearchGroup title="Mailboxes" rows={results.mailboxes} render={(row: any) => <button onClick={() => go("mailboxes")}>{row.email}<small>{row.alias || row.status}</small></button>} />}
          {!!results.emails?.length && <SearchGroup title="Mail" rows={results.emails} render={(row: any) => <button onClick={() => go(`email:${row.id}`)}>{row.subject || "(no subject)"}<small>{row.from_addr || row.to_addr}</small></button>} />}
          {!!results.attachments?.length && <SearchGroup title="Attachments" rows={results.attachments} render={(row: any) => <button onClick={() => go("attachments")}>{row.filename}<small>{formatBytes(row.size_bytes)}</small></button>} />}
          {!!results.users?.length && <SearchGroup title="Users" rows={results.users} render={(row: any) => <button onClick={() => go("admin-users")}>{row.username}<small>{row.status}</small></button>} />}
        </div>
      )}
    </div>
  );
}

/* ---------- Session guard --------------------------------------------------- *
 * A tab left open for a long time can outlive its JWT (max 1 hour). Instead of failing silently,
 * show a "Verification failed" banner. Refresh → re-verify with /api/me; if that still fails the
 * page reloads, which runs the normal restore → Auth Center silent-renewal flow.
 */
const IDLE_RECHECK_MS = 5 * 60 * 1000;

function useSessionGuard() {
  const [status, setStatus] = useState<"ok" | "failed" | "checking">("ok");
  const [reason, setReason] = useState("");
  const feedback = useFeedback();
  const hiddenAt = useRef<number | null>(null);
  const lastCheck = useRef(Date.now());
  const statusRef = useRef(status);
  statusRef.current = status;

  const fail = (why: string) => {
    if (statusRef.current === "checking") return;
    setReason(why);
    setStatus("failed");
  };

  /** Quiet verification; only a definitive 401/403 counts as failure (offline ≠ signed out). */
  const verify = async (): Promise<"ok" | "denied" | "offline"> => {
    lastCheck.current = Date.now();
    try {
      await api("/api/me");
      return "ok";
    } catch (err) {
      if (err instanceof ApiError && (err.status === 401 || err.status === 403)) return "denied";
      return "offline";
    }
  };

  useEffect(() => {
    const expiredLocally = () => {
      const left = tokenSecondsLeft();
      return left !== null && left <= 0;
    };
    const check = async (why: string) => {
      if (statusRef.current !== "ok") return;
      if (expiredLocally()) return fail(why);
      if ((await verify()) === "denied") fail(why);
    };
    const onVisible = () => {
      if (document.visibilityState === "hidden") {
        hiddenAt.current = Date.now();
        return;
      }
      const away = hiddenAt.current ? Date.now() - hiddenAt.current : 0;
      hiddenAt.current = null;
      if (away >= IDLE_RECHECK_MS || Date.now() - lastCheck.current >= IDLE_RECHECK_MS || expiredLocally()) {
        void check("The page was idle for a while and your sign-in could not be confirmed.");
      }
    };
    const onFocus = () => { if (Date.now() - lastCheck.current >= IDLE_RECHECK_MS) void check("The page was idle for a while and your sign-in could not be confirmed."); };
    const onAuthFailed = () => fail("The server rejected your sign-in. It may have expired or been revoked.");
    // Catch tabs that stay visible but untouched past the JWT expiry (e.g. laptop asleep on this page).
    const timer = window.setInterval(() => { if (statusRef.current === "ok" && expiredLocally()) fail("Your sign-in expired while the page was open."); }, 30_000);
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onFocus);
    window.addEventListener("pageshow", onVisible);
    window.addEventListener("auth-failed", onAuthFailed);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("pageshow", onVisible);
      window.removeEventListener("auth-failed", onAuthFailed);
    };
  }, []);

  const retry = async () => {
    setStatus("checking");
    const result = await verify();
    if (result === "ok") {
      setStatus("ok");
      feedback.success("Session verified", "You're still signed in.");
      return;
    }
    if (result === "offline") {
      setReason("Can't reach the server right now. Check your connection and try again.");
      setStatus("failed");
      return;
    }
    // Still rejected → full reload; startup restores the session or renews it via Auth Center.
    window.location.reload();
  };

  return { status, reason, retry };
}

function SearchGroup({ title, rows, render }: { title: string; rows: any[]; render: (row: any) => React.ReactNode }) {
  return <section><strong>{title}</strong>{rows.map((row) => <React.Fragment key={row.id}>{render(row)}</React.Fragment>)}</section>;
}

function Denied({ what }: { what: string }) {
  return <div className="panel"><EmptyState icon={ShieldX} title={`Your role cannot ${what}`} hint="Ask an administrator to grant access in Access control." /></div>;
}

function RouteView({ route, user }: { route: string; user: User }) {
  const can = (key: string) => user.role === "admin" || (user.permissions || []).includes(key);
  if (route.startsWith("email:")) {
    const [, id, from] = route.split(":");
    return <EmailDetail id={id} returnRoute={from === "attachments" ? "attachments" : undefined} />;
  }
  if (route.startsWith("compose:") && route.endsWith(":history")) return <DraftHistory draftId={route.slice(8, -8)} />;
  if (route.startsWith("compose:")) return can("drafts") ? <Compose draftId={route.slice(8)} /> : <Denied what="use Compose" />;
  switch (route) {
    case "inbox": return can("emails") ? <EmailList direction="inbound" /> : <Denied what="view mail" />;
    case "sent": return can("emails") ? <EmailList direction="outbound" /> : <Denied what="view Sent" />;
    case "starred": return can("emails") ? <EmailList starredOnly /> : <Denied what="view starred mail" />;
    case "compose": return can("drafts") ? <Compose /> : <Denied what="compose mail" />;
    case "drafts": return can("drafts") ? <Drafts /> : <Denied what="view drafts" />;
    case "attachments": return can("attachments") ? <AttachmentsPage user={user} /> : <Denied what="view attachments" />;
    case "usage": return can("usage") ? <Usage /> : <Denied what="view usage" />;
    case "settings": return <SettingsPage user={user} />;
    case "admin-users": return can("users") ? <AdminUsers /> : <Denied what="manage users" />;
    case "admin-mailboxes": return can("emails") || can("mailboxes") ? <AdminMailboxes /> : <Denied what="manage mailboxes" />;
    case "admin-analysis": return can("analysis") ? <AdminAnalysis /> : <Denied what="view analytics" />;
    case "admin-roles": return can("roles") ? <AdminRoles /> : <Denied what="manage roles" />;
    case "admin-system": return can("system") ? <AdminSystemSettings /> : <Denied what="manage system settings" />;
    case "admin-audit": return can("audit") ? <AdminAudit /> : <Denied what="view audit logs" />;
    default: return can("mailboxes") ? <Mailboxes /> : <Denied what="view mailboxes" />;
  }
}
