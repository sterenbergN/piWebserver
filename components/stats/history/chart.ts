// Small drawing helpers shared by the history charts: hand-written SVG, so no chart library.
import { useEffect, useRef, useState } from 'react';

export type Pt = [number, number];

const f = (n: number) => (Math.round(n * 10) / 10).toString();
const pt = (p: Pt) => `${f(p[0])},${f(p[1])}`;

// Fritsch–Carlson tangents: a smooth curve that never overshoots, so a total that only grows
// never appears to dip between two points.
function tangents(p: Pt[]) {
  const n = p.length;
  const d: number[] = [];
  for (let i = 0; i < n - 1; i++) d.push((p[i + 1][1] - p[i][1]) / (p[i + 1][0] - p[i][0] || 1));
  const m = new Array<number>(n).fill(0);
  m[0] = d[0];
  m[n - 1] = d[n - 2];
  for (let i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2;
  for (let i = 0; i < n - 1; i++) {
    if (d[i] === 0) { m[i] = 0; m[i + 1] = 0; continue; }
    const a = m[i] / d[i];
    const b = m[i + 1] / d[i];
    const s = a * a + b * b;
    if (s > 9) { const t = 3 / Math.sqrt(s); m[i] = t * a * d[i]; m[i + 1] = t * b * d[i]; }
  }
  return m;
}

/**
 * A smooth path through points sorted by x. `reverse` walks it right to left (for the far edge
 * of a band); `join` starts with a line instead of a move, to continue an existing path.
 */
export function smooth(p: Pt[], { reverse = false, join = false } = {}): string {
  if (!p.length) return '';
  const lead = join ? 'L' : 'M';
  if (p.length === 1) return `${lead}${pt(p[0])}`;
  const m = tangents(p);
  const segs: [Pt, Pt, Pt, Pt][] = [];
  for (let i = 0; i < p.length - 1; i++) {
    const h = (p[i + 1][0] - p[i][0]) / 3;
    segs.push([p[i], [p[i][0] + h, p[i][1] + m[i] * h], [p[i + 1][0] - h, p[i + 1][1] - m[i + 1] * h], p[i + 1]]);
  }
  if (!reverse) return `${lead}${pt(p[0])}${segs.map((s) => `C${pt(s[1])} ${pt(s[2])} ${pt(s[3])}`).join('')}`;
  return `${lead}${pt(p[p.length - 1])}${segs.reverse().map((s) => `C${pt(s[2])} ${pt(s[1])} ${pt(s[0])}`).join('')}`;
}

/** Round axis ticks: 0 and a few steps of 1, 2, 2.5 or 5 × a power of ten. */
export function niceTicks(max: number, count = 4): number[] {
  if (max <= 0) return [0];
  const raw = max / count;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((s) => s * pow).find((s) => s >= raw) ?? raw;
  const out: number[] = [];
  for (let v = 0; v <= max + step * 0.001; v += step) out.push(Math.round(v * 100) / 100);
  if (out[out.length - 1] < max) out.push(out[out.length - 1] + step);
  return out;
}

/** Charts draw at their real pixel width, so text stays the same size on a phone as on a desktop. */
export function useWidth<T extends HTMLElement>(fallback: number) {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(fallback);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    setWidth(Math.round(el.getBoundingClientRect().width) || fallback);
    const ro = new ResizeObserver(([e]) => { const w = Math.round(e.contentRect.width); if (w) setWidth(w); });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width] as const;
}

export const prefersReducedMotion = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/** Counts up to `target` once, easing out. Shows the final number straight away when motion is reduced. */
export function useCountUp(target: number, ms = 1400) {
  const [value, setValue] = useState(target);
  useEffect(() => {
    if (prefersReducedMotion() || target <= 0) { setValue(target); return; }
    let raf = 0;
    const t0 = performance.now();
    const tick = (t: number) => {
      const p = Math.min(1, (t - t0) / ms);
      setValue(Math.round(target * (1 - (1 - p) ** 3)));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, ms]);
  return value;
}

/** Pointer x inside an element, in its own pixels. */
export const localX = (e: { clientX: number; currentTarget: Element }) => e.clientX - e.currentTarget.getBoundingClientRect().left;

/** Index of the value in a sorted list closest to x. */
export function nearest(xs: number[], x: number) {
  let lo = 0;
  let hi = xs.length - 1;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (xs[mid] <= x) lo = mid; else hi = mid; }
  return Math.abs(xs[hi] - x) < Math.abs(xs[lo] - x) ? hi : lo;
}

/** Rough text width for SVG label placement (Inter at the given size). */
export const textWidth = (s: string, size = 11) => s.length * size * 0.56;

export function quietLabel(days: number) {
  if (days >= 45) return `${Math.round(days / 30)} quiet months`;
  if (days >= 14) return `${Math.round(days / 7)} quiet weeks`;
  return `${days} quiet days`;
}
