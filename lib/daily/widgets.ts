// Interactive widgets for worked solutions. A question only names a built-in
// kind and its starting numbers (see SolutionWidget in types.ts); everything
// drawn and computed lives here and in components/daily/Widgets.tsx, so a pack
// can never ship code. The math is kept free of React so it can be tested.

import type { SolutionWidget, WidgetKind } from './types';

type Params = Record<string, number>;

export type WidgetParam = {
  symbol: string;
  label: string;
  unit?: string;
  /** Allowed values (inclusive). */
  min: number;
  max: number;
  /** Used when the widget leaves it out. Without one (and not `optional`), it's required. */
  fallback?: number;
  optional?: boolean;
  /** A slider, and the range it covers unless the widget gives `ranges`. */
  slider?: (value: number, params: Params) => [number, number];
};

export type WidgetSpec = { title: string; params: Record<string, WidgetParam> };

export const WIDGETS: Record<WidgetKind, WidgetSpec> = {
  step2: {
    title: 'Second-order step response',
    params: {
      zeta: { symbol: 'ζ', label: 'damping ratio', min: 0.01, max: 5, slider: (v) => [0.05, Math.max(2, v)] },
      wn: { symbol: 'ωn', label: 'natural frequency', unit: 'rad/s', min: 1e-3, max: 1e4, slider: (v) => [v / 4, v * 4] },
      K: { symbol: 'K', label: 'gain', min: 1e-6, max: 1e6, fallback: 1 },
      tMax: { symbol: 't', label: 'time axis', unit: 's', min: 1e-6, max: 1e6, optional: true },
    },
  },
  step1: {
    title: 'First-order plus dead time step response',
    params: {
      tau: { symbol: 'τ', label: 'time constant', unit: 's', min: 1e-6, max: 1e6, slider: (v) => [v / 5, v * 5] },
      theta: { symbol: 'θ', label: 'dead time', unit: 's', min: 0, max: 1e6, fallback: 0, slider: (v, p) => [0, Math.max(4 * v, 2 * p.tau)] },
      K: { symbol: 'K', label: 'gain', min: 1e-6, max: 1e6, fallback: 1 },
      tMax: { symbol: 't', label: 'time axis', unit: 's', min: 1e-6, max: 1e6, optional: true },
    },
  },
  bode2: {
    title: 'Second-order frequency response',
    params: {
      zeta: { symbol: 'ζ', label: 'damping ratio', min: 0.01, max: 5, slider: (v) => [0.05, Math.max(2, v)] },
      wn: { symbol: 'ωn', label: 'natural frequency', unit: 'rad/s', min: 1e-3, max: 1e4, slider: (v) => [v / 4, v * 4] },
      K: { symbol: 'K', label: 'gain', min: 1e-6, max: 1e6, fallback: 1 },
    },
  },
};

export const WIDGET_KINDS = Object.keys(WIDGETS) as WidgetKind[];

/** A round step (1, 2 or 5 × 10ⁿ) about `span / count` wide. */
export function niceStep(span: number, count = 200) {
  const raw = span / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  return [1, 2, 5, 10].map((m) => m * mag).find((s) => s >= raw * (1 - 1e-9))!;
}

/** The widget's params with fallbacks filled in. */
export function widgetParams(w: SolutionWidget): Params {
  const out: Params = {};
  for (const [key, p] of Object.entries(WIDGETS[w.kind].params)) {
    const v = w.params[key] ?? p.fallback;
    if (v !== undefined) out[key] = v;
  }
  return out;
}

export type Slider = { key: string; symbol: string; label: string; unit?: string; min: number; max: number; step: number };

/** The sliders a widget shows, with their ranges (the widget's own, or the kind's default). */
export function widgetSliders(w: SolutionWidget): Slider[] {
  const params = widgetParams(w);
  return Object.entries(WIDGETS[w.kind].params).flatMap(([key, p]) => {
    if (!p.slider) return [];
    const [lo, hi] = w.ranges?.[key] ?? p.slider(params[key], params).map((v) => Math.min(p.max, Math.max(p.min, v)));
    const step = niceStep(hi - lo);
    // Snap the ends to the step so the slider lands on round numbers.
    const min = Math.max(p.min, Math.floor(lo / step + 1e-9) * step);
    const max = Math.min(p.max, Math.ceil(hi / step - 1e-9) * step);
    return [{ key, symbol: p.symbol, label: p.label, ...(p.unit ? { unit: p.unit } : {}), min: Number(min.toPrecision(12)), max: Number(max.toPrecision(12)), step }];
  });
}

// ─── Second order: K ωn² / (s² + 2ζωn s + ωn²) ───────────────────────────────

/** Unit-step response, as a function of t. */
export function step2Response(zeta: number, wn: number, K = 1) {
  return (t: number) => {
    if (t <= 0) return 0;
    if (Math.abs(zeta - 1) < 1e-9) return K * (1 - Math.exp(-wn * t) * (1 + wn * t));
    if (zeta < 1) {
      const r = Math.sqrt(1 - zeta * zeta);
      return K * (1 - Math.exp(-zeta * wn * t) * (Math.cos(wn * r * t) + (zeta / r) * Math.sin(wn * r * t)));
    }
    const r = Math.sqrt(zeta * zeta - 1);
    const s1 = -wn * (zeta - r);
    const s2 = -wn * (zeta + r);
    return K * (1 + (s2 * Math.exp(s1 * t) - s1 * Math.exp(s2 * t)) / (s1 - s2));
  };
}

/** First time y(t)/K reaches `level`, interpolated between samples (null if never). */
function firstCrossing(y: (t: number) => number, level: number, horizon: number, n: number) {
  const dt = horizon / n;
  let prev = y(0);
  for (let i = 1; i <= n; i++) {
    const cur = y(i * dt);
    if (cur >= level) return (i - 1 + (level - prev) / (cur - prev || 1)) * dt;
    prev = cur;
  }
  return null;
}

/** Last time y(t) is outside ±band of the final value, interpolated (0 if never). */
function settlingTime(y: (t: number) => number, final: number, band: number, horizon: number, n: number) {
  const dt = horizon / n;
  const out = (t: number) => Math.abs(y(t) - final) - band;
  for (let i = n - 1; i >= 0; i--) {
    const a = out(i * dt);
    if (a > 0) {
      const b = out((i + 1) * dt);
      return (i + a / (a - b || 1)) * dt;
    }
  }
  return 0;
}

export type Step2Metrics = {
  /** Fractional overshoot (0.25 = 25 %); 0 when it doesn't overshoot. */
  overshoot: number;
  peakTime: number | null;
  rise1090: number;
  /** 0 → 100 % rise time (underdamped only). */
  rise0100: number | null;
  /** Exact 2 % settling time. */
  settling: number;
  /** The textbook estimate 4/(ζωn) (meant for underdamped loops). */
  settlingApprox: number;
  /** Damped frequency (underdamped only). */
  wd: number | null;
  /** Pole real parts and imaginary part magnitude: [σ1, σ2, ω]. */
  poles: { re: [number, number]; im: number };
};

/** Times and overshoot depend only on ζ and ωn (K just scales the output). */
export function step2Metrics(zeta: number, wn: number): Step2Metrics {
  const y = step2Response(zeta, wn, 1);
  const r = Math.sqrt(Math.abs(1 - zeta * zeta));
  // Long enough for the slowest pole to die away well inside the 2 % band.
  const slowest = zeta < 1 ? zeta * wn : wn * (zeta - Math.sqrt(Math.max(0, zeta * zeta - 1)));
  const horizon = 12 / slowest;
  const n = 20000;
  const under = zeta < 1;
  const wd = under ? wn * r : null;
  return {
    overshoot: under ? Math.exp((-zeta * Math.PI) / r) : 0,
    peakTime: wd ? Math.PI / wd : null,
    rise1090: firstCrossing(y, 0.9, horizon, n)! - firstCrossing(y, 0.1, horizon, n)!,
    rise0100: wd ? (Math.PI - Math.acos(zeta)) / wd : null,
    settling: settlingTime(y, 1, 0.02, horizon, n),
    settlingApprox: 4 / (zeta * wn),
    wd,
    poles: under ? { re: [-zeta * wn, -zeta * wn], im: wn * r } : { re: [-wn * (zeta - r), -wn * (zeta + r)], im: 0 },
  };
}

/** Magnitude (dB) and phase (degrees) at frequency w. */
export function bode2At(zeta: number, wn: number, K: number, w: number) {
  const re = wn * wn - w * w;
  const im = 2 * zeta * wn * w;
  return { db: 20 * Math.log10((K * wn * wn) / Math.hypot(re, im)), phase: (-Math.atan2(im, re) * 180) / Math.PI };
}

export function bode2Metrics(zeta: number, wn: number, K = 1) {
  const resonant = zeta < Math.SQRT1_2;
  const z2 = zeta * zeta;
  return {
    dcDb: 20 * Math.log10(K),
    /** Resonant peak above the DC gain (dB), and where it is; null when there's none. */
    peakDb: resonant ? -20 * Math.log10(2 * zeta * Math.sqrt(1 - z2)) : null,
    wr: resonant ? wn * Math.sqrt(1 - 2 * z2) : null,
    /** Where the magnitude falls 3 dB below the DC gain. */
    bandwidth: wn * Math.sqrt(1 - 2 * z2 + Math.sqrt(4 * z2 * z2 - 4 * z2 + 2)),
  };
}

// ─── First order plus dead time: K e^(−θs) / (τs + 1) ────────────────────────

export function step1Response(tau: number, K = 1, theta = 0) {
  return (t: number) => (t <= theta ? 0 : K * (1 - Math.exp(-(t - theta) / tau)));
}

export function step1Metrics(tau: number, theta = 0) {
  return {
    /** 63.2 % of the way there. */
    t63: theta + tau,
    rise1090: tau * Math.log(9),
    /** Exact 2 % settling time, and the θ + 4τ rule of thumb. */
    settling: theta + tau * Math.log(50),
    settlingRule: theta + 4 * tau,
    /** Dead time over time constant: above about 1 the loop gets hard to control. */
    ratio: theta / tau,
  };
}

/** A round number at or just above v, for axis limits. */
export function niceCeil(v: number) {
  const mag = 10 ** Math.floor(Math.log10(v));
  return [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10].map((m) => m * mag).find((x) => x >= v * (1 - 1e-9))!;
}
