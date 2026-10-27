'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { SolutionWidget, WidgetKind } from '@/lib/daily/types';
import {
  WIDGETS, bode2At, bode2Metrics, niceCeil, step1Metrics, step1Response, step2Metrics, step2Response, widgetParams, widgetSliders, type Slider,
} from '@/lib/daily/widgets';

type Params = Record<string, number>;

/** 3 significant figures, with a real minus sign. */
const fmt = (v: number, sig = 3) => {
  const n = Number(v.toPrecision(sig));
  return (Object.is(n, -0) ? 0 : n).toString().replace('-', '−');
};
const SUP: Record<string, string> = { '-': '⁻', 0: '⁰', 1: '¹', 2: '²', 3: '³', 4: '⁴', 5: '⁵', 6: '⁶', 7: '⁷', 8: '⁸', 9: '⁹' };

// ─── A small line chart, drawn at the width it's given ───────────────────────

type Axis = { min: number; max: number; label: string; log?: boolean; ticks?: number[] };
type ChartSpec = {
  label: string;
  x: Axis;
  y: Axis;
  /** The live curve, and the question's own curve (dashed) once a slider has moved. */
  curve: [number, number][];
  ghost?: [number, number][];
  hlines?: { y: number; label?: string }[];
  vlines?: { x: number; label?: string }[];
  band?: [number, number];
  marks?: { x: number; y: number }[];
  height?: number;
};

/** About `count` round tick values (steps of 1, 2 or 5 × 10ⁿ) covering [min, max]. */
function ticks(min: number, max: number, count: number) {
  const raw = (max - min) / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 5, 10].map((m) => m * mag).find((s) => s >= raw)!;
  const out: number[] = [];
  for (let v = Math.ceil(min / step - 1e-9) * step; v <= max + step * 1e-9; v += step) out.push(Number(v.toPrecision(12)));
  return out;
}

const decades = (min: number, max: number) => {
  const out: number[] = [];
  for (let e = Math.ceil(Math.log10(min) - 1e-9); e <= Math.floor(Math.log10(max) + 1e-9); e++) out.push(e);
  return out;
};

function useWidth() {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(480);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.round(entry.contentRect.width)));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return [ref, width] as const;
}

function Chart({ label, x, y, curve, ghost, hlines = [], vlines = [], band, marks = [], height = 230 }: ChartSpec) {
  const [ref, width] = useWidth();
  const clip = `dq-clip${useId().replace(/[^\w-]/g, '')}`;
  const m = { l: 46, r: 14, t: 10, b: 38 };
  const w = Math.max(100, width - m.l - m.r);
  const h = height - m.t - m.b;
  const lx = (v: number) => (x.log ? Math.log10(v) : v);
  const px = (v: number) => m.l + ((lx(v) - lx(x.min)) / (lx(x.max) - lx(x.min))) * w;
  const py = (v: number) => m.t + (1 - (v - y.min) / (y.max - y.min)) * h;
  const path = (pts: [number, number][]) => pts.map(([a, b], i) => `${i ? 'L' : 'M'}${px(a).toFixed(1)} ${py(b).toFixed(1)}`).join('');
  const xTicks = x.log
    ? decades(x.min, x.max).map((e) => ({ v: 10 ** e, text: e >= -2 && e <= 3 ? fmt(10 ** e) : `10${String(e).split('').map((c) => SUP[c]).join('')}` }))
    : ticks(x.min, x.max, Math.max(3, Math.round(w / 75))).map((v) => ({ v, text: fmt(v) }));
  const yTicks = (y.ticks ?? ticks(y.min, y.max, 5)).map((v) => ({ v, text: fmt(v) }));
  const inX = (v: number) => v >= x.min && v <= x.max;

  return (
    <div ref={ref} className="dq-w-chart">
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={label}>
        <defs><clipPath id={clip}><rect x={m.l} y={m.t} width={w} height={h} /></clipPath></defs>
        <g className="dq-w-grid">
          {xTicks.map((t) => <line key={`x${t.v}`} x1={px(t.v)} x2={px(t.v)} y1={m.t} y2={m.t + h} />)}
          {yTicks.map((t) => <line key={`y${t.v}`} x1={m.l} x2={m.l + w} y1={py(t.v)} y2={py(t.v)} />)}
        </g>
        <g className="dq-w-ticks">
          {xTicks.map((t) => <text key={`x${t.v}`} x={px(t.v)} y={m.t + h + 15} textAnchor="middle">{t.text}</text>)}
          {yTicks.map((t) => <text key={`y${t.v}`} x={m.l - 6} y={py(t.v) + 4} textAnchor="end">{t.text}</text>)}
          <text className="dq-w-axis-label" x={m.l + w / 2} y={height - 4} textAnchor="middle">{x.label}</text>
          <text className="dq-w-axis-label" transform={`translate(12 ${m.t + h / 2}) rotate(-90)`} textAnchor="middle">{y.label}</text>
        </g>
        <g clipPath={`url(#${clip})`}>
          {band && <rect className="dq-w-band" x={m.l} width={w} y={py(band[1])} height={Math.max(1, py(band[0]) - py(band[1]))} />}
          {hlines.map((l, i) => <line key={`h${i}`} className="dq-w-guide" x1={m.l} x2={m.l + w} y1={py(l.y)} y2={py(l.y)} />)}
          {vlines.filter((l) => inX(l.x)).map((l, i) => <line key={`v${i}`} className="dq-w-guide" x1={px(l.x)} x2={px(l.x)} y1={m.t} y2={m.t + h} />)}
          {ghost && <path className="dq-w-ghost" d={path(ghost)} />}
          <path className="dq-w-curve" d={path(curve)} />
          {marks.filter((p) => inX(p.x)).map((p, i) => <circle key={i} className="dq-w-mark" cx={px(p.x)} cy={py(p.y)} r={4} />)}
        </g>
        <g className="dq-w-labels">
          {hlines.filter((l) => l.label && l.y >= y.min && l.y <= y.max).map((l, i) => <text key={`h${i}`} x={m.l + w - 4} y={py(l.y) - 4} textAnchor="end">{l.label}</text>)}
          {vlines.filter((l) => l.label && inX(l.x)).map((l, i) => {
            // Labels alternate rows so two lines close together don't print on top of each other.
            const right = px(l.x) > m.l + w - 40;
            return <text key={`v${i}`} x={px(l.x) + (right ? -4 : 4)} y={m.t + 12 + (i % 2) * 13} textAnchor={right ? 'end' : 'start'}>{l.label}</text>;
          })}
        </g>
      </svg>
    </div>
  );
}

function sample(fn: (t: number) => number, min: number, max: number, log = false, n = 400): [number, number][] {
  return Array.from({ length: n + 1 }, (_, i) => {
    const t = log ? 10 ** (Math.log10(min) + ((Math.log10(max) - Math.log10(min)) * i) / n) : min + ((max - min) * i) / n;
    return [t, fn(t)];
  });
}

// ─── The kinds ────────────────────────────────────────────────────────────────

type Stat = { label: string; value: string; sub?: string };
type View = { charts: ChartSpec[]; stats: Stat[] };
type Build = (v: Params, start: Params, changed: boolean, sliders: Slider[]) => View;

const s = (v: number) => `${fmt(v)} s`;
const rad = (v: number) => `${fmt(v)} rad/s`;

const VIEWS: Record<WidgetKind, Build> = {
  step2: (v, start, changed, sliders) => {
    const { zeta, wn, K } = v;
    const mt = step2Metrics(zeta, wn);
    const tMax = start.tMax ?? niceCeil(1.5 * step2Metrics(start.zeta, start.wn).settling);
    // Room for the most overshoot the ζ slider can reach, so the axis never jumps.
    const zMin = sliders.find((x) => x.key === 'zeta')?.min ?? start.zeta;
    const yMax = K * Math.ceil(5 * (1 + (zMin < 1 ? Math.exp((-zMin * Math.PI) / Math.sqrt(1 - zMin * zMin)) : 0)) + 0.5) / 5;
    const under = zeta < 1;
    return {
      charts: [{
        label: `Step response for ζ = ${fmt(zeta)} and ωn = ${fmt(wn)} rad/s`,
        x: { min: 0, max: tMax, label: 'Time t (s)' },
        y: { min: 0, max: yMax, label: 'Output y' },
        curve: sample(step2Response(zeta, wn, K), 0, tMax),
        ghost: changed ? sample(step2Response(start.zeta, start.wn, start.K), 0, tMax) : undefined,
        band: [0.98 * K, 1.02 * K],
        hlines: [{ y: K, label: K === 1 ? 'Setpoint' : `Final value ${fmt(K)}` }],
        vlines: [...(mt.peakTime ? [{ x: mt.peakTime, label: 'tp' }] : []), { x: mt.settling, label: 'ts' }],
        marks: mt.peakTime ? [{ x: mt.peakTime, y: K * (1 + mt.overshoot) }] : [],
      }],
      stats: [
        { label: 'Overshoot', value: under ? `${fmt(mt.overshoot * 100)} %` : 'None', sub: under ? `peaks at ${fmt(K * (1 + mt.overshoot))}` : 'ζ ≥ 1 never overshoots' },
        { label: 'Peak time tp', value: mt.peakTime ? s(mt.peakTime) : '—', sub: mt.peakTime ? 'π / ωd' : 'no peak' },
        { label: 'Rise time (10–90 %)', value: s(mt.rise1090), sub: mt.rise0100 ? `0 → 100 %: ${s(mt.rise0100)}` : undefined },
        { label: 'Settling time (2 %)', value: s(mt.settling), sub: under ? `estimate 4 / ζωn = ${s(mt.settlingApprox)}` : undefined },
        {
          label: 'Poles',
          value: under ? `${fmt(mt.poles.re[0])} ± j${fmt(mt.poles.im)}` : zeta === 1 ? `${fmt(mt.poles.re[0])} (double)` : `${fmt(mt.poles.re[0])}, ${fmt(mt.poles.re[1])}`,
          sub: under ? `rings at ωd = ${rad(mt.wd!)}` : zeta === 1 ? 'critically damped' : 'overdamped: two real poles',
        },
      ],
    };
  },

  step1: (v, start, changed) => {
    const { tau, theta, K } = v;
    const mt = step1Metrics(tau, theta);
    const tMax = start.tMax ?? niceCeil(1.4 * (start.theta + 5 * start.tau));
    return {
      charts: [{
        label: `Step response for τ = ${fmt(tau)} s and θ = ${fmt(theta)} s`,
        x: { min: 0, max: tMax, label: 'Time t (s)' },
        y: { min: 0, max: 1.2 * K, label: 'Output y' },
        curve: sample(step1Response(tau, K, theta), 0, tMax, false, 600),
        ghost: changed ? sample(step1Response(start.tau, start.K, start.theta), 0, tMax, false, 600) : undefined,
        band: [0.98 * K, 1.02 * K],
        hlines: [{ y: K, label: K === 1 ? 'Final value' : `Final value ${fmt(K)}` }],
        vlines: [...(theta > 0 ? [{ x: theta, label: 'θ' }] : []), { x: mt.t63, label: 'θ + τ' }, { x: mt.settling, label: 'ts' }],
        marks: [{ x: mt.t63, y: K * (1 - Math.exp(-1)) }],
      }],
      stats: [
        { label: '63 % point', value: s(mt.t63), sub: `θ + τ, where y = ${fmt(0.632 * K)}` },
        { label: 'Rise time (10–90 %)', value: s(mt.rise1090), sub: 'τ · ln 9 ≈ 2.2 τ' },
        { label: 'Settling time (2 %)', value: s(mt.settling), sub: `rule of thumb θ + 4τ = ${s(mt.settlingRule)}` },
        { label: 'θ / τ', value: fmt(mt.ratio, 2), sub: mt.ratio > 1 ? 'dead-time dominant: hard to control tightly' : 'lag-dominant' },
      ],
    };
  },

  bode2: (v, start, changed, sliders) => {
    const { zeta, wn, K } = v;
    const mt = bode2Metrics(zeta, wn, K);
    const wMin = 10 ** Math.floor(Math.log10(start.wn / 50));
    const wMax = 10 ** Math.ceil(Math.log10(start.wn * 50));
    const zMin = sliders.find((x) => x.key === 'zeta')?.min ?? start.zeta;
    const top = mt.dcDb + Math.max(10, Math.ceil((bode2Metrics(zMin, 1).peakDb ?? 0) / 5) * 5 + 5);
    const mag = (z: number, n: number, k: number) => (w: number) => bode2At(z, n, k, w).db;
    const phase = (z: number, n: number) => (w: number) => bode2At(z, n, 1, w).phase;
    const os = zeta < 1 ? Math.exp((-zeta * Math.PI) / Math.sqrt(1 - zeta * zeta)) : 0;
    const x = { min: wMin, max: wMax, label: 'Frequency ω (rad/s)', log: true };
    return {
      charts: [
        {
          label: `Magnitude for ζ = ${fmt(zeta)} and ωn = ${fmt(wn)} rad/s`,
          x, y: { min: top - 80, max: top, label: 'Magnitude (dB)' },
          curve: sample(mag(zeta, wn, K), wMin, wMax, true),
          ghost: changed ? sample(mag(start.zeta, start.wn, start.K), wMin, wMax, true) : undefined,
          hlines: [{ y: mt.dcDb - 3, label: '−3 dB' }],
          vlines: [{ x: mt.bandwidth, label: 'ωBW' }],
          marks: mt.wr ? [{ x: mt.wr, y: mt.dcDb + mt.peakDb! }] : [],
          height: 200,
        },
        {
          label: `Phase for ζ = ${fmt(zeta)} and ωn = ${fmt(wn)} rad/s`,
          x, y: { min: -180, max: 0, label: 'Phase (°)', ticks: [-180, -135, -90, -45, 0] },
          curve: sample(phase(zeta, wn), wMin, wMax, true),
          ghost: changed ? sample(phase(start.zeta, start.wn), wMin, wMax, true) : undefined,
          hlines: [{ y: -90 }],
          vlines: [{ x: wn, label: 'ωn' }],
          marks: [{ x: wn, y: -90 }],
          height: 170,
        },
      ],
      stats: [
        { label: 'Resonant peak', value: mt.peakDb !== null ? `+${fmt(mt.peakDb)} dB` : 'None', sub: mt.wr ? `at ωr = ${rad(mt.wr)}` : 'ζ ≥ 0.707 has no peak' },
        { label: 'Bandwidth (−3 dB)', value: rad(mt.bandwidth), sub: `${fmt(mt.bandwidth / wn)} × ωn` },
        { label: 'Phase at ωn', value: '−90°', sub: 'whatever ζ is' },
        { label: 'Step overshoot', value: `${fmt(os * 100)} %`, sub: 'same ζ, in the time domain' },
      ],
    };
  },
};

// ─── The widget ───────────────────────────────────────────────────────────────

/** An interactive simulator in a worked solution: sliders, a live plot and live readouts. */
export function SolutionWidgetView({ widget }: { widget: SolutionWidget }) {
  const start = useMemo(() => widgetParams(widget), [widget]);
  const sliders = useMemo(() => widgetSliders(widget), [widget]);
  const [values, setValues] = useState(start);
  const spec = WIDGETS[widget.kind];
  const changed = sliders.some((x) => values[x.key] !== start[x.key]);
  const view = VIEWS[widget.kind](values, start, changed, sliders);

  return (
    <div className="dq-widget" role="group" aria-label={`Interactive: ${spec.title}`}>
      <div className="dq-widget-head">
        <div>
          <span className="dq-eyebrow">Try it</span>
          <strong>{spec.title}</strong>
        </div>
        <button type="button" className="dq-small-btn" disabled={!changed} onClick={() => setValues(start)}>Reset</button>
      </div>
      <div className="dq-w-sliders">
        {sliders.map((x) => (
          <label key={x.key} className="dq-w-slider">
            <span className="dq-w-slider-name">{x.symbol} <span className="dq-hint">{x.label}</span></span>
            <output>{fmt(values[x.key])}{x.unit ? ` ${x.unit}` : ''}</output>
            <input type="range" min={x.min} max={x.max} step={x.step} value={values[x.key]}
              aria-valuetext={`${fmt(values[x.key])}${x.unit ? ` ${x.unit}` : ''}`}
              onChange={(e) => {
                const next = Number(Number(e.target.value).toPrecision(10));
                setValues((old) => ({ ...old, [x.key]: next }));
              }} />
          </label>
        ))}
      </div>
      {view.charts.map((c, i) => <Chart key={i} {...c} />)}
      <p className="dq-w-legend">
        <span className="dq-w-key is-curve" /> Your values
        {changed && <><span className="dq-w-key is-ghost" /> The question’s values</>}
      </p>
      <dl className="dq-w-stats">
        {view.stats.map((st) => (
          <div key={st.label}>
            <dt>{st.label}</dt>
            <dd>{st.value}</dd>
            {st.sub && <dd className="dq-w-sub">{st.sub}</dd>}
          </div>
        ))}
      </dl>
      {widget.caption && <p className="dq-w-caption">{widget.caption}</p>}
    </div>
  );
}
