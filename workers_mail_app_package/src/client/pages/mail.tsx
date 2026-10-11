import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Archive,
  ArrowDownToLine,
  ArrowLeft,
  ArrowUpFromLine,
  Ban,
  Bold,
  Bot,
  BrushCleaning,
  Check,
  ChevronRight,
  CircleCheck,
  Code,
  Copy,
  Download,
  Ellipsis,
  Eye,
  File,
  FileArchive,
  FileClock,
  FileImage,
  FilePen,
  FileText,
  Image,
  Inbox,
  Italic,
  Link,
  List,
  Mail,
  Mailbox as MailboxIcon,
  MailOpen,
  Maximize2,
  Minimize2,
  Paperclip,
  Pencil,
  Plus,
  RefreshCw,
  Replace,
  RotateCcw,
  Send,
  Snowflake,
  Sparkles,
  Square,
  SquareCheck,
  SquarePen,
  Star,
  TextCursorInput,
  Trash,
  Underline,
  Upload,
  X
} from "lucide-react";
import { EmptyState, ErrorPanel, Loadable, Menu, StatusPill } from "../components";
import { Modal, errorMessage, useConfirm, useFeedback } from "../ui/feedback";
import { SkeletonAttachmentGrid, SkeletonComposer, SkeletonDetail, SkeletonMailList, SkeletonMailboxList, SkeletonSwap, SkeletonTable } from "../ui/skeleton";
import {
  api,
  fetchBlob,
  formatBytes,
  formatDate,
  formatRelative,
  saveBlob,
  setRoute,
  uploadForm,
  useAsync,
  type AgentJob,
  type Attachment,
  type Draft,
  type EmailItem,
  type Mailbox,
  type User
} from "../lib";

/* ==========================================================================
   Mailboxes
   ========================================================================== */

const MAILBOX_STATUSES: Array<{ value: string; label: string; icon: React.ElementType; sensitive?: boolean; hint: string }> = [
  { value: "active", label: "Active", icon: CircleCheck, hint: "Send and receive" },
  { value: "receive_only", label: "Receive only", icon: ArrowDownToLine, hint: "Outgoing mail is blocked" },
  { value: "send_only", label: "Send only", icon: ArrowUpFromLine, hint: "Incoming mail is rejected" },
  { value: "disabled", label: "Disabled", icon: Ban, sensitive: true, hint: "Incoming mail will be rejected and sending is blocked" },
  { value: "frozen", label: "Frozen", icon: Snowflake, sensitive: true, hint: "All activity is suspended until it is unfrozen" }
];

export function Mailboxes() {
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState("created_desc");
  const boxes = useAsync<Mailbox[]>(() => api(`/api/mailboxes?q=${encodeURIComponent(query)}&sort=${sort}`), [query, sort]);
  const [selectedId, setSelectedId] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const selected = useMemo(() => boxes.data?.find((box) => box.id === selectedId) || boxes.data?.[0], [boxes.data, selectedId]);
  return (
    <div className="mail-workbench">
      <aside className="mailbox-rail panel">
        <div className="section-head">
          <div>
            <h2>Mailboxes</h2>
            <p>{boxes.data ? `${boxes.data.length} address${boxes.data.length === 1 ? "" : "es"}` : " "}</p>
          </div>
          <button className="primary small-button" onClick={() => setCreateOpen(true)}><Plus size={15} />New</button>
        </div>
        <div className="toolbar compact-toolbar">
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search mailboxes" aria-label="Search mailboxes" />
          <select value={sort} onChange={(e) => setSort(e.target.value)} aria-label="Sort mailboxes">
            <option value="created_desc">Newest</option>
            <option value="created_asc">Oldest</option>
            <option value="local_part">Address</option>
            <option value="status">Status</option>
          </select>
        </div>
        <div style={{ minHeight: 0, overflow: "auto" }}>
          <Loadable state={boxes} skeleton={<SkeletonMailboxList />} label="Loading mailboxes">
            {(data) => !data.length ? (
              <EmptyState icon={MailboxIcon} title={query ? "No matching mailboxes" : "No mailboxes yet"} hint={query ? undefined : "Create an address to start receiving mail."} action={!query ? <button className="primary small-button" onClick={() => setCreateOpen(true)}><Plus size={15} />Create mailbox</button> : undefined} />
            ) : (
              <div className="mailbox-list">
                {data.map((box) => <MailboxCard key={box.id} box={box} active={selected?.id === box.id} onSelect={() => setSelectedId(box.id)} onReload={boxes.reload} />)}
              </div>
            )}
          </Loadable>
        </div>
      </aside>
      <section className="mailbox-mails">
        {selected ? (
          <>
            <div className="panel mailbox-summary">
              <div style={{ minWidth: 0 }}>
                <span className="eyebrow">Current mailbox</span>
                <h2>{selected.email}</h2>
                <p>{selected.alias || "No alias"} · created {formatRelative(selected.created_at)}</p>
              </div>
              <div className="summary-stats">
                <span>Received<strong>{selected.inbound_count || 0}</strong></span>
                <span>Sent<strong>{selected.outbound_count || 0}</strong></span>
                <span>Attachments<strong>{formatBytes(selected.attachment_bytes || 0)}</strong></span>
              </div>
            </div>
            <EmailList key={selected.id} mailboxId={selected.id} compactTitle="Messages" />
          </>
        ) : boxes.data && !boxes.data.length ? (
          <div className="panel hide-mobile"><EmptyState icon={Mail} title="Select or create a mailbox to view its messages" /></div>
        ) : !boxes.data ? <SkeletonMailList rows={6} /> : null}
      </section>
      <CreateMailboxModal open={createOpen} onClose={() => setCreateOpen(false)} onCreated={(box) => { setSelectedId(box?.id || ""); void boxes.reload(); }} />
    </div>
  );
}

function CreateMailboxModal({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (box: Mailbox | null) => void }) {
  const [local, setLocal] = useState("");
  const [alias, setAlias] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const feedback = useFeedback();
  useEffect(() => { if (open) { setLocal(""); setAlias(""); setError(""); } }, [open]);
  const create = async () => {
    setBusy(true);
    setError("");
    try {
      const box = await api<Mailbox>("/api/mailboxes", { method: "POST", body: JSON.stringify({ local_part: local.trim(), alias: alias.trim() }) });
      feedback.success("Mailbox created", box?.email || `${local.trim() || "Random address"}@112327.xyz`);
      onCreated(box || null);
      onClose();
    } catch (err) {
      setError(errorMessage(err, "Creation failed"));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      open={open}
      onClose={onClose}
      busy={busy}
      size="small-modal"
      icon={MailboxIcon}
      title="New mailbox"
      description="Leave the address empty to generate a random one."
      footer={<><button onClick={onClose} disabled={busy}>Cancel</button><button className="primary" disabled={busy} onClick={() => void create()}>{busy ? <span className="ring-spinner" style={{ borderTopColor: "currentColor" }} /> : <Plus size={16} />}{busy ? "Creating…" : "Create mailbox"}</button></>}
    >
      <label>Email address<div className="input-suffix"><input value={local} onChange={(e) => setLocal(e.target.value)} placeholder="new-address" onKeyDown={(e) => e.key === "Enter" && void create()} /><span>@112327.xyz</span></div></label>
      <label>Alias / purpose<input value={alias} onChange={(e) => setAlias(e.target.value)} placeholder="e.g. shopping, testing, sign-ups" onKeyDown={(e) => e.key === "Enter" && void create()} /></label>
      {error && <ErrorPanel message={error} />}
    </Modal>
  );
}

function MailboxCard({ box, active, onSelect, onReload }: { box: Mailbox; active?: boolean; onSelect: () => void; onReload: () => void }) {
  const [alias, setAlias] = useState(box.alias || "");
  const { confirm } = useConfirm();
  const feedback = useFeedback();
  const update = async (status: string) => {
    const meta = MAILBOX_STATUSES.find((s) => s.value === status);
    if (meta?.sensitive) {
      const ok = await confirm({
        title: `${meta.label === "Frozen" ? "Freeze" : "Disable"} ${box.email}?`,
        description: meta.hint + ".",
        target: box.email,
        confirmLabel: meta.label === "Frozen" ? "Freeze mailbox" : "Disable mailbox",
        busyLabel: "Updating…",
        icon: meta.icon,
        onConfirm: () => api(`/api/mailboxes/${box.id}`, { method: "PATCH", body: JSON.stringify({ status }) })
      });
      if (!ok) return;
      feedback.success(`Mailbox ${meta.label.toLowerCase()}`, box.email);
    } else {
      await feedback.run({ title: "Updating mailbox", success: `Mailbox set to ${meta?.label.toLowerCase() || status}`, successDetail: box.email }, () => api(`/api/mailboxes/${box.id}`, { method: "PATCH", body: JSON.stringify({ status }) }));
    }
    onReload();
  };
  const saveAlias = async () => {
    await feedback.run({ title: "Saving alias", success: "Alias saved", successDetail: alias || "Alias cleared" }, () => api(`/api/mailboxes/${box.id}`, { method: "PATCH", body: JSON.stringify({ alias }) }));
    onReload();
  };
  const remove = async () => {
    const ok = await confirm({
      tone: "danger",
      title: "Delete this mailbox?",
      description: "The address stops receiving mail immediately.",
      target: box.email,
      callout: "Messages and attachments stored for this address will be removed. This cannot be undone.",
      typeToConfirm: box.local_part || box.email.split("@")[0],
      confirmLabel: "Delete mailbox",
      busyLabel: "Deleting…",
      icon: Trash,
      onConfirm: () => api(`/api/mailboxes/${box.id}`, { method: "DELETE" })
    });
    if (!ok) return;
    feedback.success("Mailbox deleted", box.email);
    onReload();
  };
  return (
    <article className={`mailbox-card ${active ? "active" : ""}`}>
      <button className="mailbox-main" onClick={onSelect} aria-current={active ? "true" : undefined}>
        <span className="mailbox-badge"><Mail size={17} /></span>
        <span>
          <strong>{box.email}</strong>
          <small>{box.alias || "No alias"}</small>
        </span>
      </button>
      <div className="mailbox-stats">
        <span>↓ {box.inbound_count || 0}</span>
        <span>↑ {box.outbound_count || 0}</span>
        <span>{formatBytes(box.attachment_bytes || 0)}</span>
      </div>
      <div className="mailbox-card-footer">
        <StatusPill value={box.status} />
        <Menu label="Mailbox actions" trigger={({ toggle, open }) => <button className="icon-button sm" aria-label="Mailbox actions" aria-expanded={open} onClick={toggle}><Ellipsis size={16} /></button>}>
          {(close) => (
            <>
              <div className="menu-caption">Alias</div>
              <div className="alias-row">
                <input value={alias} onChange={(e) => setAlias(e.target.value)} placeholder="Alias" aria-label="Alias" onKeyDown={(e) => { if (e.key === "Enter") { close(); void saveAlias(); } }} />
                <button aria-label="Save alias" onClick={() => { close(); void saveAlias(); }}><Check size={15} /></button>
              </div>
              <hr />
              <div className="menu-caption">Status</div>
              {MAILBOX_STATUSES.map((s) => (
                <button key={s.value} role="menuitemradio" aria-checked={box.status === s.value} disabled={box.status === s.value} onClick={() => { close(); void update(s.value); }}>
                  <s.icon size={15} />{s.label}
                </button>
              ))}
              <hr />
              <button className="danger" onClick={() => { close(); void remove(); }}><Trash size={15} />Delete mailbox</button>
            </>
          )}
        </Menu>
      </div>
    </article>
  );
}

/* ==========================================================================
   Mail list
   ========================================================================== */

export function EmailList({ direction, mailboxId, starredOnly, compactTitle }: { direction?: "inbound" | "outbound"; mailboxId?: string; starredOnly?: boolean; compactTitle?: string }) {
  const [query, setQuery] = useState("");
  const [read, setRead] = useState("");
  const [hasAttachment, setHasAttachment] = useState(false);
  const [folder, setFolder] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const { confirm } = useConfirm();
  const feedback = useFeedback();
  const params = new URLSearchParams();
  if (direction) params.set("direction", direction);
  if (mailboxId) params.set("mailbox_id", mailboxId);
  if (starredOnly) params.set("starred", "1");
  if (query) params.set("q", query);
  if (read) params.set("read", read);
  if (hasAttachment) params.set("has_attachment", "1");
  if (folder) params.set("folder", folder);
  const list = useAsync<EmailItem[]>(() => api(`/api/emails?${params.toString()}`), [direction, mailboxId, starredOnly, query, read, hasAttachment, folder]);
  const [optimisticStars, setOptimisticStars] = useState<Record<string, number>>({});
  const toggle = (id: string) => setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  const allSelected = !!list.data?.length && list.data.every((e) => selected.includes(e.id));
  const bulk = async (action: string) => {
    const n = selected.length;
    const labels: Record<string, string> = { mark_read: "marked as read", mark_unread: "marked as unread", archive: "archived", delete: "deleted" };
    const run = () => api("/api/emails/bulk", { method: "PATCH", body: JSON.stringify({ ids: selected, action }) });
    if (action === "delete") {
      const ok = await confirm({
        tone: "danger",
        title: `Delete ${n} message${n === 1 ? "" : "s"}?`,
        description: "Deleted messages and their attachments are removed from storage.",
        callout: "This cannot be undone. Archive instead if you may need them later.",
        confirmLabel: `Delete ${n}`,
        busyLabel: "Deleting…",
        icon: Trash,
        onConfirm: run
      });
      if (!ok) return;
      feedback.success(`${n} message${n === 1 ? "" : "s"} deleted`);
    } else {
      const result = await feedback.run({ title: "Updating messages", success: `${n} message${n === 1 ? "" : "s"} ${labels[action]}` }, run);
      if (result === undefined) return;
    }
    setSelected([]);
    await list.reload();
  };
  const star = async (email: EmailItem) => {
    const current = optimisticStars[email.id] ?? email.is_starred ?? 0;
    const next = current ? 0 : 1;
    setOptimisticStars((prev) => ({ ...prev, [email.id]: next }));
    try {
      await api(`/api/emails/${email.id}/star`, { method: "PATCH", body: JSON.stringify({ starred: !!next }) });
    } catch (err) {
      // F5: never coerce a failure into success — roll back and say so.
      setOptimisticStars((prev) => ({ ...prev, [email.id]: current }));
      feedback.error("Couldn't update star", errorMessage(err));
    }
  };
  const title = compactTitle || (starredOnly ? "Starred" : direction === "outbound" ? "Sent" : "Inbox");
  return (
    <div className="stack">
      <div className="section-head">
        <div>
          <h2>{title}</h2>
          <p>{list.data ? `${list.data.length} message${list.data.length === 1 ? "" : "s"}${list.data.length >= 100 ? " (showing latest 100)" : ""}` : " "}</p>
        </div>
        <button onClick={() => void list.reload()} disabled={list.loading}><RefreshCw size={15} className={list.loading && list.data ? "spin" : ""} />Refresh</button>
      </div>
      <div className="panel toolbar">
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search subject, sender, recipient, or body" aria-label="Search messages" />
        <select value={read} onChange={(e) => setRead(e.target.value)} aria-label="Read state">
          <option value="">All</option>
          <option value="unread">Unread</option>
          <option value="read">Read</option>
        </select>
        <select value={folder} onChange={(e) => setFolder(e.target.value)} aria-label="Folder">
          <option value="">Mail</option>
          <option value="archive">Archive</option>
          <option value="trash">Trash</option>
        </select>
        <label className="check-filter"><input type="checkbox" checked={hasAttachment} onChange={(e) => setHasAttachment(e.target.checked)} />Has attachments</label>
      </div>
      {!!selected.length && (
        <div className="action-bar" role="toolbar" aria-label="Bulk actions">
          <strong>{selected.length} selected</strong>
          <button className="small-button" onClick={() => void bulk("mark_read")}><MailOpen size={15} />Mark read</button>
          <button className="small-button" onClick={() => void bulk("mark_unread")}><Mail size={15} />Mark unread</button>
          <button className="small-button" onClick={() => void bulk("archive")}><Archive size={15} />Archive</button>
          <button className="small-button danger" onClick={() => void bulk("delete")}><Trash size={15} />Delete</button>
          <button className="icon-button sm" aria-label="Clear selection" onClick={() => setSelected([])}><X size={15} /></button>
        </div>
      )}
      <Loadable state={list} skeleton={<SkeletonMailList />} label="Loading mail">
        {(data) => !data.length ? (
          <div className="panel"><EmptyState icon={Inbox} title={query || read || folder || hasAttachment ? "No messages match these filters" : "No messages yet"} hint={!query && direction !== "outbound" ? "New mail appears here within seconds of delivery." : undefined} /></div>
        ) : (
          <div className="panel mail-list">
            <div className="mail-row" style={{ minHeight: 34 }}>
              <button className="icon-button sm" aria-label={allSelected ? "Deselect all" : "Select all"} onClick={() => setSelected(allSelected ? [] : data.map((e) => e.id))}>{allSelected ? <SquareCheck size={17} /> : <Square size={17} />}</button>
              <span />
              <span className="eyebrow" style={{ paddingLeft: 10 }}>{allSelected ? "All selected" : "Select all"}</span>
              <span />
            </div>
            {data.map((email) => {
              const starred = !!(optimisticStars[email.id] ?? email.is_starred);
              const isSelected = selected.includes(email.id);
              return (
                <div className={`mail-row ${email.is_read ? "" : "unread"} ${isSelected ? "selected" : ""}`} key={email.id}>
                  <button className="icon-button sm" aria-label={isSelected ? "Deselect message" : "Select message"} aria-pressed={isSelected} onClick={() => toggle(email.id)}>{isSelected ? <SquareCheck size={17} /> : <Square size={17} />}</button>
                  <button className={`icon-button sm star-button ${starred ? "active" : ""}`} aria-label={starred ? "Remove star" : "Add star"} aria-pressed={starred} onClick={() => void star(email)}><Star size={17} /></button>
                  <button className="mail-copy" onClick={() => setRoute(`email:${email.id}`)}>
                    <div><strong>{email.direction === "inbound" ? email.from_addr : `To: ${email.to_addr}`}</strong><span title={formatDate(email.created_at)}>{formatRelative(email.created_at)}</span></div>
                    <p>{email.subject || "(no subject)"}</p>
                    {email.error && <small>{email.error}</small>}
                  </button>
                  <div className="mail-meta">
                    {email.attachment_count ? <Paperclip size={15} aria-label={`${email.attachment_count} attachments`} /> : null}
                    {!["received", "parsed", "succeeded", "sent"].includes(email.status) && <StatusPill value={email.status} />}
                    <ChevronRight size={16} />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Loadable>
    </div>
  );
}

/* ==========================================================================
   Message detail
   ========================================================================== */

export function EmailDetail({ id, returnRoute }: { id: string; returnRoute?: string }) {
  const email = useAsync<EmailItem>(() => api(`/api/emails/${id}`), [id], { keepStale: false });
  const back = () => (returnRoute ? setRoute(returnRoute) : history.back());
  return (
    <Loadable state={email} skeleton={<SkeletonDetail />} label="Opening message">
      {(data) => (
        <article className="panel email-detail">
          <header>
            <button onClick={back}><ArrowLeft size={16} />{returnRoute === "attachments" ? "Back to attachments" : "Back"}</button>
            <StatusPill value={data.status} />
          </header>
          <h2>{data.subject || "(no subject)"}</h2>
          <div className="meta-grid">
            <span>From</span><strong>{data.from_addr}</strong>
            <span>To</span><strong>{data.to_addr}</strong>
            <span>Date</span><strong>{formatDate(data.created_at)}</strong>
          </div>
          {data.error && <ErrorPanel message={data.error} />}
          {data.text_body && <pre className="body-text">{data.text_body}</pre>}
          {data.html_body && <iframe className="html-frame" sandbox="" srcDoc={data.html_body} title="HTML message body" />}
          {!data.text_body && !data.html_body && <EmptyState icon={FileText} title="This message has no body" />}
          {!!data.attachments?.length && (
            <div className="stack compact-stack">
              <span className="eyebrow">{data.attachments.length} attachment{data.attachments.length === 1 ? "" : "s"}</span>
              <div className="attachment-strip">{data.attachments.map((att) => <AttachmentChip key={att.id} att={att} />)}</div>
            </div>
          )}
        </article>
      )}
    </Loadable>
  );
}

/* ==========================================================================
   Drafts
   ========================================================================== */

export function DraftHistory({ draftId }: { draftId: string }) {
  const history = useAsync<any[]>(() => api(`/api/drafts/${draftId}/history`), [draftId], { keepStale: false });
  return (
    <div className="stack">
      <div className="section-head">
        <h2>Draft history</h2>
        <button onClick={() => setRoute(`compose:${draftId}`)}><ArrowLeft size={16} />Back to draft</button>
      </div>
      <Loadable state={history} skeleton={<SkeletonTable rows={3} cols={2} />} label="Loading draft history">
        {(data) => !data.length ? <div className="panel"><EmptyState icon={FileClock} title="No previous versions" hint="Versions are kept as the draft autosaves." /></div> : (
          <div className="stack">
            {data.map((v) => (
              <article className="panel stack compact-stack" key={v.id}>
                <div className="section-head"><strong>{v.subject || "(no subject)"}</strong><span className="muted text-meta">{formatDate(v.created_at)}</span></div>
                <pre className="body-text">{v.text_body}</pre>
              </article>
            ))}
          </div>
        )}
      </Loadable>
    </div>
  );
}

export function Drafts() {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const drafts = useAsync<Draft[]>(() => api(`/api/drafts?q=${encodeURIComponent(query)}`), [query]);
  const { confirm } = useConfirm();
  const feedback = useFeedback();
  const create = async () => {
    const draft = await feedback.run({ title: "Creating draft", quietSuccess: true }, () => api<{ id: string }>("/api/drafts", { method: "POST", body: JSON.stringify({}) }));
    if (draft) setRoute(`compose:${draft.id}`);
  };
  const remove = async (draft: Draft) => {
    const ok = await confirm({
      tone: "danger",
      title: "Delete this draft?",
      target: draft.subject || "(no subject)",
      callout: "The draft, its history and its uploaded attachments will be removed.",
      confirmLabel: "Delete draft",
      busyLabel: "Deleting…",
      icon: Trash,
      onConfirm: () => api(`/api/drafts/${draft.id}`, { method: "DELETE" })
    });
    if (!ok) return;
    feedback.success("Draft deleted");
    setSelected((s) => s.filter((x) => x !== draft.id));
    void drafts.reload();
  };
  const toggle = (id: string) => setSelected((prev) => (prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]));
  const bulkRemove = async () => {
    const n = selected.length;
    if (!n) return;
    const ok = await confirm({
      tone: "danger",
      title: `Delete ${n} draft${n === 1 ? "" : "s"}?`,
      callout: "Selected drafts, their history and uploaded attachments will be removed. This cannot be undone.",
      confirmLabel: `Delete ${n}`,
      busyLabel: "Deleting…",
      icon: Trash,
      onConfirm: () => api("/api/drafts", { method: "DELETE", body: JSON.stringify({ ids: selected }) })
    });
    if (!ok) return;
    feedback.success(`${n} draft${n === 1 ? "" : "s"} deleted`);
    setSelected([]);
    void drafts.reload();
  };
  return (
    <div className="stack">
      <div className="section-head">
        <div>
          <h2>Drafts</h2>
          <p>Drafts are deleted automatically after your retention period.</p>
        </div>
        <button className="primary" onClick={() => void create()}><Plus size={16} />New draft</button>
      </div>
      <div className="panel toolbar">
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search subject or recipient" aria-label="Search drafts" />
        {!!selected.length && <button className="danger" onClick={() => void bulkRemove()}><Trash size={15} />Delete {selected.length} selected</button>}
      </div>
      <Loadable state={drafts} skeleton={<SkeletonTable rows={5} cols={3} />} label="Loading drafts">
        {(data) => !data.length ? <div className="panel"><EmptyState icon={FilePen} title={query ? "No matching drafts" : "No drafts"} action={!query ? <button className="small-button" onClick={() => void create()}><SquarePen size={15} />Start writing</button> : undefined} /></div> : (
          <div className="panel table">
            {data.map((draft) => (
              <div className="table-row" key={draft.id}>
                <button className="icon-button sm" aria-label={selected.includes(draft.id) ? "Deselect draft" : "Select draft"} onClick={() => toggle(draft.id)}>{selected.includes(draft.id) ? <SquareCheck size={17} /> : <Square size={17} />}</button>
                <button className="link-row" onClick={() => setRoute(`compose:${draft.id}`)}>
                  <strong>{draft.subject || "(no subject)"}</strong>
                  <span>{draft.to_addr || "No recipient"}</span>
                  <span title={formatDate(draft.updated_at)}>{formatRelative(draft.updated_at)}</span>
                </button>
                <button className="icon-button sm danger" aria-label="Delete draft" title="Delete draft" onClick={() => void remove(draft)}><Trash size={16} /></button>
              </div>
            ))}
          </div>
        )}
      </Loadable>
    </div>
  );
}

/* ==========================================================================
   Compose
   ========================================================================== */

export function Compose({ draftId }: { draftId?: string }) {
  const [mailboxes, setMailboxes] = useState<Mailbox[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [loadError, setLoadError] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [savedPulse, setSavedPulse] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [dragging, setDragging] = useState(false);
  const [preview, setPreview] = useState(false);
  const [wideEditor, setWideEditor] = useState(false);
  const [sending, setSending] = useState(false);
  const textRef = useRef<HTMLTextAreaElement | null>(null);
  const dirty = useRef(false);
  const { confirm } = useConfirm();
  const feedback = useFeedback();

  useEffect(() => {
    api<Mailbox[]>("/api/mailboxes").then(setMailboxes).catch((err) => feedback.error("Couldn't load mailboxes", errorMessage(err)));
    const load = async () => {
      if (draftId) {
        setDraft(await api<Draft>(`/api/drafts/${draftId}`));
      } else {
        const created = await api<{ id: string }>("/api/drafts", { method: "POST", body: JSON.stringify({}) });
        window.history.replaceState(null, "", `#compose:${created.id}`);
        window.dispatchEvent(new HashChangeEvent("hashchange"));
      }
    };
    void load().catch((err) => setLoadError(errorMessage(err)));
  }, [draftId]);

  // Autosave 2s after the last edit. Failures stay visible next to the save state (F5).
  useEffect(() => {
    if (!draft?.id || !dirty.current) return;
    const timer = window.setTimeout(() => {
      setSaving(true);
      api(`/api/drafts/${draft.id}`, { method: "PATCH", body: JSON.stringify(draft) })
        .then(() => {
          setSaveError("");
          setSavedPulse(true);
          window.setTimeout(() => setSavedPulse(false), 1400);
        })
        .catch((err) => setSaveError(errorMessage(err, "Autosave failed")))
        .finally(() => setSaving(false));
    }, 2000);
    return () => window.clearTimeout(timer);
  }, [draft?.mailbox_id, draft?.to_addr, draft?.cc, draft?.bcc, draft?.subject, draft?.text_body, draft?.html_body]);

  const update = (patch: Partial<Draft>) => {
    dirty.current = true;
    setDraft((d) => (d ? { ...d, ...patch } : d));
  };
  const upload = async (file: File) => {
    if (!draft?.id) return;
    const form = new FormData();
    form.append("draft_id", draft.id);
    form.append("file", file);
    const att = await feedback.run(
      { title: `Uploading ${file.name}`, detail: formatBytes(file.size), success: "Attachment added", successDetail: file.name, activityDelay: 150 },
      (activity) => uploadForm<Attachment>("/api/attachments/upload", form, (p) => activity.update({ progress: p }))
    );
    if (att) setDraft((d) => (d ? { ...d, attachments: [...(d.attachments || []), att] } : d));
  };
  const removeAttachment = async (att: Attachment) => {
    const ok = await confirm({
      tone: "danger",
      title: "Remove this attachment?",
      target: att.filename,
      callout: "The uploaded file will be deleted from storage.",
      confirmLabel: "Remove",
      busyLabel: "Removing…",
      icon: Paperclip,
      onConfirm: () => api(`/api/attachments/${att.id}`, { method: "DELETE" })
    });
    if (!ok) return;
    setDraft((d) => (d ? { ...d, attachments: (d.attachments || []).filter((a) => a.id !== att.id) } : d));
    feedback.success("Attachment removed", att.filename);
  };
  const validate = () => {
    const errors: Record<string, string> = {};
    const emailRe = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;
    const toList = (draft?.to_addr || "").split(/[,\n;]/).map((x) => x.trim()).filter(Boolean);
    if (!toList.length) errors.to_addr = "Enter at least one recipient";
    const bad = toList.find((addr) => !emailRe.test(addr));
    if (bad) errors.to_addr = `Invalid address: ${bad}`;
    if (!draft?.mailbox_id) errors.mailbox_id = "Choose a sender mailbox";
    setFieldErrors(errors);
    return !errors.to_addr && !errors.mailbox_id;
  };
  const sendMail = async () => {
    if (!draft || !validate()) return;
    const recipients = (draft.to_addr || "").split(/[,\n;]/).map((x) => x.trim()).filter(Boolean);
    const sender = mailboxes.find((m) => m.id === draft.mailbox_id)?.email || "selected mailbox";
    const ok = await confirm({
      title: draft.subject?.trim() ? "Send this message?" : "Send without a subject?",
      description: `From ${sender} to ${recipients.length} recipient${recipients.length === 1 ? "" : "s"}${draft.attachments?.length ? ` with ${draft.attachments.length} attachment${draft.attachments.length === 1 ? "" : "s"}` : ""}.`,
      target: recipients.join(", "),
      callout: draft.subject?.trim() ? undefined : "Messages without a subject are more likely to be filtered as spam.",
      confirmLabel: "Send now",
      icon: Send
    });
    if (!ok) return;
    setSending(true);
    // Persist the latest edits before queueing, so the server sends exactly what is on screen.
    const sent = await feedback.run(
      { title: "Sending message", detail: `To ${recipients[0]}${recipients.length > 1 ? ` +${recipients.length - 1}` : ""}`, success: "Message queued for delivery", successDetail: draft.subject || "(no subject)" },
      async () => {
        await api(`/api/drafts/${draft.id}`, { method: "PATCH", body: JSON.stringify(draft) });
        return api<{ id: string }>("/api/emails/send", { method: "POST", body: JSON.stringify({ draft_id: draft.id, mailbox_id: draft.mailbox_id, attachment_ids: draft.attachments?.map((a) => a.id) || [] }) });
      }
    );
    setSending(false);
    if (sent) setRoute("sent");
  };
  const insertAgentOutput = async (text: string, mode: "append" | "replace" | "selection") => {
    const current = draft?.text_body || "";
    if (mode === "replace") {
      if (current.trim()) {
        const ok = await confirm({ title: "Replace the whole body?", description: "Your current text will be overwritten by the AI output. Previous versions remain in draft history.", confirmLabel: "Replace body", icon: Replace });
        if (!ok) return;
      }
      update({ text_body: text });
    } else if (mode === "selection" && textRef.current) {
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
    window.setTimeout(() => {
      textRef.current?.focus();
      textRef.current?.setSelectionRange(start + before.length, start + before.length + picked.length);
    }, 0);
  };

  if (loadError) return <ErrorPanel message={loadError} onRetry={() => window.location.reload()} />;
  return (
    <SkeletonSwap ready={!!draft} skeleton={<SkeletonComposer />} label="Preparing draft">
      {draft && (
        <div className={`compose-layout ${wideEditor ? "wide" : ""}`}>
          <section
            className={`panel composer ${dragging ? "dragging" : ""}`}
            onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
            onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragging(false); }}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              Array.from(e.dataTransfer.files).forEach((file) => void upload(file));
            }}
          >
            <div className="compose-head">
              <select value={draft.mailbox_id || ""} onChange={(e) => { update({ mailbox_id: e.target.value }); setFieldErrors((f) => ({ ...f, mailbox_id: "" })); }} aria-label="Sender mailbox" aria-invalid={!!fieldErrors.mailbox_id}>
                <option value="">Select a sender mailbox</option>
                {mailboxes.filter((m) => ["active", "send_only"].includes(m.status)).map((m) => <option value={m.id} key={m.id}>{m.email}{m.alias ? ` · ${m.alias}` : ""}</option>)}
              </select>
              <span className={`save-state ${saving ? "saving" : ""} ${savedPulse ? "save-pulse" : ""}`} role="status" style={saveError ? { color: "var(--text-error)" } : undefined}>
                <i style={saveError ? { background: "var(--destructive)", boxShadow: "none" } : undefined} />
                {saving ? "Saving…" : saveError ? "Not saved" : "Draft saved"}
              </span>
              <button onClick={() => setRoute(`compose:${draft.id}:history`)}><FileClock size={15} />History</button>
              <button className="primary" onClick={() => void sendMail()} disabled={sending}><Send size={16} />{sending ? "Sending…" : "Send"}</button>
            </div>
            {fieldErrors.mailbox_id && <small className="field-error">{fieldErrors.mailbox_id}</small>}
            {saveError && <ErrorPanel message={`Autosave failed: ${saveError}`} />}
            <input value={draft.to_addr || ""} onChange={(e) => { update({ to_addr: e.target.value }); setFieldErrors((f) => ({ ...f, to_addr: "" })); }} placeholder="To — separate multiple addresses with commas" aria-label="To" aria-invalid={!!fieldErrors.to_addr} />
            {fieldErrors.to_addr && <small className="field-error">{fieldErrors.to_addr}</small>}
            <div className="split">
              <input value={draft.cc || ""} onChange={(e) => update({ cc: e.target.value })} placeholder="Cc" aria-label="Cc" />
              <input value={draft.bcc || ""} onChange={(e) => update({ bcc: e.target.value })} placeholder="Bcc" aria-label="Bcc" />
            </div>
            <input className="subject" value={draft.subject || ""} onChange={(e) => update({ subject: e.target.value })} placeholder="Subject" aria-label="Subject" />
            <div className="editor-toolbar" role="toolbar" aria-label="Formatting">
              <button title="Bold" aria-label="Bold" onClick={() => wrapSelection("**")}><Bold size={15} /></button>
              <button title="Italic" aria-label="Italic" onClick={() => wrapSelection("*")}><Italic size={15} /></button>
              <button title="Underline" aria-label="Underline" onClick={() => wrapSelection("<u>", "</u>")}><Underline size={15} /></button>
              <span className="sep" />
              <button title="Bulleted list" aria-label="Bulleted list" onClick={() => wrapSelection("- ", "", "List item")}><List size={15} /></button>
              <button title="Insert link" aria-label="Insert link" onClick={() => wrapSelection("[", "](https://)", "Link text")}><Link size={15} /></button>
              <button title="Inline code" aria-label="Inline code" onClick={() => wrapSelection("`")}><Code size={15} /></button>
              <span className="sep" />
              <button title={preview ? "Back to editing" : "Preview"} aria-label="Preview" aria-pressed={preview} className={preview ? "active" : ""} onClick={() => setPreview((v) => !v)}>{preview ? <Pencil size={15} /> : <Eye size={15} />}</button>
              <button title={wideEditor ? "Show AI panel" : "Focus mode — hide AI panel"} aria-label="Focus mode" aria-pressed={wideEditor} className={wideEditor ? "active" : ""} onClick={() => setWideEditor((v) => !v)}>{wideEditor ? <Minimize2 size={15} /> : <Maximize2 size={15} />}</button>
            </div>
            {preview ? <pre className="body-text editor-preview">{draft.text_body || "No body text"}</pre> : <textarea ref={textRef} value={draft.text_body || ""} onChange={(e) => update({ text_body: e.target.value })} placeholder="Write your message…" aria-label="Message body" />}
            <div className="attachment-strip">
              {(draft.attachments || []).map((att) => <AttachmentCard key={att.id} att={att} onRemove={() => void removeAttachment(att)} />)}
              <label className="upload-button">
                <Upload size={16} />
                Upload or drop attachments
                <input type="file" multiple onChange={(e) => { Array.from(e.target.files || []).forEach((f) => void upload(f)); e.target.value = ""; }} />
              </label>
            </div>
          </section>
          <AgentPanel draft={draft} onInsert={(text, mode) => void insertAgentOutput(text, mode)} />
        </div>
      )}
    </SkeletonSwap>
  );
}

const AGENT_COMMANDS = [
  ["generate_email", "Generate email"],
  ["draft_reply", "Draft reply"],
  ["reply_email", "Reply to email"],
  ["polish", "Polish"],
  ["rewrite_tone", "Rewrite tone"],
  ["translate_en", "Translate to English"],
  ["summarize", "Summarize received email"],
  ["subject", "Generate subject"],
  ["reply_suggestions", "Suggest replies"]
] as const;

function AgentPanel({ draft, onInsert }: { draft: Draft; onInsert: (text: string, mode: "append" | "replace" | "selection") => void }) {
  const [command, setCommand] = useState("generate_email");
  const [input, setInput] = useState("");
  const [job, setJob] = useState<AgentJob | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const feedback = useFeedback();
  const running = !!job && ["pending", "processing", "retrying"].includes(job.status);
  useEffect(() => {
    if (!job?.id || !running) return;
    const timer = window.setInterval(async () => {
      try {
        const next = await api<AgentJob>(`/api/agent/jobs/${job.id}`);
        setJob(next);
        if (next.status === "succeeded") feedback.success("AI draft ready", next.actual_tokens ? `${next.actual_tokens} tokens used` : undefined);
        if (next.status === "failed") feedback.error("AI generation failed", next.error);
      } catch (err) {
        setError(errorMessage(err));
      }
    }, 1800);
    return () => window.clearInterval(timer);
  }, [job?.id, job?.status]);
  const generate = async () => {
    setBusy(true);
    setError("");
    try {
      setJob(await api<AgentJob>("/api/agent/generate", { method: "POST", body: JSON.stringify({ draft_id: draft.id, command, input: `${input}\n\nCurrent draft:\n${draft.text_body || ""}` }) }));
    } catch (err) {
      setError(errorMessage(err, "Agent request failed"));
    } finally {
      setBusy(false);
    }
  };
  const retry = async () => {
    if (!job) return;
    try {
      setJob(await api<AgentJob>(`/api/agent/jobs/${job.id}/retry`, { method: "POST" }));
    } catch (err) {
      setError(errorMessage(err));
    }
  };
  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      feedback.success("Copied to clipboard");
    } catch {
      feedback.error("Copy failed", "Your browser blocked clipboard access.");
    }
  };
  return (
    <aside className="panel agent">
      <div className="section-head">
        <h2><Bot size={18} />AI assistant</h2>
        <button className="primary small-button" disabled={busy || running} onClick={() => void generate()}>{busy || running ? <span className="ring-spinner" style={{ width: 14, height: 14, borderTopColor: "currentColor" }} /> : <Sparkles size={15} />}{running ? "Generating…" : "Generate"}</button>
      </div>
      <select value={command} onChange={(e) => setCommand(e.target.value)} aria-label="AI command">
        {AGENT_COMMANDS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </select>
      <textarea value={input} onChange={(e) => setInput(e.target.value)} placeholder="Describe what you want, or paste context…" aria-label="AI instructions" />
      {error && <ErrorPanel message={error} />}
      {job && (
        <div className="agent-result">
          <div className="section-head"><StatusPill value={job.status} />{job.actual_tokens ? <span className="muted text-meta mono">{job.actual_tokens} tokens</span> : null}</div>
          {running && <div className="candidate"><span>Working</span><div className="progress-track indeterminate"><b /></div></div>}
          {job.error && <ErrorPanel message={job.error} onRetry={job.status === "failed" ? () => void retry() : undefined} />}
          {job.output && (
            <div className="candidate-list">
              {job.output.split(/\n{2,}/).filter(Boolean).map((part, idx) => (
                <article className="candidate" key={idx} style={{ animationDelay: `${idx * 50}ms` }}>
                  <span>Candidate {idx + 1}</span>
                  <p>{part}</p>
                  <div className="button-row">
                    <button onClick={() => onInsert(part, "append")}><Plus size={14} />Insert</button>
                    <button onClick={() => onInsert(part, "selection")}><TextCursorInput size={14} />Replace selection</button>
                  </div>
                </article>
              ))}
            </div>
          )}
          {job.output && (
            <div className="button-row">
              <button className="small-button" onClick={() => onInsert(job.output || "", "append")}><Plus size={14} />Insert all</button>
              <button className="small-button" onClick={() => onInsert(job.output || "", "replace")}><Replace size={14} />Replace body</button>
              <button className="small-button" onClick={() => void copy(job.output || "")}><Copy size={14} />Copy</button>
            </div>
          )}
          {job.status === "failed" && !job.error && <button onClick={() => void retry()}><RotateCcw size={15} />Retry</button>}
        </div>
      )}
    </aside>
  );
}

/* ==========================================================================
   Attachments
   ========================================================================== */

function AttachmentIcon({ type, size = 17 }: { type?: string; size?: number }) {
  if (type === "image") return <FileImage size={size} />;
  if (type === "pdf" || type === "document") return <FileText size={size} />;
  if (type === "archive") return <FileArchive size={size} />;
  return <File size={size} />;
}

function AttachmentPreview({ att }: { att: Attachment }) {
  if (att.file_type === "image") return <ImageAttachmentPreview att={att} />;
  return (
    <div className={`attachment-preview type-${att.file_type || "file"}`}>
      <AttachmentIcon type={att.file_type} size={30} />
      <strong>{(att.filename.split(".").pop() || att.file_type || "file").toUpperCase().slice(0, 6)}</strong>
    </div>
  );
}

function ImageAttachmentPreview({ att }: { att: Attachment }) {
  const [url, setUrl] = useState("");
  const [failed, setFailed] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    let active = true;
    let objectUrl = "";
    // Only fetch thumbnails that scroll into view.
    const io = new IntersectionObserver((entries) => {
      if (!entries.some((e) => e.isIntersecting)) return;
      io.disconnect();
      fetchBlob(`/api/attachments/${att.id}/download`)
        .then((blob) => {
          if (!active) return;
          objectUrl = URL.createObjectURL(blob);
          setUrl(objectUrl);
        })
        .catch(() => active && setFailed(true));
    }, { rootMargin: "200px" });
    if (ref.current) io.observe(ref.current);
    return () => {
      active = false;
      io.disconnect();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [att.id]);
  return (
    <div className="attachment-preview image-preview" ref={ref}>
      {url ? <img src={url} alt={att.filename} /> : failed ? <Image size={30} /> : <span className="sk" style={{ position: "absolute", inset: 0, borderRadius: 0 }} />}
    </div>
  );
}

function AttachmentCard({ att, onRemove }: { att: Attachment; onRemove?: () => void }) {
  return (
    <div className="attachment-card">
      <AttachmentIcon type={att.file_type} />
      <div>
        <strong title={att.filename}>{att.filename}</strong>
        <small>{formatBytes(att.size_bytes)} · {att.content_type || att.file_type || "file"}</small>
      </div>
      <AttachmentChip att={att} />
      {onRemove && <button className="icon-button sm danger" aria-label={`Remove ${att.filename}`} onClick={onRemove}><X size={15} /></button>}
    </div>
  );
}

export function AttachmentChip({ att }: { att: Attachment }) {
  const feedback = useFeedback();
  const download = () =>
    feedback.run(
      { title: `Downloading ${att.filename}`, detail: formatBytes(att.size_bytes), success: "Download complete", successDetail: att.filename, activityDelay: 250 },
      async (activity) => saveBlob(await fetchBlob(`/api/attachments/${att.id}/download`, (p) => activity.update({ progress: p })), att.filename)
    );
  return (
    <button className="attachment" onClick={() => void download()} title={`Download ${att.filename}`}>
      <Download size={15} />
      <span>{att.filename}</span>
      <small>{formatBytes(att.size_bytes)}</small>
    </button>
  );
}

export function AttachmentsPage({ user }: { user: User }) {
  const [query, setQuery] = useState("");
  const [type, setType] = useState("");
  const [sort, setSort] = useState("created_desc");
  const list = useAsync<Attachment[]>(() => api(`/api/attachments?q=${encodeURIComponent(query)}&type=${type}&sort=${sort}`), [query, type, sort]);
  const { confirm } = useConfirm();
  const feedback = useFeedback();
  const cleanup = async () => {
    let removed: any = null;
    const ok = await confirm({
      tone: "danger",
      title: "Clean up attachments?",
      description: "Removes attachments older than 30 days and files no longer linked to a message or draft, for all users.",
      callout: "Removed files cannot be recovered.",
      confirmLabel: "Clean up",
      busyLabel: "Cleaning up…",
      icon: BrushCleaning,
      onConfirm: async () => { removed = await api("/api/attachments/cleanup", { method: "POST", body: JSON.stringify({ retention_days: 30 }) }); }
    });
    if (!ok) return;
    const count = removed?.deleted ?? removed?.count;
    feedback.success("Cleanup complete", typeof count === "number" ? `${count} file${count === 1 ? "" : "s"} removed` : undefined);
    void list.reload();
  };
  return (
    <div className="stack">
      <div className="section-head">
        <div>
          <h2>Attachments</h2>
          <p>{list.data ? `${list.data.length} file${list.data.length === 1 ? "" : "s"} · ${formatBytes(list.data.reduce((s, a) => s + (a.size_bytes || 0), 0))}` : " "}</p>
        </div>
        {user.role === "admin" && <button onClick={() => void cleanup()}><BrushCleaning size={16} />Clean up</button>}
      </div>
      <div className="panel toolbar">
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search filenames" aria-label="Search attachments" />
        <select value={type} onChange={(e) => setType(e.target.value)} aria-label="File type">
          <option value="">All types</option>
          <option value="image">Images</option>
          <option value="pdf">PDF</option>
          <option value="document">Documents</option>
          <option value="archive">Archives</option>
        </select>
        <select value={sort} onChange={(e) => setSort(e.target.value)} aria-label="Sort">
          <option value="created_desc">Newest uploads</option>
          <option value="created_asc">Oldest uploads</option>
          <option value="name">Filename</option>
          <option value="size">Size</option>
        </select>
      </div>
      <Loadable state={list} skeleton={<SkeletonAttachmentGrid />} label="Loading attachments">
        {(data) => !data.length ? <div className="panel"><EmptyState icon={Paperclip} title={query || type ? "No matching attachments" : "No attachments yet"} /></div> : (
          <div className="attachment-grid">{data.map((att) => <AttachmentTile key={att.id} att={att} />)}</div>
        )}
      </Loadable>
    </div>
  );
}

function AttachmentTile({ att }: { att: Attachment }) {
  const openTarget = () => {
    if (att.email_id) setRoute(`email:${att.email_id}:attachments`);
    else if (att.draft_id) setRoute(`compose:${att.draft_id}`);
  };
  return (
    <article className="panel attachment-tile">
      <AttachmentPreview att={att} />
      <div className="attachment-tile-body">
        <strong title={att.filename}>{att.filename}</strong>
        <span>{formatBytes(att.size_bytes)} · {att.content_type || att.file_type || "file"}</span>
        <small title={att.email_subject || att.draft_subject}>{att.email_subject || att.draft_subject || "No linked subject"} · {formatRelative(att.created_at)}</small>
      </div>
      <div className="attachment-tile-actions">
        <AttachmentChip att={att} />
        {(att.email_id || att.draft_id) && <button onClick={openTarget}>{att.email_id ? <MailOpen size={15} /> : <SquarePen size={15} />}Open</button>}
      </div>
    </article>
  );
}
