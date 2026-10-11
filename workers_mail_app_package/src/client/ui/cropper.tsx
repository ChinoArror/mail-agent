import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { CircleAlert, Crop, Hand, Keyboard, Minus, MousePointer2, Plus, RotateCcw, Save } from "lucide-react";
import { Modal, errorMessage } from "./feedback";
import { ElasticSlider } from "./slider";

/* ==========================================================================
   Auth Center style crop editor (authcenter-avatar-crop skill)
   - the preview frame *is* the final crop; the image always covers it
   - position is adjusted by dragging the image directly (pointer / touch),
     with arrow-key nudges for keyboard users — no position sliders
   - size via elastic slider, ± buttons, mouse wheel (cursor-anchored) or pinch
   - cropping happens only on Save, at a fixed practical output size
   ========================================================================== */

export interface CropParams {
  scale: number;
  /** Offset as a fraction of the crop width/height (resolution independent). */
  x: number;
  y: number;
  aspect: number;
}

export interface CropSource {
  /** Object URL / data URL of the image to edit. */
  url: string;
  /** Present when the user picked a new file; omitted when re-cropping the stored original. */
  file?: File;
  initial?: Partial<CropParams> | null;
}

export interface CropResult {
  cropped: Blob;
  original?: File;
  crop: CropParams;
}

const MIN_SCALE = 1;
const MAX_SCALE = 3;

function layout(natural: { w: number; h: number }, scale: number, frameW: number, frameH: number) {
  const cover = Math.max(frameW / natural.w, frameH / natural.h) * scale;
  const width = natural.w * cover;
  const height = natural.h * cover;
  return { width, height, maxX: Math.max(0, (width - frameW) / 2), maxY: Math.max(0, (height - frameH) / 2) };
}

function clamp(natural: { w: number; h: number }, s: { scale: number; ox: number; oy: number }, frameW: number, frameH: number) {
  const scale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, s.scale));
  const { maxX, maxY } = layout(natural, scale, frameW, frameH);
  // offsets are stored as fractions of the frame; clamp in pixel space
  const px = Math.min(maxX, Math.max(-maxX, s.ox * frameW));
  const py = Math.min(maxY, Math.max(-maxY, s.oy * frameH));
  return {
    state: { scale, ox: frameW ? px / frameW : 0, oy: frameH ? py / frameH : 0 },
    // the user tried to push the image past an edge → flash that edge
    hitX: Math.abs(s.ox * frameW) > maxX + 0.5,
    hitY: Math.abs(s.oy * frameH) > maxY + 0.5
  };
}

function loadImage(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.decoding = "async";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Unable to read this image"));
    img.src = src;
  });
}

async function renderCrop(img: HTMLImageElement, crop: CropParams, outW: number, outH: number, type: string, quality: number) {
  const canvas = document.createElement("canvas");
  canvas.width = outW;
  canvas.height = outH;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Unable to crop image");
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  const base = Math.max(outW / img.naturalWidth, outH / img.naturalHeight) * crop.scale;
  const width = img.naturalWidth * base;
  const height = img.naturalHeight * base;
  const x = (outW - width) / 2 + crop.x * outW;
  const y = (outH - height) / 2 + crop.y * outH;
  ctx.drawImage(img, x, y, width, height);
  return new Promise<Blob>((resolve, reject) => canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("Unable to encode image"))), type, quality));
}

/** Large originals are normalized once on the client so the 8 MB upload limit is never hit. */
export async function prepareOriginal(file: File, maxBytes = 8 * 1024 * 1024, maxEdge = 4096): Promise<File> {
  if (file.size <= maxBytes) return file;
  const url = URL.createObjectURL(file);
  try {
    const img = await loadImage(url);
    const ratio = Math.min(1, maxEdge / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.round(img.naturalWidth * ratio);
    const h = Math.round(img.naturalHeight * ratio);
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    ctx.drawImage(img, 0, 0, w, h);
    for (const q of [0.9, 0.82, 0.72]) {
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", q));
      if (blob && blob.size <= maxBytes) return new File([blob], file.name.replace(/\.[^.]+$/, "") + ".jpg", { type: "image/jpeg" });
    }
    throw new Error("Image is too large even after compression (8 MB limit)");
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function CropEditor({
  open,
  source,
  aspect = 16 / 9,
  output = { width: 1920, height: 1080, type: "image/jpeg", quality: 0.9 },
  title = "Adjust landing background",
  onCancel,
  onSave
}: {
  open: boolean;
  source: CropSource | null;
  aspect?: number;
  output?: { width: number; height: number; type: string; quality: number };
  title?: string;
  onCancel: () => void;
  onSave: (result: CropResult) => Promise<void>;
}) {
  const frameRef = useRef<HTMLDivElement | null>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  const [frame, setFrame] = useState({ w: 0, h: 0 });
  const [state, setState] = useState({ scale: 1, ox: 0, oy: 0 });
  const [hit, setHit] = useState({ x: false, y: false });
  const [dragging, setDragging] = useState(false);
  const [touched, setTouched] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{ startX: number; startY: number; ox: number; oy: number; dist: number; scale: number } | null>(null);
  const hitTimer = useRef(0);

  // Decode the source once when the editor opens.
  useEffect(() => {
    if (!open || !source) return;
    let cancelled = false;
    setNatural(null);
    setError("");
    setTouched(false);
    loadImage(source.url)
      .then((img) => {
        if (cancelled) return;
        imgRef.current = img;
        setNatural({ w: img.naturalWidth, h: img.naturalHeight });
        setState({ scale: source.initial?.scale ?? 1, ox: source.initial?.x ?? 0, oy: source.initial?.y ?? 0 });
      })
      .catch((err) => !cancelled && setError(errorMessage(err)));
    return () => { cancelled = true; };
  }, [open, source?.url]);

  useLayoutEffect(() => {
    const el = frameRef.current;
    if (!el) return;
    const measure = () => setFrame({ w: el.clientWidth, h: el.clientWidth / aspect });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [open, natural, aspect]);

  const apply = (next: { scale: number; ox: number; oy: number }, flashEdges = false) => {
    if (!natural || !frame.w) return;
    const result = clamp(natural, next, frame.w, frame.h);
    setState(result.state);
    if (flashEdges && (result.hitX || result.hitY)) {
      setHit({ x: result.hitX, y: result.hitY });
      window.clearTimeout(hitTimer.current);
      hitTimer.current = window.setTimeout(() => setHit({ x: false, y: false }), 420);
    }
  };

  // Re-clamp whenever the frame resizes (e.g. modal width changes on rotate).
  useEffect(() => { if (natural && frame.w) setState((s) => clamp(natural, s, frame.w, frame.h).state); }, [frame.w, frame.h, natural]);

  /** Zoom keeping the image point under `anchor` (frame-centered px) fixed. */
  const zoomTo = (scale: number, anchor = { x: 0, y: 0 }) => {
    const nextScale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, scale));
    const ratio = nextScale / state.scale;
    const ox = (anchor.x - (anchor.x - state.ox * frame.w) * ratio) / frame.w;
    const oy = (anchor.y - (anchor.y - state.oy * frame.h) * ratio) / frame.h;
    apply({ scale: nextScale, ox, oy });
  };

  const centerOf = (clientX: number, clientY: number) => {
    const rect = frameRef.current!.getBoundingClientRect();
    return { x: clientX - rect.left - rect.width / 2, y: clientY - rect.top - rect.height / 2 };
  };

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!natural) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    setDragging(true);
    setTouched(true);
    const pts = Array.from(pointers.current.values());
    const dist = pts.length >= 2 ? Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) : 0;
    const cx = pts.reduce((sum, p) => sum + p.x, 0) / pts.length;
    const cy = pts.reduce((sum, p) => sum + p.y, 0) / pts.length;
    gesture.current = { startX: cx, startY: cy, ox: state.ox, oy: state.oy, dist, scale: state.scale };
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!pointers.current.has(e.pointerId) || !gesture.current || !natural) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const pts = Array.from(pointers.current.values());
    const cx = pts.reduce((sum, p) => sum + p.x, 0) / pts.length;
    const cy = pts.reduce((sum, p) => sum + p.y, 0) / pts.length;
    const g = gesture.current;
    let scale = g.scale;
    if (pts.length >= 2 && g.dist > 0) scale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, g.scale * (Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) / g.dist)));
    const ratio = scale / g.scale;
    const anchor = centerOf(g.startX, g.startY);
    const ox = (anchor.x - (anchor.x - g.ox * frame.w) * ratio + (cx - g.startX)) / frame.w;
    const oy = (anchor.y - (anchor.y - g.oy * frame.h) * ratio + (cy - g.startY)) / frame.h;
    apply({ scale, ox, oy }, pts.length === 1);
  };

  const endPointer = (e: React.PointerEvent<HTMLDivElement>) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size === 0) {
      setDragging(false);
      gesture.current = null;
    } else {
      // Restart the gesture from the remaining pointer so the image doesn't jump.
      const p = Array.from(pointers.current.values())[0];
      gesture.current = { startX: p.x, startY: p.y, ox: state.ox, oy: state.oy, dist: 0, scale: state.scale };
    }
  };

  // Wheel must be non-passive to prevent page/modal scroll while zooming.
  useEffect(() => {
    const el = frameRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!natural) return;
      e.preventDefault();
      setTouched(true);
      const rect = el.getBoundingClientRect();
      const anchor = { x: e.clientX - rect.left - rect.width / 2, y: e.clientY - rect.top - rect.height / 2 };
      zoomTo(state.scale * Math.exp(-e.deltaY * 0.0015), anchor);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  });

  const onKeyDown = (e: React.KeyboardEvent) => {
    const stepPx = e.shiftKey ? 40 : 8;
    const moves: Record<string, [number, number]> = { ArrowLeft: [stepPx, 0], ArrowRight: [-stepPx, 0], ArrowUp: [0, stepPx], ArrowDown: [0, -stepPx] };
    if (e.key in moves) {
      e.preventDefault();
      setTouched(true);
      const [dx, dy] = moves[e.key];
      apply({ ...state, ox: state.ox + dx / frame.w, oy: state.oy + dy / frame.h }, true);
    } else if (e.key === "+" || e.key === "=") {
      e.preventDefault();
      zoomTo(state.scale + 0.1);
    } else if (e.key === "-" || e.key === "_") {
      e.preventDefault();
      zoomTo(state.scale - 0.1);
    } else if (e.key === "0") {
      e.preventDefault();
      apply({ scale: 1, ox: 0, oy: 0 });
    }
  };

  const save = async () => {
    if (!imgRef.current || !source) return;
    setSaving(true);
    setError("");
    try {
      const crop: CropParams = { scale: Number(state.scale.toFixed(4)), x: Number(state.ox.toFixed(5)), y: Number(state.oy.toFixed(5)), aspect };
      const cropped = await renderCrop(imgRef.current, crop, output.width, output.height, output.type, output.quality);
      const original = source.file ? await prepareOriginal(source.file) : undefined;
      await onSave({ cropped, original, crop });
    } catch (err) {
      setError(errorMessage(err, "Saving failed"));
    } finally {
      setSaving(false);
    }
  };

  const view = natural && frame.w ? layout(natural, state.scale, frame.w, frame.h) : null;
  const pxX = Math.round(state.ox * output.width);
  const pxY = Math.round(state.oy * output.height);

  return (
    <Modal
      open={open}
      onClose={() => !saving && onCancel()}
      busy={saving}
      size="crop-modal"
      icon={Crop}
      title={title}
      description={`Drag the image to choose what shows on the sign-in page. Output ${output.width}×${output.height} (${aspect === 16 / 9 ? "16:9" : aspect.toFixed(2)}).`}
      footer={
        <>
          <span className="footer-note">{source?.file ? `New image · ${source.file.name}` : "Re-cropping the stored original"}</span>
          <button onClick={onCancel} disabled={saving}>Cancel</button>
          <button className="primary" onClick={() => void save()} disabled={saving || !natural}>
            {saving ? <span className="ring-spinner" style={{ borderColor: "color-mix(in oklab, currentColor 30%, transparent)", borderTopColor: "currentColor" }} /> : <Save size={16} />}
            {saving ? "Saving…" : "Save crop"}
          </button>
        </>
      }
    >
      <div className="crop-layout">
        <div className="crop-stage">
          <div
            ref={frameRef}
            className={`crop-frame ${dragging ? "dragging" : ""} ${touched ? "touched" : ""}`}
            style={{ aspectRatio: String(aspect) }}
            tabIndex={0}
            role="application"
            aria-label="Crop area. Drag to reposition, use arrow keys to nudge, plus and minus to zoom, 0 to reset."
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={endPointer}
            onPointerCancel={endPointer}
            onKeyDown={onKeyDown}
            onDoubleClick={() => apply({ scale: 1, ox: 0, oy: 0 })}
          >
            {source && view && (
              <img
                src={source.url}
                alt=""
                draggable={false}
                style={{ width: view.width, height: view.height, transform: `translate(-50%, -50%) translate(${state.ox * frame.w}px, ${state.oy * frame.h}px)` }}
              />
            )}
            {!natural && !error && <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center" }}><span className="ring-spinner" /></div>}
            <span className="crop-grid" />
            <span className={`crop-edge ${hit.x ? "hit-x" : ""} ${hit.y ? "hit-y" : ""}`} />
            {natural && <span className="crop-hint"><Hand size={14} />Drag to reposition</span>}
          </div>
          <div className="crop-readout">
            <span>x {pxX >= 0 ? "+" : ""}{pxX}px · y {pxY >= 0 ? "+" : ""}{pxY}px</span>
            <span>{natural ? `${natural.w}×${natural.h} source` : "decoding…"}</span>
          </div>
        </div>
        <div className="crop-controls">
          <div className="control-label"><span>Size</span><button className="ghost small-button" onClick={() => apply({ scale: 1, ox: 0, oy: 0 })} disabled={!natural}><RotateCcw size={14} />Reset</button></div>
          <div className="zoom-row">
            <button aria-label="Zoom out" onClick={() => zoomTo(state.scale - 0.1)} disabled={!natural || state.scale <= MIN_SCALE}><Minus size={16} /></button>
            <ElasticSlider label="Zoom" value={Number(state.scale.toFixed(2))} min={MIN_SCALE} max={MAX_SCALE} step={0.01} onChange={(v) => zoomTo(v)} format={(v) => `${v.toFixed(2)}×`} />
            <button aria-label="Zoom in" onClick={() => zoomTo(state.scale + 0.1)} disabled={!natural || state.scale >= MAX_SCALE}><Plus size={16} /></button>
          </div>
          <div className="crop-tips">
            <div><MousePointer2 size={14} />Drag the image to move it</div>
            <div><Plus size={14} />Scroll or pinch to zoom at the cursor</div>
            <div><Keyboard size={14} /><span><kbd>←↑→↓</kbd> nudge · <kbd>Shift</kbd> faster · <kbd>0</kbd> reset</span></div>
          </div>
          {error && <div className="alert" role="alert"><CircleAlert size={15} />{error}</div>}
        </div>
      </div>
    </Modal>
  );
}
