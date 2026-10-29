'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';

// A small SVG line chart for Loop Lab: linear or log axes, several series,
// guide lines and markers, and a hover readout. Long traces are thinned to
// about two points per pixel (keeping each bucket's min and max, so spikes
// and noise bands still show).

export type Series = {
  label: string;
  color: string;
  x: ArrayLike<number>;
  y: ArrayLike<number>;
  dash?: string;
  width?: number;
  /** Not listed in the legend or the hover readout. */
  quiet?: boolean;
};

export type Axis = { label?: string; log?: boolean; min?: number; max?: number; unit?: string };
export type Guide = { at: number; label?: string; color?: string; dash?: string };
export type Marker = { x: number; y: number; color: string; shape?: 'x' | 'o' | 'dot'; label?: string };

export const fmt = (v: number, sig = 3) => {
  if (!Number.isFinite(v)) return v > 0 ? '∞' : v < 0 ? '−∞' : '—';
  const n = Number(v.toPrecision(sig));
  const a = Math.abs(n);
  const s = a !== 0 && (a < 1e-3 || a >= 1e5) ? n.toExponential(Math.max(0, sig - 1)).replace('e+', 'e') : (Object.is(n, -0) ? 0 : n).toString();
  return s.replace('-', '−');
};

function niceTicks(min: number, max: number, count: number) {
  if (!(max > min)) return [min];
  const raw = (max - min) / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw;
  const out: number[] = [];
  for (let v = Math.ceil(min / step - 1e-9) * step; v <= max + step * 1e-9; v += step) {
    out.push(Math.abs(v) < step * 1e-6 ? 0 : Number(v.toPrecision(12)));
  }
  return out;
}

function useWidth() {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(560);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.max(200, Math.round(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width] as const;
}

function extent(series: Series[], key: 'x' | 'y', log: boolean) {
  let lo = Infinity, hi = -Infinity;
  for (const s of series) for (let i = 0; i < s[key].length; i++) {
    const v = s[key][i];
    if (!Number.isFinite(v) || (log && v <= 0)) continue;
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  return [lo, hi];
}

/** First index with x ≥ v (x ascending). */
function lowerBound(x: ArrayLike<number>, v: number) {
  let lo = 0, hi = x.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (x[mid] < v) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** Data → pixel mappings for a plot area. */
function makeScale(left: number, top: number, w: number, h: number, xmin: number, xmax: number, ymin: number, ymax: number, log: boolean) {
  const lx = (v: number) => (log ? Math.log10(v) : v);
  const px = (v: number) => left + ((lx(v) - lx(xmin)) / (lx(xmax) - lx(xmin) || 1)) * w;
  const py = (v: number) => top + (1 - (v - ymin) / (ymax - ymin || 1)) * h;
  const clampY = (v: number) => Math.min(top + h + 40, Math.max(top - 40, py(v)));
  return { lx, px, py, clampY };
}

export default function Chart({
  series, x, y, height = 200, hGuides = [], vGuides = [], markers = [], legend = true, label, yPad = 0.06,
}: {
  series: Series[]; x: Axis; y: Axis; height?: number; hGuides?: Guide[]; vGuides?: Guide[]; markers?: Marker[];
  legend?: boolean; label: string; yPad?: number;
}) {
  const [ref, width] = useWidth();
  const clip = `ll-clip${useId().replace(/[^\w-]/g, '')}`;
  const [hover, setHover] = useState<number | null>(null);
  const m = { l: 52, r: 12, t: 10, b: x.label ? 34 : 22 };
  const w = Math.max(60, width - m.l - m.r);
  const h = height - m.t - m.b;

  const [xmin, xmax] = useMemo(() => {
    let [a, b] = extent(series, 'x', !!x.log);
    // No data yet (or a single point): show an empty range rather than NaN.
    if (!Number.isFinite(a) || !Number.isFinite(b)) [a, b] = x.log ? [1, 10] : [0, 1];
    if (b <= a) b = x.log ? a * 10 : a + 1;
    return [x.min ?? a, x.max ?? b];
  }, [series, x.min, x.max, x.log]);
  const [ymin, ymax] = useMemo(() => {
    let [a, b] = extent(series, 'y', !!y.log);
    for (const mk of markers) { a = Math.min(a, mk.y); b = Math.max(b, mk.y); }
    for (const g of hGuides) { a = Math.min(a, g.at); b = Math.max(b, g.at); }
    if (!Number.isFinite(a)) { a = 0; b = 1; }
    if (b - a < 1e-12) { a -= 1; b += 1; }
    const pad = (b - a) * yPad;
    return [y.min ?? a - pad, y.max ?? b + pad];
  }, [series, markers, hGuides, y.min, y.max, y.log, yPad]);

  const { lx, px, py, clampY } = useMemo(() => makeScale(m.l, m.t, w, h, xmin, xmax, ymin, ymax, !!x.log), [m.l, m.t, w, h, xmin, xmax, ymin, ymax, x.log]);

  const paths = useMemo(() => series.map((s) => {
    const n = Math.min(s.x.length, s.y.length);
    const parts: string[] = [];
    const buckets = Math.max(1, Math.floor(w * 2));
    if (n <= buckets * 2) {
      let pen = false;
      for (let i = 0; i < n; i++) {
        const xv = s.x[i], yv = s.y[i];
        if (!Number.isFinite(yv) || !Number.isFinite(xv) || (x.log && xv <= 0)) { pen = false; continue; }
        parts.push(`${pen ? 'L' : 'M'}${px(xv).toFixed(1)} ${clampY(yv).toFixed(1)}`);
        pen = true;
      }
    } else {
      // Min/max per bucket, in time order.
      const per = n / buckets;
      for (let b = 0; b < buckets; b++) {
        const i0 = Math.floor(b * per), i1 = Math.min(n, Math.floor((b + 1) * per));
        let iMin = i0, iMax = i0;
        for (let i = i0; i < i1; i++) {
          if (s.y[i] < s.y[iMin]) iMin = i;
          if (s.y[i] > s.y[iMax]) iMax = i;
        }
        const [a, c] = iMin < iMax ? [iMin, iMax] : [iMax, iMin];
        for (const i of a === c ? [a] : [a, c]) parts.push(`${parts.length ? 'L' : 'M'}${px(s.x[i]).toFixed(1)} ${clampY(s.y[i]).toFixed(1)}`);
      }
    }
    return parts.join('');
  }), [series, w, px, clampY, x.log]);

  const xTicks = x.log
    ? Array.from({ length: Math.floor(Math.log10(xmax)) - Math.ceil(Math.log10(xmin)) + 1 }, (_, i) => 10 ** (Math.ceil(Math.log10(xmin)) + i))
    : niceTicks(xmin, xmax, Math.max(3, Math.round(w / 80)));
  const yTicks = niceTicks(ymin, ymax, Math.max(3, Math.round(h / 40)));

  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const cx = e.clientX - r.left;
    if (cx < m.l || cx > m.l + w) { setHover(null); return; }
    const f = (cx - m.l) / w;
    setHover(x.log ? 10 ** (lx(xmin) + f * (lx(xmax) - lx(xmin))) : xmin + f * (xmax - xmin));
  };
  const readout = hover === null ? [] : series.filter((s) => !s.quiet && s.x.length).map((s) => {
    const i = Math.min(s.x.length - 1, lowerBound(s.x, hover));
    return { s, x: s.x[i], y: s.y[i] };
  });

  return (
    <div ref={ref} className="ll-chart">
      {legend && series.some((s) => !s.quiet) && (
        <div className="ll-legend">
          {series.filter((s) => !s.quiet).map((s, i) => (
            <span key={`${s.label}${i}`}><i style={{ background: s.color, opacity: s.dash ? 0.6 : 1 }} />{s.label}</span>
          ))}
        </div>
      )}
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={label}
        onPointerMove={onMove} onPointerLeave={() => setHover(null)}>
        <defs><clipPath id={clip}><rect x={m.l} y={m.t} width={w} height={h} /></clipPath></defs>
        <g className="ll-grid">
          {xTicks.map((t) => <line key={`x${t}`} x1={px(t)} x2={px(t)} y1={m.t} y2={m.t + h} />)}
          {yTicks.map((t) => <line key={`y${t}`} x1={m.l} x2={m.l + w} y1={py(t)} y2={py(t)} />)}
        </g>
        <g className="ll-ticks">
          {xTicks.map((t) => <text key={`x${t}`} x={px(t)} y={m.t + h + 14} textAnchor="middle">{fmt(t, 3)}</text>)}
          {yTicks.map((t) => <text key={`y${t}`} x={m.l - 6} y={py(t) + 4} textAnchor="end">{fmt(t, 3)}</text>)}
          {x.label && <text className="ll-axis" x={m.l + w / 2} y={height - 4} textAnchor="middle">{x.label}</text>}
          {y.label && <text className="ll-axis" transform={`translate(12 ${m.t + h / 2}) rotate(-90)`} textAnchor="middle">{y.label}</text>}
        </g>
        <g clipPath={`url(#${clip})`}>
          {hGuides.map((g, i) => <line key={`h${i}`} className="ll-guide" style={{ stroke: g.color, strokeDasharray: g.dash }} x1={m.l} x2={m.l + w} y1={py(g.at)} y2={py(g.at)} />)}
          {vGuides.filter((g) => g.at >= xmin && g.at <= xmax).map((g, i) => <line key={`v${i}`} className="ll-guide" style={{ stroke: g.color, strokeDasharray: g.dash }} x1={px(g.at)} x2={px(g.at)} y1={m.t} y2={m.t + h} />)}
          {paths.map((d, i) => (
            <path key={i} d={d} fill="none" stroke={series[i].color} strokeWidth={series[i].width ?? 1.8} strokeDasharray={series[i].dash} strokeLinejoin="round" />
          ))}
          {markers.map((mk, i) => {
            const cx = px(mk.x), cy = py(mk.y);
            if (mk.shape === 'x') return <path key={i} d={`M${cx - 5} ${cy - 5}L${cx + 5} ${cy + 5}M${cx - 5} ${cy + 5}L${cx + 5} ${cy - 5}`} stroke={mk.color} strokeWidth={2} />;
            if (mk.shape === 'o') return <circle key={i} cx={cx} cy={cy} r={5} fill="none" stroke={mk.color} strokeWidth={2} />;
            return <circle key={i} cx={cx} cy={cy} r={4} fill={mk.color} />;
          })}
        </g>
        <g className="ll-guide-labels">
          {hGuides.filter((g) => g.label && g.at >= ymin && g.at <= ymax).map((g, i) => <text key={`h${i}`} x={m.l + w - 4} y={py(g.at) - 4} textAnchor="end">{g.label}</text>)}
          {vGuides.filter((g) => g.label && g.at >= xmin && g.at <= xmax).map((g, i) => {
            const right = px(g.at) > m.l + w - 60;
            return <text key={`v${i}`} x={px(g.at) + (right ? -4 : 4)} y={m.t + 12 + (i % 3) * 12} textAnchor={right ? 'end' : 'start'}>{g.label}</text>;
          })}
          {markers.filter((mk) => mk.label).map((mk, i) => <text key={`m${i}`} x={px(mk.x) + 7} y={py(mk.y) - 7}>{mk.label}</text>)}
        </g>
        {hover !== null && (
          <line className="ll-hover" x1={px(hover)} x2={px(hover)} y1={m.t} y2={m.t + h} />
        )}
      </svg>
      {readout.length > 0 && (
        <div className="ll-readout" aria-live="polite">
          <span>{x.label ? `${x.label.split(' ')[0]} ` : ''}{fmt(readout[0].x, 4)}</span>
          {readout.map(({ s, y: v }, i) => <span key={i}><i style={{ background: s.color }} />{s.label} {fmt(v, 4)}</span>)}
        </div>
      )}
    </div>
  );
}
