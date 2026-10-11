import { useRef, useState } from "react";

/* E9 · Elastic slider — 48px tile, range fill, hairline handle, dot ticks, labels inside the track. */
export function ElasticSlider({
  label,
  value,
  min,
  max,
  step,
  onChange,
  format = (v) => v.toFixed(2),
  ticks = 5,
  ariaLabel
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
  format?: (value: number) => string;
  ticks?: number;
  ariaLabel?: string;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [dragging, setDragging] = useState(false);
  const pct = ((value - min) / (max - min)) * 100;
  const snap = (raw: number) => {
    const stepped = Math.round((raw - min) / step) * step + min;
    return Number(Math.max(min, Math.min(max, stepped)).toFixed(4));
  };
  const fromPointer = (clientX: number) => {
    const rect = ref.current?.getBoundingClientRect();
    if (!rect) return;
    onChange(snap(min + ((clientX - rect.left) / rect.width) * (max - min)));
  };
  return (
    <div
      ref={ref}
      className={`elastic-slider ${dragging ? "dragging" : ""}`}
      role="slider"
      tabIndex={0}
      aria-label={ariaLabel || label}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={value}
      aria-valuetext={format(value)}
      onPointerDown={(e) => {
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        setDragging(true);
        fromPointer(e.clientX);
      }}
      onPointerMove={(e) => { if (dragging) fromPointer(e.clientX); }}
      onPointerUp={() => setDragging(false)}
      onPointerCancel={() => setDragging(false)}
      onKeyDown={(e) => {
        const big = (max - min) / 10;
        const map: Record<string, number> = { ArrowRight: step, ArrowUp: step, ArrowLeft: -step, ArrowDown: -step, PageUp: big, PageDown: -big };
        if (e.key in map) { e.preventDefault(); onChange(snap(value + map[e.key])); }
        if (e.key === "Home") { e.preventDefault(); onChange(min); }
        if (e.key === "End") { e.preventDefault(); onChange(max); }
      }}
    >
      <span className="range" style={{ width: `${pct}%` }} />
      <span className="handle" style={{ left: `clamp(14px, ${pct}%, calc(100% - 14px))` }} />
      <span className="ticks" aria-hidden="true">{Array.from({ length: ticks }, (_, i) => <i key={i} />)}</span>
      <span className="labels" aria-hidden="true"><span>{label}</span><strong>{format(value)}</strong></span>
    </div>
  );
}
