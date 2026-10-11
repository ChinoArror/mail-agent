import React, { useEffect, useRef, useState } from "react";
import { CircleAlert, Monitor, Moon, RefreshCw, Sun } from "lucide-react";
import { SkeletonSwap } from "./ui/skeleton";
import { useThemeMode, type ThemeMode } from "./lib";

export function StatusPill({ value, label }: { value: string; label?: string }) {
  return <span className={`pill ${value.replace(/\s+/g, "_").toLowerCase()}`}>{label || value.replace(/_/g, " ")}</span>;
}

export function EmptyState({ title, hint, icon: Icon, action }: { title: string; hint?: string; icon: React.ElementType; action?: React.ReactNode }) {
  return (
    <div className="empty">
      <span className="empty-icon"><Icon size={22} /></span>
      <span>{title}</span>
      {hint && <small>{hint}</small>}
      {action}
    </div>
  );
}

export function ErrorPanel({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="alert" role="alert" style={{ alignItems: "center" }}>
      <CircleAlert size={16} />
      <span style={{ flex: 1 }}>{message}</span>
      {onRetry && <button className="small-button" onClick={onRetry}><RefreshCw size={14} />Retry</button>}
    </div>
  );
}

/**
 * Wraps an async data panel: shimmer skeleton on first load (Skeleton Swap),
 * dimmed stale content while refreshing, inline error with retry.
 */
export function Loadable<T>({
  state,
  skeleton,
  children,
  label
}: {
  state: { data: T | null; error: string; loading: boolean; reload: () => Promise<void> | void };
  skeleton: React.ReactNode;
  children: (data: T) => React.ReactNode;
  label?: string;
}) {
  if (state.error && !state.data) return <ErrorPanel message={state.error} onRetry={() => void state.reload()} />;
  return (
    <SkeletonSwap ready={state.data !== null} skeleton={skeleton} label={label}>
      <div className={state.loading ? "is-refreshing" : undefined}>
        {state.error && <div style={{ marginBottom: 12 }}><ErrorPanel message={state.error} onRetry={() => void state.reload()} /></div>}
        {state.data !== null && children(state.data)}
      </div>
    </SkeletonSwap>
  );
}

/** E1 · segmented control with an inverted-label thumb. */
export function Segmented<T extends string | number>({ value, options, onChange, ariaLabel }: { value: T; options: Array<{ value: T; label: string }>; onChange: (value: T) => void; ariaLabel: string }) {
  const idx = Math.max(0, options.findIndex((o) => o.value === value));
  const n = options.length;
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const labels = options.map((o) => <span key={String(o.value)}>{o.label}</span>);
  return (
    <div className="segmented" role="radiogroup" aria-label={ariaLabel}>
      <div className="segmented-labels" aria-hidden="true">{labels}</div>
      <div className="segmented-thumb" aria-hidden="true" style={{ width: `calc((100% - 6px) / ${n})`, transform: `translateX(${idx * 100}%)` }}>
        <div className="segmented-thumb-labels" style={{ width: `${n * 100}%`, transform: `translateX(${(-idx * 100) / n}%)` }}>{labels}</div>
      </div>
      <div className="segmented-hit">
        {options.map((o, i) => (
          <button
            key={String(o.value)}
            ref={(el) => { refs.current[i] = el; }}
            role="radio"
            aria-checked={i === idx}
            aria-label={o.label}
            tabIndex={i === idx ? 0 : -1}
            onClick={() => onChange(o.value)}
            onKeyDown={(e) => {
              const next = e.key === "ArrowRight" || e.key === "ArrowDown" ? (idx + 1) % n : e.key === "ArrowLeft" || e.key === "ArrowUp" ? (idx - 1 + n) % n : e.key === "Home" ? 0 : e.key === "End" ? n - 1 : -1;
              if (next < 0) return;
              e.preventDefault();
              onChange(options[next].value);
              refs.current[next]?.focus();
            }}
          />
        ))}
      </div>
    </div>
  );
}

/** Three-way theme toggle (system / light / dark) with a sliding primary disc. */
export function ThemeToggle({ inline = false }: { inline?: boolean }) {
  const [mode, setMode] = useThemeMode();
  const modes: Array<{ value: ThemeMode; label: string; Icon: React.ElementType }> = [
    { value: "system", label: "System theme", Icon: Monitor },
    { value: "light", label: "Light theme", Icon: Sun },
    { value: "dark", label: "Dark theme", Icon: Moon }
  ];
  const idx = modes.findIndex((m) => m.value === mode);
  return (
    <div className={`theme-toggle ${inline ? "inline" : ""}`} role="radiogroup" aria-label="Theme">
      <span className="thumb" style={{ transform: `translateX(${idx * 36}px)` }} />
      {modes.map((m) => (
        <button key={m.value} role="radio" aria-checked={mode === m.value} aria-label={m.label} title={m.label} className={mode === m.value ? "on" : ""} onClick={(e) => setMode(m.value, { x: e.clientX, y: e.clientY })}>
          <m.Icon size={15} />
        </button>
      ))}
    </div>
  );
}

/** Closes a popover when clicking outside or pressing Escape. */
export function useDismiss(open: boolean, onClose: () => void) {
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) onClose(); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  return ref;
}

/** Dropdown menu: trigger + floating panel. */
export function Menu({ trigger, children, align = "right", label }: { trigger: (props: { open: boolean; toggle: () => void }) => React.ReactNode; children: (close: () => void) => React.ReactNode; align?: "left" | "right"; label?: string }) {
  const [open, setOpen] = useState(false);
  const ref = useDismiss(open, () => setOpen(false));
  return (
    <div className="dropdown" ref={ref}>
      {trigger({ open, toggle: () => setOpen((v) => !v) })}
      {open && <div className={`dropdown-menu ${align === "right" ? "right" : ""}`} role="menu" aria-label={label}>{children(() => setOpen(false))}</div>}
    </div>
  );
}

export function QuotaBar({ label, value, limit, percent }: { label: string; value: string | number; limit: string | number; percent: number }) {
  const tone = percent >= 90 ? "danger" : percent >= 70 ? "warn" : "";
  return (
    <div className={`quota-bar ${tone}`}>
      <div><strong>{label}</strong><span>{value} / {limit}</span></div>
      <i><b style={{ width: `${Math.max(0, Math.min(100, percent))}%` }} /></i>
    </div>
  );
}

/** Accessible on/off switch. */
export function Switch({ checked, onChange, label }: { checked: boolean; onChange: (checked: boolean) => void; label: string }) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={label} className={`switch ${checked ? "on" : ""}`} onClick={() => onChange(!checked)}>
      <i />
    </button>
  );
}

/** Renders a full-size page (1280×800) scaled down to fit its container. */
export function ScaledPreview({ label, children }: { label?: string; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [scale, setScale] = useState(0.5);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setScale(el.clientWidth / 1280));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return (
    <div className="page-preview" ref={ref}>
      {label && <span className="preview-label">{label}</span>}
      <div className="stage" style={{ transform: `scale(${scale})` }} aria-hidden="true">{children}</div>
    </div>
  );
}
