import React, { useEffect, useRef, useState } from "react";
import {
  Ban,
  ChartColumn,
  ChartLine,
  Check,
  ChevronRight,
  CircleCheck,
  Crop,
  Download,
  Ellipsis,
  ExternalLink,
  FileDown,
  HardDrive,
  ImageUp,
  Inbox,
  KeyRound,
  Mailbox as MailboxIcon,
  Mails,
  Monitor,
  Palette,
  Pencil,
  Plus,
  RefreshCw,
  RotateCcw,
  Save,
  ScrollText,
  Send,
  ShieldCheck,
  Sparkles,
  Star,
  Trash,
  Undo2,
  UserCog,
  UsersRound,
  WandSparkles as Wand,
  Wallpaper,
  Waves,
  Loader,
  ListChecks
} from "lucide-react";
import { EmptyState, ErrorPanel, Loadable, Menu, QuotaBar, ScaledPreview, Segmented, StatusPill, Switch } from "../components";
import { BootScreen, LoginView } from "../auth";
import { CropEditor, type CropParams, type CropSource } from "../ui/cropper";
import { Modal, errorMessage, useConfirm, useFeedback } from "../ui/feedback";
import { ElasticSlider } from "../ui/slider";
import { Sk, SkeletonChart, SkeletonMetrics, SkeletonTable } from "../ui/skeleton";
import { api, fetchBlob, formatBytes, formatDate, formatRelative, roleDescription, roleName, saveBlob, setRoute, uploadForm, useAsync, useThemeMode, usePrefs, usePrefsSync, resolveDark, motionLevel, ACCENTS, DEFAULT_LANDING, DEFAULT_LOADING, type AccentName, type LandingSettings, type LoadingSettings, type Mailbox, type User } from "../lib";

/* ==========================================================================
   Usage
   ========================================================================== */

function Metric({ icon: Icon, label, value, sub, hero, percent }: { icon: React.ElementType; label: string; value: React.ReactNode; sub?: React.ReactNode; hero?: boolean; percent?: number }) {
  return (
    <div className={`panel metric ${hero ? "hero" : ""}`}>
      <span className="well"><Icon size={19} /></span>
      <div style={{ flex: 1 }}>
        <span>{label}</span>
        <strong>{value}</strong>
        {sub && <small>{sub}</small>}
        {percent !== undefined && <div className="meter"><b style={{ width: `${Math.min(100, percent)}%`, background: percent >= 90 ? "var(--destructive)" : percent >= 70 ? "var(--warning)" : undefined }} /></div>}
      </div>
    </div>
  );
}

const pct = (used: number, limit: number) => (limit > 0 ? (used / limit) * 100 : 0);

export function Usage() {
  const usage = useAsync<{ limits: Record<string, number>; usage: Record<string, any> }>(() => api("/api/usage"), []);
  const [days, setDays] = useState(7);
  const trends = useAsync<{ counters: any[]; mailboxes: any[] }>(() => api(`/api/usage/trends?days=${days}`), [days]);
  return (
    <div className="stack">
      <Loadable state={usage} skeleton={<><SkeletonMetrics count={4} /></>} label="Loading usage">
        {({ usage: u, limits: l }) => (
          <div className="stack">
            <div className="usage-explainer panel">
              <div>
                <h2>Usage and limits</h2>
                <p>Auth Center controls token quotas. This app enforces mailbox, mail and attachment limits by role. Daily counters reset at 00:00 UTC.</p>
              </div>
              <div className="token-card"><span>AI tokens</span><strong>{u.tokens?.count ?? 0}</strong><small>Quota managed by Auth Center</small></div>
            </div>
            <div className="metric-grid">
              <Metric hero icon={MailboxIcon} label="Mailboxes" value={`${u.mailboxes} / ${l.max_mailboxes}`} percent={pct(u.mailboxes, l.max_mailboxes)} />
              <Metric icon={Send} label="Sent today" value={`${u.send?.count ?? 0} / ${l.max_send_per_day}`} percent={pct(u.send?.count ?? 0, l.max_send_per_day)} />
              <Metric icon={Inbox} label="Received today" value={`${u.receive?.count ?? 0} / ${l.max_receive_per_day}`} percent={pct(u.receive?.count ?? 0, l.max_receive_per_day)} />
              <Metric icon={HardDrive} label="Attachment storage" value={formatBytes(u.attachment_bytes)} sub={`of ${formatBytes(l.max_attachment_total_bytes)}`} percent={pct(u.attachment_bytes, l.max_attachment_total_bytes)} />
            </div>
          </div>
        )}
      </Loadable>
      <div className="section-head">
        <h2>Usage trends</h2>
        <Segmented ariaLabel="Trend range" value={days} onChange={setDays} options={[7, 30, 90].map((d) => ({ value: d, label: `${d} days` }))} />
      </div>
      <Loadable state={trends} skeleton={<SkeletonChart rows={3} title={false} />} label="Loading trends">
        {(data) => <TrendChart rows={data.counters || []} />}
      </Loadable>
    </div>
  );
}

function TrendChart({ rows }: { rows: Array<{ day: string; type: string; count: number; bytes: number }> }) {
  const days = Array.from(new Set(rows.map((r) => r.day))).sort();
  const types = [
    { key: "send", label: "Sent" },
    { key: "receive", label: "Received" },
    { key: "attachment", label: "Attachment size" }
  ];
  return (
    <div className="panel trend-chart">
      {!rows.length ? <EmptyState icon={ChartColumn} title="No activity in this period" /> : types.map((type) => {
        const values = days.map((day) => {
          const item = rows.find((r) => r.day === day && r.type === type.key);
          return item ? (type.key === "attachment" ? item.bytes : item.count) : 0;
        });
        const max = Math.max(1, ...values);
        return (
          <div className="trend-row" key={type.key}>
            <strong>{type.label}</strong>
            <div className="trend-bars">
              {values.map((value, i) => <span key={days[i]} style={{ height: `${Math.max(4, (value / max) * 100)}%` }} title={`${days[i]}: ${type.key === "attachment" ? formatBytes(value) : value}`} />)}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ==========================================================================
   Personal settings
   ========================================================================== */

export function SettingsPage({ user }: { user: User }) {
  const authUrl = `https://accounts.aryuki.com/${user.id}`;
  const [displayName, setDisplayName] = useState(user.display_name || user.name || "");
  const [avatarUrl, setAvatarUrl] = useState(user.avatar_url || "");
  const [mode, setMode] = useThemeMode();
  const [prefs, updatePrefs, resetPrefs] = usePrefs();
  const sync = usePrefsSync();
  const [draftRetentionDays, setDraftRetentionDays] = useState(user.draft_retention_days || 7);
  const [saving, setSaving] = useState(false);
  const feedback = useFeedback();
  const { confirm } = useConfirm();
  const save = async () => {
    setSaving(true);
    await feedback.run({ title: "Saving settings", success: "Settings saved" }, () =>
      api("/api/me/settings", { method: "PATCH", body: JSON.stringify({ display_name: displayName, avatar_url: avatarUrl, language: "en", theme: mode, draft_retention_days: draftRetentionDays }) })
    );
    setSaving(false);
  };
  const resetAppearance = async () => {
    const ok = await confirm({ title: "Reset appearance?", description: "Theme color, display and animation settings for your account go back to the defaults (Sky, comfortable, system motion) on every device.", confirmLabel: "Reset", icon: RotateCcw });
    if (!ok) return;
    resetPrefs();
    setMode("system");
    feedback.success("Appearance reset");
  };
  const presets = Object.entries(ACCENTS) as Array<[Exclude<AccentName, "custom">, (typeof ACCENTS)[keyof typeof ACCENTS]]>;
  const dark = resolveDark(mode);
  return (
    <div className="panel settings-page">
      <div className="section-head">
        <div>
          <h2>Personal settings</h2>
          <p>Signed in as {user.username} · {roleName(user)}</p>
        </div>
        <span className="avatar" style={{ width: 44, height: 44, fontSize: 16 }}>{avatarUrl ? <img src={avatarUrl} alt="" /> : user.username.slice(0, 1).toUpperCase()}</span>
      </div>

      <section className="settings-section">
        <header><div><h3><UserCog size={16} />Profile</h3><p>Saved to your account.</p></div></header>
        <div className="settings-form-grid">
          <label>Display name<input value={displayName} onChange={(e) => setDisplayName(e.target.value)} /></label>
          <label>Avatar URL<input value={avatarUrl} onChange={(e) => setAvatarUrl(e.target.value)} placeholder="https://…" /></label>
          <label>Auto-delete drafts after
            <select value={draftRetentionDays} onChange={(e) => setDraftRetentionDays(Number(e.target.value))}>
              <option value={1}>1 day</option><option value={3}>3 days</option><option value={7}>1 week</option><option value={30}>1 month</option>
            </select>
          </label>
        </div>
        <div className="settings-actions">
          <button className="primary small-button" onClick={() => void save()} disabled={saving}><Save size={15} />{saving ? "Saving…" : "Save profile"}</button>
          <a className="outline-link" href={`${authUrl}/change-password`} target="_blank" rel="noreferrer"><KeyRound size={15} />Change password</a>
          <a className="outline-link" href={authUrl} target="_blank" rel="noreferrer"><ExternalLink size={15} />Auth Center account</a>
        </div>
      </section>

      <section className="settings-section">
        <header>
          <div><h3><Palette size={16} />Theme color</h3><p>Accent used for buttons, highlights and charts. Applies instantly and follows your account to other devices.</p></div>
          <div className="button-row">
            <button className="primary small-button" tabIndex={-1} aria-hidden="true" style={{ pointerEvents: "none" }}><Sparkles size={14} />Preview</button>
            <StatusPill value="role" label="Accent" />
          </div>
        </header>
        <div className="swatches" role="radiogroup" aria-label="Theme color">
          {presets.map(([key, a]) => (
            <button
              key={key}
              role="radio"
              aria-checked={prefs.accent === key}
              aria-label={a.label}
              title={a.label}
              className={`swatch ${prefs.accent === key ? "on" : ""}`}
              style={{ ["--swatch" as string]: `oklch(${dark ? a.dark[0] : a.light[0]}% ${dark ? a.dark[1] : a.light[1]} ${a.hue})` }}
              onClick={() => updatePrefs({ accent: key })}
            />
          ))}
          <button role="radio" aria-checked={prefs.accent === "custom"} aria-label="Custom color" title="Custom" className={`swatch custom ${prefs.accent === "custom" ? "on" : ""}`} onClick={() => updatePrefs({ accent: "custom" })} />
        </div>
        {prefs.accent === "custom" && (
          <div className="hue-row">
            <ElasticSlider label="Hue" value={prefs.hue} min={0} max={360} step={1} onChange={(hue) => updatePrefs({ hue })} format={(v) => `${Math.round(v)}°`} ticks={7} />
            <span className="hue-dot" aria-hidden="true" />
          </div>
        )}
      </section>

      <section className="settings-section">
        <header><div><h3><Monitor size={16} />Display mode</h3><p>Light / dark appearance, density and contrast.</p></div></header>
        <div>
          <div className="setting-row">
            <div><strong>Theme</strong><small>System follows your device setting.</small></div>
            <Segmented ariaLabel="Theme" value={mode} onChange={(m) => setMode(m)} options={[{ value: "system", label: "System" }, { value: "light", label: "Light" }, { value: "dark", label: "Dark" }]} />
          </div>
          <div className="setting-row">
            <div><strong>Dark style</strong><small>Pure black saves power on OLED screens.</small></div>
            <Segmented ariaLabel="Dark style" value={prefs.darkStyle} onChange={(darkStyle) => updatePrefs({ darkStyle })} options={[{ value: "night", label: "Night" }, { value: "black", label: "Pure black" }]} />
          </div>
          <div className="setting-row">
            <div><strong>Density</strong><small>Compact fits more rows on screen.</small></div>
            <Segmented ariaLabel="Density" value={prefs.density} onChange={(density) => updatePrefs({ density })} options={[{ value: "comfortable", label: "Comfortable" }, { value: "compact", label: "Compact" }]} />
          </div>
          <div className="setting-row">
            <div><strong>High contrast</strong><small>Stronger borders and secondary text.</small></div>
            <Switch label="High contrast" checked={prefs.contrast === "high"} onChange={(on) => updatePrefs({ contrast: on ? "high" : "normal" })} />
          </div>
        </div>
      </section>

      <section className="settings-section">
        <header><div><h3><Wand size={16} />Animations</h3><p>Loading spinners keep turning even when animations are off.</p></div></header>
        <div>
          <div className="setting-row">
            <div><strong>Motion</strong><small>{prefs.motion === "system" ? `Following your device (${motionLevel(prefs)}).` : prefs.motion === "full" ? "All transitions and effects." : prefs.motion === "reduced" ? "Instant transitions, no shimmer." : "No animation at all."}</small></div>
            <Segmented ariaLabel="Motion" value={prefs.motion} onChange={(motion) => updatePrefs({ motion })} options={[{ value: "system", label: "System" }, { value: "full", label: "Full" }, { value: "reduced", label: "Reduced" }, { value: "off", label: "Off" }]} />
          </div>
          <div className="setting-row">
            <div><strong>Animated sign-in background</strong><small>Moving wave lines on the sign-in and loading pages.</small></div>
            <Switch label="Animated sign-in background" checked={prefs.loginWaves} onChange={(loginWaves) => updatePrefs({ loginWaves })} />
          </div>
          <div className="setting-row">
            <div><strong>Theme switch reveal</strong><small>Circular transition when changing light / dark.</small></div>
            <Switch label="Theme switch reveal" checked={prefs.themeReveal} onChange={(themeReveal) => updatePrefs({ themeReveal })} />
          </div>
        </div>
        <div className="settings-actions">
          <button className="small-button" onClick={() => void resetAppearance()}><RotateCcw size={15} />Reset appearance</button>
          <span className={`sync-state ${sync.state}`} role="status">
            <i />
            {sync.state === "saving" ? "Saving to your account…" : sync.state === "offline" ? "Couldn't sync — saved on this device" : sync.savedAt ? `Synced to your account · ${formatRelative(sync.savedAt)}` : "Synced to your account"}
            {sync.state === "offline" && <button className="small-button ghost" onClick={sync.retry}><RefreshCw size={14} />Retry</button>}
          </span>
        </div>
      </section>
    </div>
  );
}

/* ==========================================================================
   Admin · Users
   ========================================================================== */

export function AdminUsers() {
  const [query, setQuery] = useState("");
  const [status, setStatusFilter] = useState("");
  const users = useAsync<any[]>(() => api(`/api/admin/users?q=${encodeURIComponent(query)}&status=${status}`), [query, status]);
  const roles = useAsync<any[]>(() => api("/api/admin/roles"), []);
  const { confirm } = useConfirm();
  const feedback = useFeedback();
  const setUserStatus = async (user: any) => {
    const next = user.status === "active" ? "frozen" : "active";
    const disabling = next === "frozen";
    const ok = await confirm({
      tone: disabling ? "danger" : "default",
      title: disabling ? `Disable ${user.username}?` : `Enable ${user.username}?`,
      description: disabling ? "They will be signed out of Mail Agent and cannot send or receive until re-enabled." : "They regain access with their current role and quotas.",
      target: user.username,
      confirmLabel: disabling ? "Disable user" : "Enable user",
      busyLabel: "Updating…",
      icon: disabling ? Ban : CircleCheck,
      onConfirm: () => api(`/api/admin/users/${user.id}/status`, { method: "PATCH", body: JSON.stringify({ status: next }) })
    });
    if (!ok) return;
    feedback.success(disabling ? "User disabled" : "User enabled", user.username);
    void users.reload();
  };
  const setUserRole = async (user: any, roleId: string) => {
    await api(`/api/admin/users/${user.id}/app-role`, { method: "PATCH", body: JSON.stringify({ role_id: roleId || null }) });
    feedback.success("Role updated", user.username);
    void users.reload();
  };
  const resetCounters = async (user: any) => {
    const ok = await confirm({
      title: `Reset today's quota for ${user.username}?`,
      description: "Today's sent and received counters return to zero. Historical analytics are kept.",
      confirmLabel: "Reset counters",
      busyLabel: "Resetting…",
      icon: RotateCcw,
      onConfirm: () => api(`/api/admin/users/${user.id}/reset-counters`, { method: "POST", body: JSON.stringify({ types: ["send", "receive"] }) })
    });
    if (!ok) return;
    feedback.success("Daily quota reset", user.username);
    void users.reload();
  };
  const exportCsv = () => {
    const rows = users.data || [];
    const header = ["username", "received", "sent", "mailboxes", "created_at", "status", "role", "attachment_mb"].join(",");
    const csv = [header, ...rows.map((u) => [u.username, u.received_count || 0, u.sent_count || 0, u.mailbox_count || 0, u.created_at, u.status, roleName(u), ((u.attachment_bytes || 0) / 1024 / 1024).toFixed(2)].join(","))].join("\n");
    saveBlob(new Blob([csv], { type: "text/csv;charset=utf-8" }), "mail-agent-users.csv");
    feedback.success("Export ready", `${rows.length} users · mail-agent-users.csv`);
  };
  return (
    <div className="stack">
      <div className="panel toolbar">
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search users" aria-label="Search users" />
        <select value={status} onChange={(e) => setStatusFilter(e.target.value)} aria-label="Status"><option value="">All statuses</option><option value="active">Active</option><option value="frozen">Disabled</option></select>
        <button onClick={() => void users.reload()} disabled={users.loading}><RefreshCw size={15} className={users.loading && users.data ? "spin" : ""} />Refresh</button>
        <button onClick={exportCsv} disabled={!users.data?.length}><FileDown size={15} />Export CSV</button>
      </div>
      <Loadable state={users} skeleton={<SkeletonTable rows={6} cols={6} />} label="Loading users">
        {(data) => !data.length ? <div className="panel"><EmptyState icon={UsersRound} title="No users match" /></div> : (
          <div className="panel table-scroll" style={{ padding: 0 }}>
            <div className="cloud-table admin-table">
              <div className="cloud-table-head admin-user-row">
                <span /><strong>User</strong><span>Recv</span><span>Sent</span><span>Boxes</span><span>Joined</span><span>Status</span><span>Role</span><span>Storage</span><span />
              </div>
              {data.map((u) => <AdminUserRow key={u.id} user={u} roles={roles.data || []} onRole={setUserRole} onStatus={setUserStatus} onReset={resetCounters} />)}
            </div>
          </div>
        )}
      </Loadable>
    </div>
  );
}

function AdminUserRow({ user, roles, onRole, onStatus, onReset }: { user: any; roles: any[]; onRole: (u: any, roleId: string) => Promise<void>; onStatus: (u: any) => void; onReset: (u: any) => void }) {
  const [expanded, setExpanded] = useState(false);
  const [roleOpen, setRoleOpen] = useState(false);
  const [roleId, setRoleId] = useState(user.app_role_id || "");
  const [saving, setSaving] = useState(false);
  const [roleError, setRoleError] = useState("");
  const sendPercent = ((user.sent_count || 0) / Math.max(1, Number(user.max_send_per_day || 1))) * 100;
  const attachmentPercent = ((user.attachment_bytes || 0) / Math.max(1, Number(user.max_attachment_total_bytes || 1))) * 100;
  const saveRole = async () => {
    setSaving(true);
    setRoleError("");
    try {
      await onRole(user, roleId);
      setRoleOpen(false);
    } catch (err) {
      setRoleError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };
  return (
    <div className="cloud-table-item">
      <div className="cloud-table-row admin-user-row">
        <button className="icon-button sm" aria-label={expanded ? "Collapse user details" : "Expand user details"} aria-expanded={expanded} onClick={() => setExpanded((v) => !v)}><ChevronRight className={expanded ? "rotate" : ""} size={16} /></button>
        <strong title={user.username}>{user.username}</strong>
        <span data-label="Recv">{user.received_count || 0}</span>
        <span data-label="Sent">{user.sent_count || 0}</span>
        <span data-label="Boxes">{user.mailbox_count || 0}</span>
        <span data-label="Joined" title={formatDate(user.created_at)}>{formatRelative(user.created_at)}</span>
        <StatusPill value={user.status} label={user.status === "frozen" ? "disabled" : user.status} />
        <span><StatusPill value="role" label={roleName(user)} /></span>
        <span data-label="Storage">{formatBytes(user.attachment_bytes || 0)}</span>
        <Menu label="User actions" trigger={({ toggle, open }) => <button className="small-button" aria-expanded={open} onClick={toggle}>Actions<Ellipsis size={15} /></button>}>
          {(close) => (
            <>
              <button onClick={() => { close(); setRoleId(user.app_role_id || ""); setRoleOpen(true); }}><UserCog size={15} />Change role</button>
              <button onClick={() => { close(); onReset(user); }}><RotateCcw size={15} />Reset today's quota</button>
              <button onClick={() => { close(); setRoute("admin-mailboxes"); }}><Mails size={15} />View mailboxes</button>
              <hr />
              <button className={user.status === "active" ? "danger" : ""} onClick={() => { close(); onStatus(user); }}>{user.status === "active" ? <Ban size={15} /> : <CircleCheck size={15} />}{user.status === "active" ? "Disable user" : "Enable user"}</button>
            </>
          )}
        </Menu>
      </div>
      {expanded && (
        <div className="user-expand">
          <div className="detail-grid">
            <span>Last sign-in IP</span><strong className="mono">{user.last_login_ip || "Not recorded"}</strong>
            <span>Last sign-in</span><strong>{user.last_login_at ? formatDate(user.last_login_at) : "Not recorded"}</strong>
            <span>Device and browser</span><strong>{user.last_login_user_agent || "Not recorded"}</strong>
          </div>
          <div className="quota-grid">
            <QuotaBar label="Sent today" value={user.sent_count || 0} limit={user.max_send_per_day} percent={sendPercent} />
            <QuotaBar label="Attachment storage" value={formatBytes(user.attachment_bytes || 0)} limit={formatBytes(user.max_attachment_total_bytes || 0)} percent={attachmentPercent} />
            <QuotaBar label="Mailboxes" value={user.mailbox_count || 0} limit={user.max_mailboxes} percent={((user.mailbox_count || 0) / Math.max(1, Number(user.max_mailboxes || 1))) * 100} />
          </div>
          <div className="quota-readonly">
            <span>Role <strong>{roleName(user)}</strong></span>
            <span>Mailbox limit <strong>{user.max_mailboxes}</strong></span>
            <span>Daily sent <strong>{user.max_send_per_day}</strong></span>
            <span>Daily received <strong>{user.max_receive_per_day}</strong></span>
            <span>Attachment limit <strong>{formatBytes(user.max_attachment_total_bytes || 0)}</strong></span>
          </div>
        </div>
      )}
      <Modal
        open={roleOpen}
        onClose={() => setRoleOpen(false)}
        busy={saving}
        size="small-modal"
        icon={UserCog}
        title={`Change role for ${user.username}`}
        description="Roles decide which pages are available and sync mailbox, mail and attachment quotas. Auth Center still controls token quotas."
        footer={<><button onClick={() => setRoleOpen(false)} disabled={saving}>Cancel</button><button className="primary" onClick={() => void saveRole()} disabled={saving || roleId === (user.app_role_id || "")}><Check size={16} />{saving ? "Saving…" : "Save role"}</button></>}
      >
        <label>Role<select value={roleId} onChange={(e) => setRoleId(e.target.value)}>{roles.map((role) => <option key={role.id} value={role.id}>{roleName(role)}{role.is_default ? " · Default" : ""}</option>)}</select></label>
        {roleId && <p className="muted" style={{ fontSize: 12.5 }}>{roleDescription(roles.find((r) => r.id === roleId) || {})}</p>}
        {roleError && <ErrorPanel message={roleError} />}
      </Modal>
    </div>
  );
}

/* ==========================================================================
   Admin · All mailboxes
   ========================================================================== */

const ADMIN_STATUSES = ["active", "disabled", "receive_only", "send_only", "frozen", "deleted"];

export function AdminMailboxes() {
  const [query, setQuery] = useState("");
  const [status, setStatusFilter] = useState("");
  const [sort, setSort] = useState("created_desc");
  const boxes = useAsync<Mailbox[]>(() => api(`/api/admin/mailboxes?q=${encodeURIComponent(query)}&status=${status}&sort=${sort}`), [query, status, sort]);
  const { confirm } = useConfirm();
  const feedback = useFeedback();
  const update = async (box: Mailbox, next: string) => {
    if (next === box.status) return;
    const run = () => api(`/api/admin/mailboxes/${box.id}/status`, { method: "PATCH", body: JSON.stringify({ status: next }) });
    if (["disabled", "frozen", "deleted"].includes(next)) {
      const ok = await confirm({
        tone: "danger",
        title: next === "deleted" ? "Mark this mailbox as deleted?" : `Set mailbox to ${next}?`,
        description: next === "deleted" ? "The owner loses access and incoming mail is rejected." : "Incoming and/or outgoing mail for this address will be blocked.",
        target: `${box.email} · ${box.username || "unknown owner"}`,
        confirmLabel: next === "deleted" ? "Mark deleted" : `Set ${next}`,
        busyLabel: "Updating…",
        icon: next === "deleted" ? Trash : Ban,
        onConfirm: run
      });
      if (!ok) return;
      feedback.success("Mailbox updated", `${box.email} → ${next}`);
    } else {
      const res = await feedback.run({ title: "Updating mailbox", success: "Mailbox updated", successDetail: `${box.email} → ${next.replace("_", " ")}` }, run);
      if (res === undefined) return;
    }
    void boxes.reload();
  };
  return (
    <div className="stack">
      <div className="panel toolbar">
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search address, alias, or user" aria-label="Search mailboxes" />
        <select value={status} onChange={(e) => setStatusFilter(e.target.value)} aria-label="Status"><option value="">All statuses</option>{ADMIN_STATUSES.map((s) => <option key={s} value={s}>{s.replace("_", " ")}</option>)}</select>
        <select value={sort} onChange={(e) => setSort(e.target.value)} aria-label="Sort"><option value="created_desc">Newest</option><option value="local_part">Address</option><option value="owner">Owner</option><option value="status">Status</option></select>
      </div>
      <Loadable state={boxes} skeleton={<SkeletonTable rows={7} cols={4} />} label="Loading mailboxes">
        {(data) => !data.length ? <div className="panel"><EmptyState icon={Mails} title="No mailboxes match" /></div> : (
          <div className="panel table">
            <div className="table-row admin-mailbox-row table-head"><span>Address</span><span>Alias</span><span>Owner</span><span>Traffic</span><span>Status</span></div>
            {data.map((box) => (
              <div className="table-row admin-mailbox-row" key={box.id}>
                <strong style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{box.email}</strong>
                <span>{box.alias || "—"}</span>
                <span>{box.username}</span>
                <span className="mono" style={{ fontSize: 11.5 }}>↓ {box.inbound_count || 0} · ↑ {box.outbound_count || 0}</span>
                <select value={box.status} onChange={(e) => void update(box, e.target.value)} aria-label={`Status of ${box.email}`}>
                  {ADMIN_STATUSES.map((s) => <option key={s} value={s}>{s.replace("_", " ")}</option>)}
                </select>
              </div>
            ))}
          </div>
        )}
      </Loadable>
    </div>
  );
}

/* ==========================================================================
   Admin · Analytics
   ========================================================================== */

export function AdminAnalysis() {
  const [days, setDays] = useState(7);
  const analysis = useAsync<{ users: any[]; by_day: any[] }>(() => api(`/api/admin/analysis?days=${days}`), [days]);
  const feedback = useFeedback();
  const downloadCsv = () =>
    feedback.run({ title: "Exporting analytics", success: "Export ready", successDetail: "mail-agent-analysis.csv" }, async () => saveBlob(await fetchBlob(`/api/admin/analysis?days=${days}&format=csv`), "mail-agent-analysis.csv"));
  return (
    <div className="stack">
      <div className="section-head">
        <h2>Analytics</h2>
        <div className="button-row">
          <Segmented ariaLabel="Range" value={days} onChange={setDays} options={[{ value: 1, label: "Today" }, { value: 7, label: "7 days" }, { value: 30, label: "30 days" }]} />
          <button onClick={() => void downloadCsv()}><Download size={15} />CSV</button>
        </div>
      </div>
      <Loadable
        state={analysis}
        skeleton={<div className="stack"><SkeletonMetrics count={4} /><div className="charts"><SkeletonChart rows={2} /><SkeletonChart rows={2} /></div></div>}
        label="Loading analytics"
      >
        {(data) => {
          const users = data.users || [];
          const totals = users.reduce((acc, u) => ({ tokens: acc.tokens + (u.tokens || 0), sent: acc.sent + (u.sent || 0), received: acc.received + (u.received || 0), attachments: acc.attachments + (u.attachment_bytes || 0) }), { tokens: 0, sent: 0, received: 0, attachments: 0 });
          return (
            <div className="stack">
              <div className="metric-grid">
                <Metric hero icon={Sparkles} label="AI tokens" value={totals.tokens.toLocaleString()} sub="Auth Center + local records" />
                <Metric icon={Send} label="Sent" value={totals.sent.toLocaleString()} sub="Queue / Resend" />
                <Metric icon={Inbox} label="Received" value={totals.received.toLocaleString()} sub="Email Worker" />
                <Metric icon={HardDrive} label="Attachments" value={formatBytes(totals.attachments)} sub="R2 storage" />
              </div>
              <div className="charts">
                <TrendLine title="Mail trends" rows={data.by_day || []} />
                <BarChart title="Token usage" rows={users.map((u) => ({ label: u.username, value: u.tokens }))} />
                <BarChart title="Mailbox ranking" rows={users.map((u) => ({ label: u.username, value: u.mailboxes }))} />
                <BarChart title="Attachment usage" rows={users.map((u) => ({ label: u.username, value: u.attachment_bytes, display: formatBytes(u.attachment_bytes) }))} />
                <BarChart title="Agent requests" rows={users.map((u) => ({ label: u.username, value: u.agent_jobs }))} />
              </div>
            </div>
          );
        }}
      </Loadable>
    </div>
  );
}

function BarChart({ title, rows }: { title: string; rows: Array<{ label: string; value: number; display?: string }> }) {
  const sorted = [...rows].sort((a, b) => (b.value || 0) - (a.value || 0)).slice(0, 10);
  const max = Math.max(1, ...sorted.map((r) => r.value || 0));
  return (
    <div className="panel chart">
      <h3><ChartColumn size={16} />{title}</h3>
      {!sorted.some((r) => r.value) ? <EmptyState icon={ChartColumn} title="No data in this period" /> : sorted.map((row) => (
        <div className="bar-row" key={row.label}>
          <span title={row.label}>{row.label}</span>
          <div><i style={{ width: `${Math.max(2, ((row.value || 0) / max) * 100)}%` }} /></div>
          <strong>{row.display || (row.value || 0).toLocaleString()}</strong>
        </div>
      ))}
    </div>
  );
}

function TrendLine({ title, rows }: { title: string; rows: Array<{ day: string; direction: string; count: number }> }) {
  const days = Array.from(new Set(rows.map((r) => r.day))).sort();
  const max = Math.max(1, ...rows.map((r) => r.count));
  return (
    <div className="panel chart">
      <h3><ChartLine size={16} />{title}</h3>
      {!rows.length ? <EmptyState icon={ChartLine} title="No trend data" /> : ["inbound", "outbound"].map((direction) => (
        <div className="trend-row" key={direction}>
          <strong>{direction === "inbound" ? "Received" : "Sent"}</strong>
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

/* ==========================================================================
   Admin · Roles
   ========================================================================== */

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

export function AdminRoles() {
  const roles = useAsync<any[]>(() => api("/api/admin/roles"), []);
  const [editing, setEditing] = useState<any | null>(null);
  const { confirm, prompt } = useConfirm();
  const feedback = useFeedback();
  const create = async () => {
    const name = await prompt({
      title: "New role",
      description: "The role starts with Mailboxes access only — edit it afterwards to grant more.",
      label: "Role name",
      placeholder: "e.g. Support, Tester",
      confirmLabel: "Create role",
      icon: ShieldCheck,
      validate: (v) => (!v ? "Enter a role name" : v.length > 40 ? "Keep it under 40 characters" : roles.data?.some((r) => roleName(r).toLowerCase() === v.toLowerCase()) ? "A role with this name already exists" : null)
    });
    if (!name) return;
    const res = await feedback.run({ title: "Creating role", success: "Role created", successDetail: name }, () => api("/api/admin/roles", { method: "POST", body: JSON.stringify({ name, role_key: name, permissions: ["mailboxes"] }) }));
    if (res !== undefined) void roles.reload();
  };
  const remove = async (role: any) => {
    const ok = await confirm({
      tone: "danger",
      title: `Delete role “${roleName(role)}”?`,
      description: "Users with this role fall back to the default role and its quotas.",
      target: roleName(role),
      callout: "This cannot be undone.",
      confirmLabel: "Delete role",
      busyLabel: "Deleting…",
      icon: Trash,
      onConfirm: () => api(`/api/admin/roles/${role.id}`, { method: "DELETE" })
    });
    if (!ok) return;
    feedback.success("Role deleted", roleName(role));
    void roles.reload();
  };
  const makeDefault = async (role: any) => {
    const ok = await confirm({
      title: `Make “${roleName(role)}” the default role?`,
      description: "New users who sign in for the first time will get this role and its quotas.",
      confirmLabel: "Set as default",
      busyLabel: "Saving…",
      icon: Star,
      onConfirm: () => api(`/api/admin/roles/${role.id}`, { method: "PATCH", body: JSON.stringify({ ...role, name: roleName(role), is_default: 1, permissions: Array.isArray(role.permissions) ? role.permissions : JSON.parse(role.permissions || "[]"), limits: JSON.parse(role.limits_json || "{}") }) })
    });
    if (!ok) return;
    feedback.success("Default role updated", roleName(role));
    void roles.reload();
  };
  return (
    <div className="stack">
      <div className="section-head">
        <div>
          <h2>Roles</h2>
          <p>Roles control page access and local quotas.</p>
        </div>
        <button className="primary" onClick={() => void create()}><Plus size={16} />New role</button>
      </div>
      <Loadable state={roles} skeleton={<SkeletonTable rows={4} cols={4} />} label="Loading roles">
        {(data) => (
          <div className="panel table-scroll" style={{ padding: 0 }}>
            <div className="cloud-table" style={{ minWidth: 720 }}>
              <div className="cloud-table-head role-row"><strong>Role</strong><span>Order</span><span>Description</span><span>Type</span><span>Default</span><span /></div>
              {data.map((role) => (
                <div className="cloud-table-row role-row" key={role.id}>
                  <strong>{roleName(role)} {role.is_default ? <span className="mini-tag">Default</span> : null}</strong>
                  <span data-label="Order">{role.sort_order}</span>
                  <span title={roleDescription(role)}>{roleDescription(role)}</span>
                  <span><StatusPill value={role.is_system ? "system" : "custom"} /></span>
                  <span className="role-default">{role.is_default ? "Default role" : ""}</span>
                  <Menu label="Role actions" trigger={({ toggle, open }) => <button className="small-button" aria-expanded={open} onClick={toggle}>Actions<Ellipsis size={15} /></button>}>
                    {(close) => (
                      <>
                        <button onClick={() => { close(); setEditing(role); }}><Pencil size={15} />Edit permissions</button>
                        {!role.is_default && <button onClick={() => { close(); void makeDefault(role); }}><Star size={15} />Set as default</button>}
                        {!role.is_system && <><hr /><button className="danger" onClick={() => { close(); void remove(role); }}><Trash size={15} />Delete role</button></>}
                      </>
                    )}
                  </Menu>
                </div>
              ))}
            </div>
          </div>
        )}
      </Loadable>
      <RoleEditor role={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); void roles.reload(); }} />
    </div>
  );
}

function RoleEditor({ role, onClose, onSaved }: { role: any | null; onClose: () => void; onSaved: () => void }) {
  const [draft, setDraft] = useState<any>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const feedback = useFeedback();
  useEffect(() => {
    if (!role) return;
    setError("");
    setDraft({
      ...role,
      name: roleName(role),
      description: roleDescription(role),
      permissions: Array.isArray(role.permissions) ? role.permissions : JSON.parse(role.permissions || "[]"),
      limits: JSON.parse(role.limits_json || "{}")
    });
  }, [role]);
  const togglePermission = (key: string) => {
    setDraft((prev: any) => {
      const set = new Set(prev.permissions);
      set.has(key) ? set.delete(key) : set.add(key);
      return { ...prev, permissions: Array.from(set) };
    });
  };
  const save = async () => {
    setSaving(true);
    setError("");
    try {
      await api(`/api/admin/roles/${role.id}`, { method: "PATCH", body: JSON.stringify(draft) });
      feedback.success("Role saved", draft.name);
      onSaved();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };
  const isAdmin = draft?.role_key === "admin";
  const setLimit = (key: string, value: string) => setDraft({ ...draft, limits: { ...draft.limits, [key]: value === "" ? undefined : Number(value) } });
  return (
    <Modal
      open={!!role}
      onClose={onClose}
      busy={saving}
      size="role-modal"
      icon={ShieldCheck}
      title="Edit role permissions"
      description="Changes apply to every user with this role on their next request."
      footer={<><span className="footer-note">{draft?.permissions?.length || 0} of {permissionTree.length} areas enabled</span><button onClick={onClose} disabled={saving}>Cancel</button><button className="primary" onClick={() => void save()} disabled={saving}><Save size={16} />{saving ? "Saving…" : "Save role"}</button></>}
    >
      {draft && (
        <>
          <div className="split">
            <label>Role name<input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} /></label>
            <label>Order<input type="number" value={draft.sort_order} onChange={(e) => setDraft({ ...draft, sort_order: Number(e.target.value) })} /></label>
          </div>
          <label>Description<input value={draft.description || ""} onChange={(e) => setDraft({ ...draft, description: e.target.value })} /></label>
          <span className="eyebrow">Permissions</span>
          <div className="permission-tree">
            {permissionTree.map((node) => (
              <div className="permission-node" key={node.key}>
                <label><input type="checkbox" checked={draft.permissions.includes(node.key)} onChange={() => togglePermission(node.key)} />{node.label}</label>
                <div>{node.children.map((child) => <span key={child}>{child}</span>)}</div>
              </div>
            ))}
          </div>
          <span className="eyebrow">Quotas</span>
          <div className="limit-editor">
            <label>Max mailboxes<input type="number" min={0} disabled={isAdmin} value={draft.limits.max_mailboxes ?? ""} onChange={(e) => setLimit("max_mailboxes", e.target.value)} /></label>
            <label>Daily sent<input type="number" min={0} disabled={isAdmin} value={draft.limits.max_send_per_day ?? ""} onChange={(e) => setLimit("max_send_per_day", e.target.value)} /></label>
            <label>Daily received<input type="number" min={0} disabled={isAdmin} value={draft.limits.max_receive_per_day ?? ""} onChange={(e) => setLimit("max_receive_per_day", e.target.value)} /></label>
            <label>Attachments (MB)<input type="number" min={0} disabled={isAdmin} value={draft.limits.max_attachment_total_mb ?? ""} onChange={(e) => setLimit("max_attachment_total_mb", e.target.value)} /></label>
          </div>
          {isAdmin && <div className="alert info">Administrator quotas are unlimited, but usage is still tracked.</div>}
          {error && <ErrorPanel message={error} />}
        </>
      )}
    </Modal>
  );
}

/* ==========================================================================
   Admin · System settings — landing background (authcenter-avatar-crop)
   ========================================================================== */

interface SystemSettings {
  landing_background_opacity?: number;
  landing_background_url?: string;
  landing_background_original_url?: string;
  landing_background_crop?: CropParams | null;
  landing_background_restore?: { token: string; deadline: string } | null;
  landing?: LandingSettings;
  loading?: LoadingSettings;
}

const sameJson = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

export function AdminSystemSettings() {
  const settings = useAsync<{ settings: SystemSettings }>(() => api("/api/admin/system-settings"), []);
  const [opacity, setOpacity] = useState(0.18);
  const [savedOpacity, setSavedOpacity] = useState(0.18);
  const [editor, setEditor] = useState<CropSource | null>(null);
  const [opening, setOpening] = useState(false);
  const [busy, setBusy] = useState<"" | "landing" | "loading" | "restore">("");
  const [landing, setLanding] = useState<LandingSettings>(DEFAULT_LANDING);
  const [loadingCfg, setLoadingCfg] = useState<LoadingSettings>(DEFAULT_LOADING);
  const [, setTick] = useState(0);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const objectUrls = useRef<string[]>([]);
  const { confirm } = useConfirm();
  const feedback = useFeedback();
  const s = settings.data?.settings;
  const hasCustom = !!s?.landing_background_url;
  const restore = s?.landing_background_restore && new Date(s.landing_background_restore.deadline).getTime() > Date.now() ? s.landing_background_restore : null;

  const initialized = useRef(false);
  // Initialise drafts once; later local updates (crop saved, restore…) must not wipe unsaved edits.
  useEffect(() => {
    if (s && !initialized.current) {
      initialized.current = true;
      const o = Number(s.landing_background_opacity ?? 0.18);
      setOpacity(o);
      setSavedOpacity(o);
      setLanding({ ...DEFAULT_LANDING, ...(s.landing || {}) });
      setLoadingCfg({ ...DEFAULT_LOADING, ...(s.loading || {}) });
    }
  }, [settings.data]);
  // Keep the restore countdown fresh.
  useEffect(() => {
    if (!restore) return;
    const t = window.setInterval(() => setTick((n) => n + 1), 15000);
    return () => window.clearInterval(t);
  }, [restore?.token]);
  useEffect(() => () => objectUrls.current.forEach((u) => URL.revokeObjectURL(u)), []);

  const track = (url: string) => {
    objectUrls.current.push(url);
    return url;
  };

  /** Upload: read the file locally and open the editor — nothing is saved until "Save crop". */
  const pickFile = (file: File) => {
    if (!file.type.startsWith("image/")) {
      feedback.error("Not an image", `${file.name} is ${file.type || "an unknown type"}.`);
      return;
    }
    setEditor({ url: track(URL.createObjectURL(file)), file, initial: null });
  };

  /** Adjust: reopen from the stored original (never from the previous crop). */
  const adjust = async () => {
    if (!s?.landing_background_original_url && !s?.landing_background_url) return;
    setOpening(true);
    try {
      const blob = await fetchBlob(s.landing_background_original_url || s.landing_background_url || "");
      setEditor({ url: track(URL.createObjectURL(blob)), initial: s.landing_background_crop || null });
    } catch (err) {
      feedback.error("Couldn't open the original image", errorMessage(err));
    } finally {
      setOpening(false);
    }
  };

  const saveCrop = async ({ cropped, original, crop }: { cropped: Blob; original?: File; crop: CropParams }) => {
    const form = new FormData();
    form.append("cropped", new File([cropped], "background-cropped.jpg", { type: cropped.type || "image/jpeg" }));
    if (original) form.append("original", original);
    form.append("crop", JSON.stringify(crop));
    const total = cropped.size + (original?.size || 0);
    // Errors propagate to the editor so they stay visible in the modal (F5) as well as in the notice.
    const next = await feedback.run(
      { title: original ? "Uploading background" : "Saving crop", detail: formatBytes(total), success: original ? "Landing background updated" : "Crop saved", successDetail: "Visible on the sign-in page now", activityDelay: 200, rethrow: true },
      (activity) => uploadForm<SystemSettings>("/api/admin/system-settings/background", form, (p) => activity.update({ progress: p }))
    );
    if (next) {
      settings.setData({ settings: { ...(s || {}), ...next, landing: { ...savedLanding, mode: "image" } } });
      setLanding((l) => ({ ...l, mode: "image" }));
    }
    setEditor(null);
  };

  const remove = async () => {
    let result: { restore?: { token: string; deadline: string } } | null = null;
    const ok = await confirm({
      tone: "danger",
      title: "Remove the landing background?",
      description: "The sign-in page switches back to the default wave background immediately.",
      callout: "You can restore it for 30 minutes. After that the original and cropped images are deleted permanently.",
      confirmLabel: "Remove background",
      busyLabel: "Removing…",
      icon: Trash,
      onConfirm: async () => { result = await api("/api/admin/system-settings/background", { method: "DELETE" }); }
    });
    if (!ok) return;
    const restoreInfo = (result as { restore?: { token: string; deadline: string } } | null)?.restore || null;
    settings.setData({ settings: { ...(s || {}), landing_background_url: "", landing_background_original_url: "", landing_background_crop: null, landing_background_restore: restoreInfo, landing: { ...savedLanding, mode: "wave" } } });
    setLanding((l) => ({ ...l, mode: "wave" }));
    feedback.notify({
      tone: "success",
      title: "Background removed",
      detail: restoreInfo ? `Restore available until ${new Date(restoreInfo.deadline).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}` : undefined,
      duration: 8000,
      action: restoreInfo ? { label: "Undo", onClick: () => void restoreBg(restoreInfo.token) } : undefined
    });
  };

  const restoreBg = async (token = restore?.token) => {
    if (!token) return;
    setBusy("restore");
    const next = await feedback.run({ title: "Restoring background", success: "Background restored" }, () => api<SystemSettings>("/api/admin/system-settings/background/restore", { method: "POST", body: JSON.stringify({ token }) }));
    setBusy("");
    if (next) {
      settings.setData({ settings: { ...(settings.data?.settings || {}), ...next, landing: { ...savedLanding, mode: "image" } } });
      setLanding((l) => ({ ...l, mode: "image" }));
    } else void settings.reload();
  };

  const savedLanding = { ...DEFAULT_LANDING, ...(s?.landing || {}) };
  const savedLoading = { ...DEFAULT_LOADING, ...(s?.loading || {}) };
  const landingDirty = !sameJson(landing, savedLanding) || Math.abs(opacity - savedOpacity) > 0.001;
  const loadingDirty = !sameJson(loadingCfg, savedLoading);

  const patchSettings = async (body: Record<string, unknown>) => {
    const res = await api<{ settings: SystemSettings & Record<string, unknown> }>("/api/admin/system-settings", { method: "PATCH", body: JSON.stringify(body) });
    settings.setData({ settings: { ...(settings.data?.settings || {}), ...(res.settings.landing ? { landing: res.settings.landing } : {}), ...(res.settings.loading ? { loading: res.settings.loading } : {}), ...("landing_background_opacity" in body ? { landing_background_opacity: Number(body.landing_background_opacity) } : {}) } });
    return res;
  };

  const saveLanding = async () => {
    setBusy("landing");
    const res = await feedback.run({ title: "Saving landing page", success: "Landing page saved", successDetail: "Visible on the sign-in page now" }, () => patchSettings({ landing, landing_background_opacity: opacity }));
    setBusy("");
    if (res !== undefined) setSavedOpacity(opacity);
  };

  const saveLoading = async () => {
    setBusy("loading");
    await feedback.run({ title: "Saving loading page", success: "Loading page saved", successDetail: "Used on the next sign-in" }, () => patchSettings({ loading: loadingCfg }));
    setBusy("");
  };

  /** Back to the original design: Wave background + default copy + step-by-step loading screen. */
  const restoreWave = async () => {
    const ok = await confirm({
      title: "Restore the original Wave page?",
      description: "The sign-in page goes back to the animated Wave background with the default title, tagline and feature list, and the loading page returns to the step-by-step style.",
      callout: hasCustom ? "Your uploaded background image stays stored — switch Background to Image any time to use it again." : undefined,
      confirmLabel: "Restore Wave page",
      busyLabel: "Restoring…",
      icon: Waves,
      onConfirm: () => patchSettings({ landing: DEFAULT_LANDING, loading: DEFAULT_LOADING, landing_background_opacity: 0.18 })
    });
    if (!ok) return;
    setLanding(DEFAULT_LANDING);
    setLoadingCfg(DEFAULT_LOADING);
    setOpacity(0.18);
    setSavedOpacity(0.18);
    feedback.success("Original Wave page restored");
  };

  const minutesLeft = restore ? Math.max(0, Math.ceil((new Date(restore.deadline).getTime() - Date.now()) / 60000)) : 0;

  return (
    <Loadable state={settings} skeleton={<LandingSkeleton />} label="Loading system settings">
      {() => (
        <div className="stack">
          <div className="section-head">
            <div>
              <h2>Sign-in experience</h2>
              <p>What people see before and while they sign in. Changes apply after saving.</p>
            </div>
            <button onClick={() => void restoreWave()}><Waves size={16} />Restore original Wave page</button>
          </div>

          {/* ---------------- Landing page ---------------- */}
          <div className="panel landing-settings">
            <div className="section-head">
              <div>
                <h2><Wallpaper size={18} />Landing page{landingDirty && <span className="dirty-dot" title="Unsaved changes" />}</h2>
                <p>The sign-in page shown to signed-out visitors.</p>
              </div>
              <div className="button-row">
                {landingDirty && <button className="small-button ghost" onClick={() => { setLanding(savedLanding); setOpacity(savedOpacity); }}><Undo2 size={15} />Discard</button>}
                <button className="primary small-button" onClick={() => void saveLanding()} disabled={!landingDirty || busy === "landing"}><Save size={15} />{busy === "landing" ? "Saving…" : "Save landing page"}</button>
              </div>
            </div>
            <div className="preview-grid">
              <ScaledPreview label={landing.mode === "image" && hasCustom ? "Preview · image" : "Preview · wave"}>
                <LoginView preview config={{ app_id: "", auth_center_url: "", callback_url: "", landing_background_url: s?.landing_background_url, landing_background_opacity: opacity, landing }} />
              </ScaledPreview>
              <div className="form-grid">
                <span className="eyebrow">Background</span>
                <div className="option-cards" role="radiogroup" aria-label="Background">
                  <button role="radio" aria-checked={landing.mode === "wave"} className={`option-card ${landing.mode === "wave" ? "on" : ""}`} onClick={() => setLanding({ ...landing, mode: "wave" })}>
                    <span className="mini" style={{ background: "radial-gradient(75% 60% at 50% 0%, color-mix(in oklab, var(--primary) 22%, transparent), transparent 70%), repeating-linear-gradient(90deg, color-mix(in oklab, var(--primary) 26%, transparent) 0 1px, transparent 1px 6px)" }} />
                    Wave<small>Animated line field (original)</small>
                  </button>
                  <button role="radio" aria-checked={landing.mode === "image"} className={`option-card ${landing.mode === "image" ? "on" : ""}`} disabled={!hasCustom} onClick={() => setLanding({ ...landing, mode: "image" })}>
                    <span className="mini" style={hasCustom ? { backgroundImage: `url(${s?.landing_background_url})`, backgroundSize: "cover", backgroundPosition: "center" } : { display: "grid", placeItems: "center", color: "var(--muted-foreground)" }}>{!hasCustom && <Wallpaper size={16} />}</span>
                    Image<small>{hasCustom ? "Your cropped background" : "Upload an image below first"}</small>
                  </button>
                </div>
                <ElasticSlider label="Wave intensity" value={landing.wave_opacity} min={0} max={1} step={0.05} onChange={(wave_opacity) => setLanding({ ...landing, wave_opacity })} format={(v) => `${Math.round(v * 100)}%`} />
                {landing.mode === "image" && (
                  <div className="setting-row" style={{ padding: "4px 0" }}>
                    <div><strong>Waves over image</strong><small>Draw the line field on top of the photo.</small></div>
                    <Switch label="Waves over image" checked={landing.waves_over_image} onChange={(waves_over_image) => setLanding({ ...landing, waves_over_image })} />
                  </div>
                )}
                <label>Title<input value={landing.title} maxLength={60} onChange={(e) => setLanding({ ...landing, title: e.target.value })} placeholder={DEFAULT_LANDING.title} /></label>
                <label>Tagline<input value={landing.tagline} maxLength={160} onChange={(e) => setLanding({ ...landing, tagline: e.target.value })} placeholder={DEFAULT_LANDING.tagline} /></label>
                <span className="char-count">{landing.tagline.length} / 160</span>
                <div className="setting-row" style={{ padding: "4px 0" }}>
                  <div><strong>Feature list</strong><small>The three highlight rows under the tagline.</small></div>
                  <Switch label="Feature list" checked={landing.show_features} onChange={(show_features) => setLanding({ ...landing, show_features })} />
                </div>
              </div>
            </div>

            <div className="settings-section">
              <header><div><h3><ImageUp size={16} />Background image</h3><p>Cropped to 16:9 (1920×1080); the original is kept for re-cropping. Uploading switches the page to Image.</p></div></header>
              <div className="landing-bg-editor">
                <div className="stack compact-stack">
                  <div className="bg-status">
                    {hasCustom ? <img className="thumb" src={s?.landing_background_url} alt="" /> : <span className="thumb" style={{ display: "grid", placeItems: "center", color: "var(--muted-foreground)" }}><Wallpaper size={16} /></span>}
                    <div style={{ minWidth: 0 }}>
                      <strong>{hasCustom ? (landing.mode === "image" ? "Custom background · in use" : "Custom background · stored") : "No custom image"}</strong>
                      <small>{restore ? `Removed · restore available for ${minutesLeft} min` : hasCustom ? (s?.landing_background_original_url ? "Original kept for re-cropping" : "Legacy upload — upload again to enable re-cropping") : "Upload an image to personalize the sign-in page"}</small>
                    </div>
                  </div>
                  <div className="bg-actions">
                    <label className="upload-button">
                      <ImageUp size={16} />
                      {hasCustom ? "Replace" : "Upload"}
                      <input ref={fileRef} type="file" accept="image/*" onChange={(e) => { const f = e.target.files?.[0]; if (f) pickFile(f); e.target.value = ""; }} />
                    </label>
                    <button onClick={() => void adjust()} disabled={!hasCustom || opening}>{opening ? <span className="ring-spinner" /> : <Crop size={16} />}Adjust</button>
                    <button className="danger" onClick={() => void remove()} disabled={!hasCustom}><Trash size={16} />Delete</button>
                    <button onClick={() => void restoreBg()} disabled={!restore || busy === "restore"}><Undo2 size={16} />{busy === "restore" ? "Restoring…" : "Restore"}</button>
                  </div>
                </div>
                <div className="stack compact-stack">
                  <ElasticSlider label="Image opacity" value={opacity} min={0} max={1} step={0.01} onChange={setOpacity} format={(v) => `${Math.round(v * 100)}%`} />
                  <span className="muted text-meta">Lower values keep the sign-in card readable. Saved with the landing page.</span>
                </div>
              </div>
            </div>
          </div>

          {/* ---------------- Loading page ---------------- */}
          <div className="panel landing-settings">
            <div className="section-head">
              <div>
                <h2><Loader size={18} />Sign-in loading page{loadingDirty && <span className="dirty-dot" title="Unsaved changes" />}</h2>
                <p>Shown while Auth Center hands the user back and the session is verified or renewed.</p>
              </div>
              <div className="button-row">
                {loadingDirty && <button className="small-button ghost" onClick={() => setLoadingCfg(savedLoading)}><Undo2 size={15} />Discard</button>}
                <button className="primary small-button" onClick={() => void saveLoading()} disabled={!loadingDirty || busy === "loading"}><Save size={15} />{busy === "loading" ? "Saving…" : "Save loading page"}</button>
              </div>
            </div>
            <div className="preview-grid">
              <ScaledPreview label="Preview">
                <BootScreen
                  preview
                  loading={loadingCfg}
                  progress={0.45}
                  steps={[
                    { label: "Received token from Auth Center", state: "done" },
                    { label: "Verifying identity and app access", state: "active" },
                    { label: "Loading your workspace", state: "pending" }
                  ]}
                />
              </ScaledPreview>
              <div className="form-grid">
                <span className="eyebrow">Style</span>
                <div className="option-cards" role="radiogroup" aria-label="Loading style">
                  <button role="radio" aria-checked={loadingCfg.style === "steps"} className={`option-card ${loadingCfg.style === "steps" ? "on" : ""}`} onClick={() => setLoadingCfg({ ...loadingCfg, style: "steps" })}>
                    <ListChecks size={18} />Steps<small>Shows each verification stage</small>
                  </button>
                  <button role="radio" aria-checked={loadingCfg.style === "minimal"} className={`option-card ${loadingCfg.style === "minimal" ? "on" : ""}`} onClick={() => setLoadingCfg({ ...loadingCfg, style: "minimal" })}>
                    <Loader size={18} />Minimal<small>Logo, message and progress only</small>
                  </button>
                </div>
                <label>Title<input value={loadingCfg.title} maxLength={60} onChange={(e) => setLoadingCfg({ ...loadingCfg, title: e.target.value })} placeholder={DEFAULT_LOADING.title} /></label>
                <label>Message<input value={loadingCfg.subtitle} maxLength={160} onChange={(e) => setLoadingCfg({ ...loadingCfg, subtitle: e.target.value })} placeholder={DEFAULT_LOADING.subtitle} /></label>
                <div>
                  <div className="setting-row">
                    <div><strong>Progress bar</strong><small>Thin bar under the card.</small></div>
                    <Switch label="Progress bar" checked={loadingCfg.show_progress} onChange={(show_progress) => setLoadingCfg({ ...loadingCfg, show_progress })} />
                  </div>
                  <div className="setting-row">
                    <div><strong>Wave background</strong><small>Line field behind the card.</small></div>
                    <Switch label="Wave background" checked={loadingCfg.show_waves} onChange={(show_waves) => setLoadingCfg({ ...loadingCfg, show_waves })} />
                  </div>
                </div>
                <span className="muted text-meta">Error states always show the failing step and a retry button.</span>
              </div>
            </div>
          </div>

          <CropEditor
            open={!!editor}
            source={editor}
            aspect={16 / 9}
            output={{ width: 1920, height: 1080, type: "image/jpeg", quality: 0.9 }}
            onCancel={() => setEditor(null)}
            onSave={saveCrop}
          />
        </div>
      )}
    </Loadable>
  );
}

function LandingSkeleton() {
  return (
    <div className="panel landing-settings">
      <div><Sk className="sk-title" w="24%" /><Sk className="sk-line" w="52%" /></div>
      <div className="landing-bg-editor">
        <Sk w="100%" r={14} style={{ aspectRatio: "16 / 9" }} />
        <div className="stack compact-stack">
          <Sk h={62} w="100%" r={12} />
          <div className="bg-actions">{Array.from({ length: 4 }, (_, i) => <Sk key={i} className="sk-btn" w="100%" h={36} delay={i * 60} />)}</div>
          <Sk h={48} w="100%" r={12} />
        </div>
      </div>
    </div>
  );
}

/* ==========================================================================
   Admin · Audit
   ========================================================================== */

export function AdminAudit() {
  const [query, setQuery] = useState("");
  const [action, setAction] = useState("");
  const logs = useAsync<any[]>(() => api(`/api/admin/audit-logs?q=${encodeURIComponent(query)}&action=${encodeURIComponent(action)}`), [query, action]);
  return (
    <div className="stack">
      <div className="panel toolbar">
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search user, action, or target" aria-label="Search logs" />
        <input value={action} onChange={(e) => setAction(e.target.value)} placeholder="Event type, e.g. mailbox.delete" aria-label="Event type" style={{ flex: "0 1 260px" }} />
        <button onClick={() => void logs.reload()} disabled={logs.loading}><RefreshCw size={15} className={logs.loading && logs.data ? "spin" : ""} />Refresh</button>
      </div>
      <Loadable state={logs} skeleton={<SkeletonTable rows={10} cols={4} />} label="Loading audit logs">
        {(data) => !data.length ? <div className="panel"><EmptyState icon={ScrollText} title="No log entries match" /></div> : (
          <div className="panel table">
            <div className="table-row audit-row table-head"><span>Event</span><span>Actor</span><span>Target</span><span>Time</span></div>
            {data.map((log) => (
              <div className="table-row audit-row" key={log.id}>
                <strong>{log.action}</strong>
                <span>{log.actor_username || "system"}</span>
                <span className="mono" style={{ fontSize: 11.5 }} title={`${log.target_type}:${log.target_id}`}>{log.target_type}:{log.target_id}</span>
                <span title={formatDate(log.created_at)}>{formatDate(log.created_at)}</span>
              </div>
            ))}
          </div>
        )}
      </Loadable>
    </div>
  );
}
