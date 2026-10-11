import React, { useEffect, useRef, useState } from "react";

/* ==========================================================================
   E3 · Skeleton Swap
   - the skeleton appears only if loading takes longer than 120 ms
   - once shown it stays at least 380 ms, so it never flickers
   - content and skeleton share one grid cell and crossfade in place
   - each bar carries a light-sweep shimmer (staggered for a wave effect)
   ========================================================================== */

const SHOW_DELAY = 120;
const MIN_VISIBLE = 380;

export function useSkeletonSwap(ready: boolean, delay = SHOW_DELAY, minVisible = MIN_VISIBLE) {
  const [showSkeleton, setShowSkeleton] = useState(false);
  const [settled, setSettled] = useState(ready);
  const shownAt = useRef(0);

  useEffect(() => {
    if (!ready) {
      setSettled(false);
      const timer = window.setTimeout(() => {
        shownAt.current = performance.now();
        setShowSkeleton(true);
      }, delay);
      return () => window.clearTimeout(timer);
    }
    if (!showSkeleton) {
      setSettled(true);
      return;
    }
    const remaining = minVisible - (performance.now() - shownAt.current);
    const timer = window.setTimeout(() => {
      setShowSkeleton(false);
      setSettled(true);
    }, Math.max(0, remaining));
    return () => window.clearTimeout(timer);
  }, [ready, showSkeleton]);

  return { showSkeleton, showContent: ready && settled && !showSkeleton };
}

export function SkeletonSwap({ ready, skeleton, children, label = "Loading" }: { ready: boolean; skeleton: React.ReactNode; children: React.ReactNode; label?: string }) {
  const { showSkeleton, showContent } = useSkeletonSwap(ready);
  const wasSkeleton = useRef(false);
  if (showSkeleton) wasSkeleton.current = true;
  return (
    <div className="skeleton-swap" aria-busy={!showContent}>
      {showSkeleton && <div className="swap-in" aria-hidden="true">{skeleton}</div>}
      {showContent && <div className={wasSkeleton.current ? "swap-in" : undefined}>{children}</div>}
      <span className="sr-only" role="status">{showContent ? "" : label}</span>
    </div>
  );
}

/* ---------- Primitives ---------------------------------------------------- */

const WIDTHS = [100, 93, 97, 88, 95, 91];

export function Sk({ w, h, r, className = "", delay = 0, style }: { w?: number | string; h?: number | string; r?: number; className?: string; delay?: number; style?: React.CSSProperties }) {
  return (
    <span
      className={`sk ${className}`}
      style={{ width: typeof w === "number" ? `${w}px` : w, height: typeof h === "number" ? `${h}px` : h, borderRadius: r, ["--sk-delay" as string]: `${delay}ms`, ...style }}
    />
  );
}

export function SkLines({ lines = 3, last = 62 }: { lines?: number; last?: number }) {
  return (
    <div>
      {Array.from({ length: lines }, (_, i) => (
        <Sk key={i} className="sk-line" w={`${i === lines - 1 ? last : WIDTHS[i % WIDTHS.length]}%`} delay={i * 60} />
      ))}
    </div>
  );
}

/* ---------- Presets matching the real layouts ----------------------------- */

export function SkeletonMailList({ rows = 7 }: { rows?: number }) {
  return (
    <div className="panel mail-list">
      {Array.from({ length: rows }, (_, i) => (
        <div className="sk-row" key={i}>
          <Sk w={18} h={18} r={5} delay={i * 70} />
          <Sk w={18} h={18} r={5} delay={i * 70} />
          <div className="sk-col">
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
              <Sk className="sk-line" w={`${28 + ((i * 17) % 22)}%`} delay={i * 70} />
              <Sk className="sk-line" w={96} delay={i * 70} />
            </div>
            <Sk className="sk-line" w={`${52 + ((i * 23) % 36)}%`} delay={i * 70 + 40} />
          </div>
          <Sk className="sk-pill" delay={i * 70} />
        </div>
      ))}
    </div>
  );
}

export function SkeletonMailboxList({ rows = 4 }: { rows?: number }) {
  return (
    <div className="mailbox-list">
      {Array.from({ length: rows }, (_, i) => (
        <div className="mailbox-card" key={i}>
          <div style={{ display: "flex", gap: 11, alignItems: "center" }}>
            <Sk w={34} h={34} r={10} delay={i * 80} />
            <div className="sk-col">
              <Sk className="sk-line" w={`${70 + (i % 3) * 8}%`} delay={i * 80} />
              <Sk className="sk-line" w="40%" delay={i * 80 + 40} />
            </div>
          </div>
          <div style={{ display: "flex", gap: 10, paddingLeft: 45 }}>
            <Sk className="sk-line" w={64} delay={i * 80} />
            <Sk className="sk-line" w={52} delay={i * 80} />
            <Sk className="sk-line" w={44} delay={i * 80} />
          </div>
        </div>
      ))}
    </div>
  );
}

export function SkeletonTable({ rows = 6, cols = 4 }: { rows?: number; cols?: number }) {
  return (
    <div className="panel table">
      {Array.from({ length: rows }, (_, i) => (
        <div className="sk-row" key={i}>
          {Array.from({ length: cols }, (_, c) => (
            <Sk key={c} className="sk-line" w={c === 0 ? "22%" : `${10 + ((i + c) * 7) % 12}%`} delay={i * 60 + c * 30} style={{ flex: c === 0 ? 2 : 1 }} />
          ))}
          <Sk className="sk-btn" w={88} delay={i * 60} />
        </div>
      ))}
    </div>
  );
}

export function SkeletonMetrics({ count = 4 }: { count?: number }) {
  return (
    <div className="metric-grid">
      {Array.from({ length: count }, (_, i) => (
        <div className="panel metric" key={i}>
          <Sk className="sk-well" delay={i * 80} />
          <div className="sk-col" style={{ gap: 6 }}>
            <Sk h={9} w="46%" delay={i * 80} />
            <Sk h={16} w="58%" r={6} delay={i * 80 + 40} />
            <Sk h={8} w="72%" delay={i * 80 + 80} />
          </div>
        </div>
      ))}
    </div>
  );
}

export function SkeletonChart({ title = true, rows = 3 }: { title?: boolean; rows?: number }) {
  return (
    <div className="panel chart">
      {title && <Sk className="sk-title" w="32%" />}
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} style={{ display: "grid", gridTemplateColumns: "110px 1fr", gap: 12, alignItems: "end" }}>
          <Sk className="sk-line" w="70%" delay={i * 80} />
          <div style={{ display: "flex", alignItems: "flex-end", gap: 3, height: 72, padding: 6 }}>
            {Array.from({ length: 14 }, (_, b) => <Sk key={b} w="100%" h={`${22 + ((b * 37 + i * 13) % 70)}%`} r={3} delay={b * 25} style={{ flex: 1 }} />)}
          </div>
        </div>
      ))}
    </div>
  );
}

export function SkeletonAttachmentGrid({ count = 8 }: { count?: number }) {
  return (
    <div className="attachment-grid">
      {Array.from({ length: count }, (_, i) => (
        <div className="panel attachment-tile" key={i}>
          <Sk w="100%" r={0} style={{ aspectRatio: "16 / 10" }} delay={i * 60} />
          <div style={{ padding: "12px 14px" }}>
            <Sk className="sk-line" w="80%" delay={i * 60} />
            <Sk className="sk-line" w="50%" delay={i * 60 + 40} />
            <Sk className="sk-line" w="64%" delay={i * 60 + 80} />
          </div>
          <div style={{ display: "flex", gap: 6, padding: "0 12px 12px" }}>
            <Sk className="sk-btn" w="50%" delay={i * 60} />
            <Sk className="sk-btn" w="50%" delay={i * 60} />
          </div>
        </div>
      ))}
    </div>
  );
}

export function SkeletonDetail() {
  return (
    <div className="panel email-detail">
      <div style={{ display: "flex", justifyContent: "space-between" }}>
        <Sk className="sk-btn" w={92} />
        <Sk className="sk-pill" />
      </div>
      <Sk h={22} w="58%" r={7} />
      <div className="meta-grid" style={{ background: "transparent", padding: 0 }}>
        <Sk className="sk-line" w={40} /><Sk className="sk-line" w="36%" />
        <Sk className="sk-line" w={28} /><Sk className="sk-line" w="30%" />
      </div>
      <SkLines lines={7} />
    </div>
  );
}

export function SkeletonForm({ fields = 4 }: { fields?: number }) {
  return (
    <div className="panel settings-page">
      <Sk className="sk-title" w="28%" />
      <div className="settings-form-grid">
        {Array.from({ length: fields }, (_, i) => (
          <div key={i} style={{ display: "grid", gap: 8 }}>
            <Sk h={9} w="34%" delay={i * 70} />
            <Sk h={38} w="100%" r={10} delay={i * 70} />
          </div>
        ))}
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <Sk className="sk-btn" w={84} />
        <Sk className="sk-btn" w={140} />
      </div>
    </div>
  );
}

export function SkeletonComposer() {
  return (
    <div className="compose-layout">
      <div className="panel composer">
        <div style={{ display: "flex", gap: 10 }}>
          <Sk h={38} w="60%" r={10} />
          <Sk className="sk-btn" w={90} />
          <Sk className="sk-btn" w={80} />
        </div>
        <Sk h={38} w="100%" r={10} delay={60} />
        <div className="split"><Sk h={38} w="100%" r={10} delay={100} /><Sk h={38} w="100%" r={10} delay={100} /></div>
        <Sk h={38} w="100%" r={10} delay={140} />
        <Sk h={34} w={300} r={10} delay={180} />
        <Sk h={300} w="100%" r={10} delay={220} />
      </div>
      <div className="panel agent">
        <Sk className="sk-title" w="30%" />
        <Sk h={38} w="100%" r={10} delay={60} />
        <Sk h={110} w="100%" r={10} delay={120} />
      </div>
    </div>
  );
}

/** Full app-shell skeleton shown while a stored session is being restored. */
export function SkeletonShell() {
  return (
    <div className="app shell-skeleton" aria-busy="true">
      <aside className="sidebar">
        <div className="brand" style={{ alignItems: "center" }}>
          <Sk w={38} h={38} r={11} />
          <div className="sk-col"><Sk className="sk-line" w="70%" /><Sk className="sk-line" w="46%" /></div>
        </div>
        {Array.from({ length: 8 }, (_, i) => (
          <div key={i} style={{ display: "flex", alignItems: "center", gap: 12, height: 40, padding: "0 12px" }}>
            <Sk w={18} h={18} r={5} delay={i * 50} />
            <Sk className="sk-line" w={`${44 + ((i * 19) % 36)}%`} delay={i * 50} />
          </div>
        ))}
      </aside>
      <div className="main">
        <header className="topbar">
          <Sk w={18} h={18} r={5} />
          <Sk className="sk-line" w={120} />
          <Sk h={36} w={360} r={999} style={{ marginLeft: "auto" }} />
          <Sk w={36} h={36} r={999} />
          <Sk w={120} h={36} r={999} />
        </header>
        <section className="content stack">
          <SkeletonMetrics count={3} />
          <SkeletonMailList rows={6} />
        </section>
      </div>
    </div>
  );
}
