import { useEffect, useRef } from "react";
import { motionLevel, readPrefs } from "../lib";

/* ==========================================================================
   E12 · Login wave field
   Perlin-displaced vertical polylines (10px x-gap, 32px y-gap) that drift
   slowly and bend away from the cursor in proportion to its velocity.
   Reduced motion → one static frame.
   ========================================================================== */

const P = [151, 160, 137, 91, 90, 15, 131, 13, 201, 95, 96, 53, 194, 233, 7, 225, 140, 36, 103, 30, 69, 142, 8, 99, 37, 240, 21, 10, 23, 190, 6, 148, 247, 120, 234, 75, 0, 26, 197, 62, 94, 252, 219, 203, 117, 35, 11, 32, 57, 177, 33, 88, 237, 149, 56, 87, 174, 20, 125, 136, 171, 168, 68, 175, 74, 165, 71, 134, 139, 48, 27, 166, 77, 146, 158, 231, 83, 111, 229, 122, 60, 211, 133, 230, 220, 105, 92, 41, 55, 46, 245, 40, 244, 102, 143, 54, 65, 25, 63, 161, 1, 216, 80, 73, 209, 76, 132, 187, 208, 89, 18, 169, 200, 196, 135, 130, 116, 188, 159, 86, 164, 100, 109, 198, 173, 186, 3, 64, 52, 217, 226, 250, 124, 123, 5, 202, 38, 147, 118, 126, 255, 82, 85, 212, 207, 206, 59, 227, 47, 16, 58, 17, 182, 189, 28, 42, 223, 183, 170, 213, 119, 248, 152, 2, 44, 154, 163, 70, 221, 153, 101, 155, 167, 43, 172, 9, 129, 22, 39, 253, 19, 98, 108, 110, 79, 113, 224, 232, 178, 185, 112, 104, 218, 246, 97, 228, 251, 34, 242, 193, 238, 210, 144, 12, 191, 179, 162, 241, 81, 51, 145, 235, 249, 14, 239, 107, 49, 192, 214, 31, 181, 199, 106, 157, 184, 84, 204, 176, 115, 121, 50, 45, 127, 4, 150, 254, 138, 236, 205, 93, 222, 114, 67, 29, 24, 72, 243, 141, 128, 195, 78, 66, 215, 61, 156, 180];
const G = [[1, 1], [-1, 1], [1, -1], [-1, -1], [1, 0], [-1, 0], [1, 0], [-1, 0], [0, 1], [0, -1], [0, 1], [0, -1]];

function makeNoise(seed: number) {
  const perm = new Array<number>(512);
  const grad = new Array<number[]>(512);
  let s = Math.floor(seed > 0 && seed < 1 ? seed * 65536 : seed);
  if (s < 256) s |= s << 8;
  for (let i = 0; i < 256; i++) {
    const v = i & 1 ? P[i] ^ (s & 255) : P[i] ^ ((s >> 8) & 255);
    perm[i] = perm[i + 256] = v;
    grad[i] = grad[i + 256] = G[v % 12];
  }
  const fade = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);
  const lerp = (a: number, b: number, t: number) => (1 - t) * a + t * b;
  return (xIn: number, yIn: number) => {
    let X = Math.floor(xIn), Y = Math.floor(yIn);
    const x = xIn - X, y = yIn - Y;
    X &= 255; Y &= 255;
    const dot = (g: number[], dx: number, dy: number) => g[0] * dx + g[1] * dy;
    const n00 = dot(grad[X + perm[Y]], x, y);
    const n01 = dot(grad[X + perm[Y + 1]], x, y - 1);
    const n10 = dot(grad[X + 1 + perm[Y]], x - 1, y);
    const n11 = dot(grad[X + 1 + perm[Y + 1]], x - 1, y - 1);
    const u = fade(x);
    return lerp(lerp(n00, n10, u), lerp(n01, n11, u), fade(y));
  };
}

interface Point { x: number; y: number; cx: number; cy: number; vx: number; vy: number }

export function LoginWaves({ className = "login-waves", opacity }: { className?: string; opacity?: number }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    // Static single frame when motion is reduced/off or the user disabled animated sign-in waves.
    const reduced = motionLevel() !== "full" || !readPrefs().loginWaves;
    const noise = makeNoise(0.42);
    const mouse = { x: -9999, y: -9999, lx: -9999, ly: -9999, sx: -9999, sy: -9999, v: 0, vs: 0, a: 0, set: false };
    let lines: Point[][] = [];
    let width = 0, height = 0, raf = 0;
    let color = "";

    const readColor = () => { color = getComputedStyle(canvas).color; };
    const setup = () => {
      const rect = canvas.getBoundingClientRect();
      width = rect.width; height = rect.height;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const xGap = 10, yGap = 32;
      const oW = width + 200, oH = height + 30;
      const totalLines = Math.ceil(oW / xGap), totalPoints = Math.ceil(oH / yGap);
      const xStart = (width - xGap * totalLines) / 2, yStart = (height - yGap * totalPoints) / 2;
      lines = [];
      for (let i = 0; i <= totalLines; i++) {
        const pts: Point[] = [];
        for (let j = 0; j <= totalPoints; j++) pts.push({ x: xStart + xGap * i, y: yStart + yGap * j, cx: 0, cy: 0, vx: 0, vy: 0 });
        lines.push(pts);
      }
      readColor();
    };

    const move = (time: number) => {
      for (const pts of lines) {
        for (const p of pts) {
          const m = noise((p.x + time * 0.0125) * 0.002, (p.y + time * 0.005) * 0.0015) * 12;
          const wx = Math.cos(m) * 32, wy = Math.sin(m) * 16;
          const dx = p.x - mouse.sx, dy = p.y - mouse.sy;
          const d = Math.hypot(dx, dy);
          const l = Math.max(175, mouse.vs);
          if (d < l) {
            const s = 1 - d / l;
            const f = Math.cos(d * 0.001) * s;
            p.vx += Math.cos(mouse.a) * f * l * mouse.vs * 0.00065;
            p.vy += Math.sin(mouse.a) * f * l * mouse.vs * 0.00065;
          }
          p.vx += (0 - p.cx) * 0.005; p.vy += (0 - p.cy) * 0.005;
          p.vx *= 0.925; p.vy *= 0.925;
          p.cx += p.vx * 2; p.cy += p.vy * 2;
          p.cx = Math.min(100, Math.max(-100, p.cx)); p.cy = Math.min(100, Math.max(-100, p.cy));
          (p as Point & { wx?: number; wy?: number }).wx = wx;
          (p as Point & { wx?: number; wy?: number }).wy = wy;
        }
      }
    };

    const draw = () => {
      ctx.clearRect(0, 0, width, height);
      ctx.strokeStyle = color;
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (const pts of lines) {
        pts.forEach((p, j) => {
          const q = p as Point & { wx?: number; wy?: number };
          const x = p.x + (q.wx || 0) + p.cx, y = p.y + (q.wy || 0) + p.cy;
          if (j === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        });
      }
      ctx.stroke();
    };

    const tick = (time: number) => {
      mouse.sx += (mouse.x - mouse.sx) * 0.1;
      mouse.sy += (mouse.y - mouse.sy) * 0.1;
      const dx = mouse.x - mouse.lx, dy = mouse.y - mouse.ly;
      mouse.v = Math.hypot(dx, dy);
      mouse.vs += (mouse.v - mouse.vs) * 0.1;
      mouse.vs = Math.min(100, mouse.vs);
      mouse.lx = mouse.x; mouse.ly = mouse.y;
      mouse.a = Math.atan2(dy, dx);
      move(time);
      draw();
      raf = requestAnimationFrame(tick);
    };

    const onMove = (e: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      mouse.x = e.clientX - rect.left; mouse.y = e.clientY - rect.top;
      if (!mouse.set) { mouse.sx = mouse.lx = mouse.x; mouse.sy = mouse.ly = mouse.y; mouse.set = true; }
    };
    const onResize = () => { setup(); if (reduced) { move(0); draw(); } };
    const themeObserver = new MutationObserver(() => { readColor(); if (reduced) draw(); });

    setup();
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["class", "style"] });
    window.addEventListener("resize", onResize);
    if (reduced) {
      move(0);
      draw();
    } else {
      window.addEventListener("pointermove", onMove, { passive: true });
      raf = requestAnimationFrame(tick);
    }
    const onVisibility = () => {
      if (reduced) return;
      if (document.hidden) cancelAnimationFrame(raf);
      else raf = requestAnimationFrame(tick);
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      cancelAnimationFrame(raf);
      themeObserver.disconnect();
      window.removeEventListener("resize", onResize);
      window.removeEventListener("pointermove", onMove);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  return <canvas ref={canvasRef} className={className} aria-hidden="true" style={opacity !== undefined ? { opacity } : undefined} />;
}
