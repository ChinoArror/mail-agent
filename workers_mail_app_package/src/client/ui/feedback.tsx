import React, { createContext, useCallback, useContext, useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CircleAlert, CircleCheck, Info, TriangleAlert, X } from "lucide-react";

/* ==========================================================================
   SnowLuma feedback conventions
   F1  destructive actions + second confirmations live in a floating modal
   F2  long operations show a bottom-right live activity
   F3  results show a bottom-right notice that auto-closes after 5s with a
       visible linear countdown bar
   F5  failures stay visible in the control (modal) *and* in the result
   ========================================================================== */

type Tone = "success" | "error" | "info";

export interface NoticeInput {
  tone?: Tone;
  title: string;
  detail?: string;
  duration?: number;
  action?: { label: string; onClick: () => void };
}

interface Notice extends Required<Pick<NoticeInput, "title">> {
  id: number;
  tone: Tone;
  detail?: string;
  duration: number;
  action?: NoticeInput["action"];
  leaving?: boolean;
}

interface Activity {
  id: number;
  title: string;
  detail?: string;
  progress: number | null;
  expanded: boolean;
}

export interface ActivityHandle {
  update: (patch: { progress?: number | null; detail?: string; title?: string }) => void;
}

export interface RunOptions<T> {
  title: string;
  detail?: string;
  success?: string | ((result: T) => string);
  successDetail?: string | ((result: T) => string | undefined);
  error?: string;
  /** Show the live activity only if the task is still running after this delay (avoids flashes). */
  activityDelay?: number;
  /** Suppress the success notice (F4: high-frequency edits never emit a notice). */
  quietSuccess?: boolean;
  rethrow?: boolean;
}

interface FeedbackApi {
  notify: (notice: NoticeInput) => void;
  success: (title: string, detail?: string) => void;
  error: (title: string, detail?: string) => void;
  run: <T>(options: RunOptions<T>, task: (activity: ActivityHandle) => Promise<T>) => Promise<T | undefined>;
}

const FeedbackContext = createContext<FeedbackApi | null>(null);

export const errorMessage = (err: unknown, fallback = "Something went wrong") => (err instanceof Error ? err.message : typeof err === "string" ? err : fallback);

const NOTICE_MS = 5000;
const PEEK_MS = 2600;

export function FeedbackProvider({ children }: { children: React.ReactNode }) {
  const [notices, setNotices] = useState<Notice[]>([]);
  const [activities, setActivities] = useState<Activity[]>([]);
  const seq = useRef(0);
  const timers = useRef(new Map<number, number>());

  const dismiss = useCallback((id: number) => {
    setNotices((list) => list.map((n) => (n.id === id ? { ...n, leaving: true } : n)));
    window.setTimeout(() => setNotices((list) => list.filter((n) => n.id !== id)), 180);
    const t = timers.current.get(id);
    if (t) window.clearTimeout(t);
    timers.current.delete(id);
  }, []);

  const notify = useCallback((input: NoticeInput) => {
    const id = ++seq.current;
    const notice: Notice = { id, tone: input.tone || "info", title: input.title, detail: input.detail, duration: input.duration ?? NOTICE_MS, action: input.action };
    setNotices((list) => [...list.slice(-3), notice]);
  }, []);

  const api = useMemo<FeedbackApi>(() => ({
    notify,
    success: (title, detail) => notify({ tone: "success", title, detail }),
    error: (title, detail) => notify({ tone: "error", title, detail }),
    run: async <T,>(options: RunOptions<T>, task: (activity: ActivityHandle) => Promise<T>) => {
      const id = ++seq.current;
      let shown = false;
      let pending: Partial<Activity> = {};
      const show = () => {
        shown = true;
        setActivities((list) => [...list, { id, title: options.title, detail: options.detail, progress: null, expanded: true, ...pending }]);
        window.setTimeout(() => setActivities((list) => list.map((a) => (a.id === id ? { ...a, expanded: false } : a))), PEEK_MS);
      };
      const delay = window.setTimeout(show, options.activityDelay ?? 350);
      const handle: ActivityHandle = {
        update: (patch) => {
          pending = { ...pending, ...patch };
          if (shown) setActivities((list) => list.map((a) => (a.id === id ? { ...a, ...patch } : a)));
        }
      };
      const finish = () => {
        window.clearTimeout(delay);
        if (shown) setActivities((list) => list.filter((a) => a.id !== id));
      };
      try {
        const result = await task(handle);
        finish();
        if (!options.quietSuccess) {
          const title = typeof options.success === "function" ? options.success(result) : options.success || `${options.title} — done`;
          const detail = typeof options.successDetail === "function" ? options.successDetail(result) : options.successDetail;
          notify({ tone: "success", title, detail });
        }
        return result;
      } catch (err) {
        finish();
        notify({ tone: "error", title: options.error || `${options.title} failed`, detail: errorMessage(err) });
        if (options.rethrow) throw err;
        return undefined;
      }
    }
  }), [notify]);

  return (
    <FeedbackContext.Provider value={api}>
      {children}
      <div className="feedback-viewport" aria-live="polite">
        {activities.map((a) => <ActivityView key={a.id} activity={a} onToggle={(expanded) => setActivities((list) => list.map((x) => (x.id === a.id ? { ...x, expanded } : x)))} />)}
        {notices.map((n) => <NoticeView key={n.id} notice={n} onDismiss={() => dismiss(n.id)} />)}
      </div>
    </FeedbackContext.Provider>
  );
}

function NoticeView({ notice, onDismiss }: { notice: Notice; onDismiss: () => void }) {
  const Glyph = notice.tone === "success" ? CircleCheck : notice.tone === "error" ? CircleAlert : Info;
  return (
    <div
      className={`notice ${notice.tone} ${notice.leaving ? "leaving" : ""}`}
      role={notice.tone === "error" ? "alert" : "status"}
      style={{ ["--duration" as string]: `${notice.duration}ms` }}
    >
      <span className="glyph"><Glyph size={15} /></span>
      <strong>{notice.title}</strong>
      <button className="icon-button" aria-label="Dismiss notification" onClick={onDismiss}><X size={14} /></button>
      {notice.detail && <p>{notice.detail}</p>}
      {notice.action && <button className="notice-action" onClick={() => { notice.action?.onClick(); onDismiss(); }}>{notice.action.label}</button>}
      {/* The countdown bar *is* the timer: dismiss when its animation ends (pauses on hover). */}
      <span className="countdown" aria-hidden="true"><b onAnimationEnd={onDismiss} /></span>
    </div>
  );
}

function ActivityView({ activity, onToggle }: { activity: Activity; onToggle: (expanded: boolean) => void }) {
  const pct = activity.progress == null ? null : Math.round(Math.max(0, Math.min(1, activity.progress)) * 100);
  if (!activity.expanded) {
    return (
      <button className="activity-peek" onClick={() => onToggle(true)} aria-label={`${activity.title} in progress — show details`}>
        <span className="ring-spinner" />
        {pct != null && <span className="pct">{pct}%</span>}
        <span>{activity.title}</span>
      </button>
    );
  }
  return (
    <div className="activity-card" role="status">
      <div className="head">
        <span className="ring-spinner" />
        <strong>{activity.title}</strong>
        <button onClick={() => onToggle(false)}>Run in background</button>
      </div>
      {activity.detail && <div className="detail">{activity.detail}</div>}
      <div className="progress">
        <div className={`progress-track ${pct == null ? "indeterminate" : ""}`}><b style={{ width: `${pct ?? 0}%` }} /></div>
        <span className="pct">{pct == null ? "···" : `${pct}%`}</span>
      </div>
    </div>
  );
}

export function useFeedback() {
  const ctx = useContext(FeedbackContext);
  if (!ctx) throw new Error("useFeedback must be used inside FeedbackProvider");
  return ctx;
}

/* ---------- Modal ---------------------------------------------------------- */

/** Keeps a component mounted long enough to play its leave animation. */
export function usePresence(open: boolean, leaveMs = 170) {
  const [mounted, setMounted] = useState(open);
  const [leaving, setLeaving] = useState(false);
  useEffect(() => {
    if (open) {
      setMounted(true);
      setLeaving(false);
      return;
    }
    if (!mounted) return;
    setLeaving(true);
    const t = window.setTimeout(() => {
      setMounted(false);
      setLeaving(false);
    }, leaveMs);
    return () => window.clearTimeout(t);
  }, [open]);
  return { mounted, leaving };
}

/* ---------- Scroll lock ---------------------------------------------------- */
let scrollLocks = 0;
let savedScrollY = 0;

/**
 * Freezes the page underneath overlays (modals, mobile sidebar). Uses position:fixed on <body>
 * so iOS Safari can't rubber-band-scroll the page behind; restores the exact scroll position.
 * Reference-counted so nested overlays don't unlock each other.
 */
export function lockScroll() {
  if (scrollLocks++ > 0) return;
  savedScrollY = window.scrollY;
  const body = document.body;
  const gap = window.innerWidth - document.documentElement.clientWidth;
  body.style.position = "fixed";
  body.style.top = `-${savedScrollY}px`;
  body.style.left = "0";
  body.style.right = "0";
  body.style.overflow = "hidden";
  if (gap > 0) body.style.paddingRight = `${gap}px`;
  document.documentElement.classList.add("scroll-locked");
}

export function unlockScroll() {
  if (scrollLocks === 0 || --scrollLocks > 0) return;
  const body = document.body;
  body.style.position = "";
  body.style.top = "";
  body.style.left = "";
  body.style.right = "";
  body.style.overflow = "";
  body.style.paddingRight = "";
  document.documentElement.classList.remove("scroll-locked");
  window.scrollTo(0, savedScrollY);
}

export function useScrollLock(active: boolean) {
  useEffect(() => {
    if (!active) return;
    lockScroll();
    return unlockScroll;
  }, [active]);
}

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: React.ReactNode;
  description?: React.ReactNode;
  icon?: React.ElementType;
  tone?: "default" | "danger";
  size?: "small-modal" | "role-modal" | "crop-modal" | "";
  children?: React.ReactNode;
  footer?: React.ReactNode;
  /** While busy, Escape/backdrop do not close the modal. */
  busy?: boolean;
  initialFocus?: string;
}

export function Modal({ open, onClose, title, description, icon: Icon, tone = "default", size = "", children, footer, busy, initialFocus }: ModalProps) {
  const { mounted, leaving } = usePresence(open);
  const panelRef = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const descId = useId();
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const busyRef = useRef(busy);
  busyRef.current = busy;

  useEffect(() => {
    if (!mounted || leaving) return;
    const previous = document.activeElement as HTMLElement | null;
    lockScroll();
    const panel = panelRef.current;
    const focusTarget = (initialFocus && panel?.querySelector<HTMLElement>(initialFocus)) || panel?.querySelector<HTMLElement>("[data-autofocus]") || panel?.querySelector<HTMLElement>("input, textarea, select") || panel?.querySelector<HTMLElement>(".modal-footer button:last-child") || panel;
    window.setTimeout(() => focusTarget?.focus(), 30);
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busyRef.current) {
        event.stopPropagation();
        closeRef.current();
      }
      if (event.key === "Tab" && panel) {
        const focusable = Array.from(panel.querySelectorAll<HTMLElement>('button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])')).filter((el) => el.offsetParent !== null);
        if (!focusable.length) return;
        const firstEl = focusable[0];
        const lastEl = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === firstEl) {
          event.preventDefault();
          lastEl.focus();
        } else if (!event.shiftKey && document.activeElement === lastEl) {
          event.preventDefault();
          firstEl.focus();
        }
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      unlockScroll();
      previous?.focus?.({ preventScroll: true });
    };
  }, [mounted, leaving]);

  if (!mounted) return null;
  // Portal to <body>: ancestors with transforms/animations would otherwise trap `position: fixed`.
  return createPortal(
    <div className={`modal-backdrop ${leaving ? "leaving" : ""}`} onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}>
      <section ref={panelRef} className={`modal ${size}`} role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={description ? descId : undefined} tabIndex={-1}>
        <header className="modal-header">
          {Icon && <span className={`modal-icon ${tone === "danger" ? "danger" : ""}`}><Icon size={17} /></span>}
          <div className="titles">
            <h2 id={titleId}>{title}</h2>
            {description && <p id={descId}>{description}</p>}
          </div>
          <button className="icon-button" aria-label="Close" onClick={onClose} disabled={busy}><X size={16} /></button>
        </header>
        {children && <div className="modal-body">{children}</div>}
        {footer && <footer className="modal-footer">{footer}</footer>}
      </section>
    </div>,
    document.body
  );
}

/* ---------- Confirm / prompt ---------------------------------------------- */

export interface ConfirmOptions {
  title: string;
  description?: string;
  tone?: "danger" | "default";
  confirmLabel?: string;
  busyLabel?: string;
  cancelLabel?: string;
  /** Highlighted consequence statement, e.g. "This cannot be undone." */
  callout?: string;
  /** The object being acted on, shown in a mono chip. */
  target?: string;
  /** Require typing this text to enable the confirm button (very destructive actions). */
  typeToConfirm?: string;
  icon?: React.ElementType;
  /** If given, runs inside the modal; failures stay in the modal (F5) and it remains open. */
  onConfirm?: () => Promise<unknown>;
}

export interface PromptOptions {
  title: string;
  description?: string;
  label: string;
  placeholder?: string;
  defaultValue?: string;
  confirmLabel?: string;
  icon?: React.ElementType;
  validate?: (value: string) => string | null;
}

interface DialogState {
  kind: "confirm" | "prompt";
  options: ConfirmOptions & Partial<PromptOptions>;
  resolve: (value: boolean | string | null) => void;
}

interface ConfirmApi {
  confirm: (options: ConfirmOptions) => Promise<boolean>;
  prompt: (options: PromptOptions) => Promise<string | null>;
}

const ConfirmContext = createContext<ConfirmApi | null>(null);

export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const api = useMemo<ConfirmApi>(() => ({
    confirm: (options) => new Promise<boolean>((resolve) => {
      setDialog({ kind: "confirm", options, resolve: (v) => resolve(v === true) });
      setTyped("");
      setError("");
      setOpen(true);
    }),
    prompt: (options) => new Promise<string | null>((resolve) => {
      setDialog({ kind: "prompt", options: { ...options, title: options.title }, resolve: (v) => resolve(typeof v === "string" ? v : null) });
      setValue(options.defaultValue || "");
      setError("");
      setOpen(true);
    })
  }), []);

  const close = (result: boolean | string | null) => {
    if (!dialog) return;
    dialog.resolve(result);
    setOpen(false);
    setBusy(false);
  };

  const submit = async () => {
    if (!dialog) return;
    const o = dialog.options;
    if (dialog.kind === "prompt") {
      const trimmed = value.trim();
      const message = o.validate ? o.validate(trimmed) : trimmed ? null : `${o.label} is required`;
      if (message) {
        setError(message);
        return;
      }
      close(trimmed);
      return;
    }
    if (o.onConfirm) {
      setBusy(true);
      setError("");
      try {
        await o.onConfirm();
      } catch (err) {
        setBusy(false);
        setError(errorMessage(err));
        return;
      }
    }
    close(true);
  };

  const o = dialog?.options;
  const danger = o?.tone === "danger";
  const blocked = !!o?.typeToConfirm && typed.trim() !== o.typeToConfirm;
  const Icon = o?.icon || (danger ? TriangleAlert : Info);

  return (
    <ConfirmContext.Provider value={api}>
      {children}
      <Modal
        open={open}
        onClose={() => close(dialog?.kind === "prompt" ? null : false)}
        busy={busy}
        title={o?.title || ""}
        description={o?.description}
        icon={Icon}
        tone={danger ? "danger" : "default"}
        size="small-modal"
        footer={
          <>
            <button onClick={() => close(dialog?.kind === "prompt" ? null : false)} disabled={busy}>{o?.cancelLabel || "Cancel"}</button>
            <button className={danger ? "danger-solid" : "primary"} onClick={() => void submit()} disabled={busy || blocked} data-autofocus={dialog?.kind === "confirm" && !o?.typeToConfirm ? true : undefined}>
              {busy && <span className="ring-spinner" style={{ borderColor: "color-mix(in oklab, currentColor 30%, transparent)", borderTopColor: "currentColor" }} />}
              {busy ? o?.busyLabel || "Working…" : o?.confirmLabel || (danger ? "Delete" : "Confirm")}
            </button>
          </>
        }
      >
        {dialog?.kind === "prompt" ? (
          <label>
            {o?.label}
            <input
              value={value}
              placeholder={o?.placeholder}
              onChange={(e) => { setValue(e.target.value); setError(""); }}
              onKeyDown={(e) => { if (e.key === "Enter") void submit(); }}
              aria-invalid={!!error}
            />
            {error && <small className="field-error" style={{ marginTop: 0 }}>{error}</small>}
          </label>
        ) : o && (o.target || o.callout || o.typeToConfirm || error) ? (
          <>
            {o.target && <div className="confirm-target"><code>{o.target}</code></div>}
            {o.callout && <div className={`confirm-callout ${danger ? "" : "neutral"}`}>{o.callout}</div>}
            {o.typeToConfirm && (
              <label className="confirm-type">
                <span>Type <code>{o.typeToConfirm}</code> to confirm</span>
                <input value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" spellCheck={false} onKeyDown={(e) => { if (e.key === "Enter" && !blocked) void submit(); }} />
              </label>
            )}
            {error && <div className="alert" role="alert"><CircleAlert size={15} />{error}</div>}
          </>
        ) : null}
      </Modal>
    </ConfirmContext.Provider>
  );
}

export function useConfirm() {
  const ctx = useContext(ConfirmContext);
  if (!ctx) throw new Error("useConfirm must be used inside ConfirmProvider");
  return ctx;
}
