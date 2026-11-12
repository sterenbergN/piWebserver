import { instrumentParams, type Params, type ParamSpec, type ProcessDef } from '../model';

// A plant described only by an identified model: first or second order plus
// dead time, or an integrator plus dead time, in % of span per % of output.
// Filled in from a trend (the Identify tab) to try strategies on a real loop.
// The dead time is the transmitter's transport delay; the valve and
// transmitter lags are kept tiny because the identified model already has them.
// Test scripts are written in units of the model's own time scale
// (τ1 + τ2 + θ), so they fit a 5-second loop and a 2-hour one alike.
// The inner measurement is the plant after its first lag, for a cascade's inner loop (with a
// single lag it is the PV itself, ahead of the dead time). It carries the whole gain.
// With fits kept at several operating points (Identify), the plant follows all of them: its
// steady curve passes through each fit's operating point with that fit's gain as its slope, and
// its time constant moves between theirs with the PV. The dead time and the second lag are the
// middle fit's. K and τ1 then scale the whole curve, so drift tests and "model wrong" still work.

/** Up to this many fits make the curve. */
export const CURVE_POINTS = 5;

export type CurvePoint = { u: number; y: number; k: number; tau: number };

/** The curve's points from the parameters, sorted by output, or null when the plant is one linear model. */
export function curvePoints(p: Params): { pts: CurvePoint[]; mid: CurvePoint } | null {
  const n = Math.round(p.curveN ?? 0);
  if (n < 2 || p.integrating) return null;
  const all = Array.from({ length: Math.min(n, CURVE_POINTS) }, (_, i) => ({ u: p[`cU${i + 1}`], y: p[`cY${i + 1}`], k: p[`cK${i + 1}`], tau: p[`cT${i + 1}`] }));
  const mid = all[Math.min(all.length, Math.max(1, Math.round(p.curveMid ?? 1))) - 1];
  const pts = [...all].sort((a, b) => a.u - b.u);
  if (pts.some((q, i) => !Object.values(q).every(Number.isFinite) || q.tau <= 0 || (i > 0 && q.u - pts[i - 1].u < 1e-6))) return null;
  return { pts, mid };
}

/**
 * Slopes for a piecewise cubic through the points with their own gains as slopes, reined in
 * where they'd make the curve turn back (Fritsch–Carlson): fits whose gains don't agree with
 * the step between their operating points. Returns the slopes and whether any were reined in.
 */
export function curveSlopes(pts: CurvePoint[]) {
  const m = pts.map((q) => q.k);
  let limited = false;
  for (let i = 0; i < pts.length - 1; i++) {
    const d = (pts[i + 1].y - pts[i].y) / (pts[i + 1].u - pts[i].u);
    if (Math.abs(d) < 1e-12 || Math.sign(m[i]) !== Math.sign(d) || Math.sign(m[i + 1]) !== Math.sign(d)) continue;
    const a = m[i] / d, b = m[i + 1] / d, r = a * a + b * b;
    if (r > 9) {
      const t = 3 / Math.sqrt(r);
      m[i] = t * a * d; m[i + 1] = t * b * d;
      limited = true;
    }
  }
  return { m, limited };
}

/** The steady PV (% of span) for an output (%), on the curve. */
export function curveAt(pts: CurvePoint[], m: number[], u: number) {
  const last = pts.length - 1;
  if (u <= pts[0].u) return pts[0].y + m[0] * (u - pts[0].u);
  if (u >= pts[last].u) return pts[last].y + m[last] * (u - pts[last].u);
  let i = 0;
  while (u > pts[i + 1].u) i++;
  const h = pts[i + 1].u - pts[i].u, s = (u - pts[i].u) / h;
  const h00 = 2 * s ** 3 - 3 * s ** 2 + 1, h10 = s ** 3 - 2 * s ** 2 + s, h01 = -2 * s ** 3 + 3 * s ** 2, h11 = s ** 3 - s ** 2;
  return h00 * pts[i].y + h10 * h * m[i] + h01 * pts[i + 1].y + h11 * h * m[i + 1];
}

/** The time constant at a PV: straight lines between the fits', the end ones beyond them. */
function tauAt(pts: CurvePoint[], y: number) {
  const byY = [...pts].sort((a, b) => a.y - b.y);
  if (y <= byY[0].y) return byY[0].tau;
  const last = byY[byY.length - 1];
  if (y >= last.y) return last.tau;
  let i = 0;
  while (y > byY[i + 1].y) i++;
  const s = (y - byY[i].y) / (byY[i + 1].y - byY[i].y);
  return byY[i].tau + s * (byY[i + 1].tau - byY[i].tau);
}

type Shape = { pts: CurvePoint[]; m: number[]; mid: CurvePoint; kScale: number; tScale: number };
const SHAPE_KEYS = ['K', 'tau1', 'integrating', 'curveN', 'curveMid', ...Array.from({ length: CURVE_POINTS }, (_, i) => ['cU', 'cY', 'cK', 'cT'].map((c) => `${c}${i + 1}`)).flat()];
// The simulation asks every step, and changes parameters in place (a test's "gain +40 %"), so the
// curve is kept with the values it was made from and made again when any of them changes.
const shapes = new WeakMap<Params, { sig: number[]; s: Shape | null }>();
function shape(p: Params): Shape | null {
  if (!(p.curveN >= 2)) return null;
  const sig = SHAPE_KEYS.map((k) => p[k]);
  const kept = shapes.get(p);
  if (kept && kept.sig.every((v, i) => v === sig[i])) return kept.s;
  const c = curvePoints(p);
  const s = c ? { pts: c.pts, m: curveSlopes(c.pts).m, mid: c.mid, kScale: p.K / c.mid.k, tScale: p.tau1 / c.mid.tau } : null;
  shapes.set(p, { sig, s });
  return s;
}
const steadyPv = (s: Shape, u: number) => s.mid.y + s.kScale * (curveAt(s.pts, s.m, u) - s.mid.y);

/** The output that holds a PV on the curve (it is monotonic: the slopes all have one sign). */
function outputFor(s: Shape, pv: number) {
  const rising = s.kScale * s.m[0] > 0;
  let lo = -1000, hi = 1100;
  for (let i = 0; i < 80; i++) {
    const mid = (lo + hi) / 2;
    if ((steadyPv(s, mid) < pv) === rising) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}

const curveParams: ParamSpec[] = [
  { key: 'curveN', label: 'Fits on the curve', unit: '', default: 0, min: 0, max: CURVE_POINTS, step: 1, group: 'process', hidden: true },
  { key: 'curveMid', label: 'Reference fit', unit: '', default: 1, min: 1, max: CURVE_POINTS, step: 1, group: 'process', hidden: true },
  ...Array.from({ length: CURVE_POINTS }, (_, i) => [
    { key: `cU${i + 1}`, label: `Fit ${i + 1} output`, unit: '%', default: 0, min: -1000, max: 1000, group: 'process' as const, hidden: true },
    { key: `cY${i + 1}`, label: `Fit ${i + 1} PV`, unit: '%', default: 0, min: -1000, max: 1000, group: 'process' as const, hidden: true },
    { key: `cK${i + 1}`, label: `Fit ${i + 1} gain`, unit: '%/%', default: 1, min: -50, max: 50, group: 'process' as const, hidden: true },
    { key: `cT${i + 1}`, label: `Fit ${i + 1} time constant`, unit: 's', default: 20, min: 0.1, max: 1e5, group: 'process' as const, hidden: true },
  ]).flat(),
];

export const CUSTOM: ProcessDef = {
  id: 'custom',
  name: 'Your plant (identified)',
  icon: '📥',
  summary: 'A model identified from a trend: first or second order plus dead time, or an integrator. No physics, just the input–output behaviour of a real loop, to try strategies on before commissioning.',
  family: 'escalation',
  pv: { label: 'Process value', symbol: 'y', unit: '%', lo: 0, hi: 100, decimals: 2 },
  secondary: {
    label: 'Inner measurement', symbol: 'y_1', unit: '%', lo: 0, hi: 100, decimals: 2, tag: 'XT-101', loopTag: 'XIC-101',
    of: ([x1]) => x1,
  },
  tags: { loop: 'XIC-100', transmitter: 'XT-100', valve: 'XV-100' },
  states: [{ key: 'x1', label: 'First lag', unit: '%' }, { key: 'x2', label: 'Second lag', unit: '%' }],
  params: [
    { key: 'integrating', label: 'Model type', unit: '', default: 0, min: 0, max: 1, group: 'process',
      options: [{ value: 0, label: 'Self-regulating' }, { value: 1, label: 'Integrating' }] },
    { key: 'K', label: 'Process gain', symbol: 'K', unit: '%/%', default: 1, min: -50, max: 50, step: 0.01, group: 'process',
      note: 'Change in PV (% of span) per % of output at steady state. Integrating: K/τ1 is the ramp rate per % of output.' },
    { key: 'tau1', label: 'Time constant', symbol: 'τ_1', unit: 's', default: 20, min: 0.1, max: 1e5, step: 0.1, group: 'process' },
    { key: 'tau2', label: 'Second time constant', symbol: 'τ_2', unit: 's', default: 0, min: 0, max: 1e5, step: 0.1, group: 'process',
      note: '0 for a first-order model.' },
    { key: 'bias', label: 'PV at 0 % output', unit: '%', default: 0, min: -1000, max: 1000, step: 0.1, group: 'process',
      note: 'Self-regulating models: steady PV = bias + K × output.' },
    { key: 'u0', label: 'Balance output', unit: '%', default: 50, min: 0, max: 100, step: 0.1, group: 'process',
      note: 'Integrating models: the output that holds the PV still.' },
    ...instrumentParams({ valveTau: 0.1, valveRate: 1000, valveChar: 0, txTau: 0.1, txNoise: 0.3, txDelay: 5, Ts: 0.5, tx2Tau: 0.1 }),
    ...curveParams,
  ],
  disturbances: [
    { key: 'load', label: 'Load (at the output)', unit: '% of output', nominal: 0, min: -70, max: 70, note: 'An unmeasured upset, expressed as the output change that would cancel it.' },
  ],
  derivatives: ([x1, x2], flow, d, p) => {
    const u = 100 * flow + d.load;
    const s = shape(p);
    if (s) return [(steadyPv(s, u) - x1) / (s.tScale * tauAt(s.pts, x1)), p.tau2 > 0 ? (x1 - x2) / p.tau2 : 0];
    const dx1 = p.integrating ? (p.K / p.tau1) * (u - p.u0) : (p.bias + p.K * u - x1) / p.tau1;
    return [dx1, p.tau2 > 0 ? (x1 - x2) / p.tau2 : 0];
  },
  pvOf: ([x1, x2], _f, _d, p) => (p.tau2 > 0 ? x2 : x1),
  steady: (flow, d, p) => {
    if (p.integrating) return null;
    const s = shape(p);
    if (s) {
      const y = steadyPv(s, 100 * flow + d.load);
      return [y, y];
    }
    const y = p.bias + p.K * (100 * flow + d.load);
    return [y, y];
  },
  steadyAt: (pv, d, p) => {
    const s = shape(p);
    const u = s ? outputFor(s, pv) : p.integrating ? p.u0 : p.K !== 0 ? (pv - p.bias) / p.K : 50;
    const valve = Math.min(100, Math.max(0, u - d.load));
    return { valve, x: [pv, pv] };
  },
  timeScale: (p) => Math.max(0.5, p.tau1 + p.tau2 + p.txDelay),
  fastest: (p) => Math.min(p.tau1, p.tau2 > 0 ? p.tau2 : Infinity),
  opPoints: [30, 50, 70],
  nominalPv: 50,
  uncertain: [
    { key: 'K', spread: 0.3 },
    { key: 'tau1', spread: 0.3 },
    { key: 'txDelay', spread: 0.3 },
  ],
  scenarios: [
    {
      id: 'sp-steps', name: 'Setpoint steps', duration: 40, initialSp: 50,
      purpose: 'Setpoint steps around the identified operating point (times in units of τ1 + τ2 + θ).',
      events: [{ t: 1, kind: 'sp', value: 60 }, { t: 11, kind: 'sp', value: 40 }, { t: 21, kind: 'sp', value: 55 }, { t: 31, kind: 'sp', value: 50 }],
    },
    {
      id: 'load', name: 'Load upsets', duration: 30, initialSp: 50,
      purpose: 'An unmeasured upset worth 10 % of output, one way and then the other.',
      events: [{ t: 1, kind: 'dist', key: 'load', value: 10 }, { t: 11, kind: 'dist', key: 'load', value: -10 }, { t: 21, kind: 'dist', key: 'load', value: 0 }],
    },
    {
      id: 'noisy', name: 'Noisy measurement', duration: 20, initialSp: 50,
      purpose: '1.5 % noise on the reading: how much of it reaches the valve?',
      events: [{ t: 0, kind: 'param', key: 'txNoise', value: 1.5 }, { t: 1, kind: 'sp', value: 55 }],
    },
    {
      id: 'mismatch', name: 'Model wrong by 40 %', duration: 22, initialSp: 50,
      purpose: 'The real gain is 40 % higher and the dead time 50 % longer than identified: how much margin did the tuning leave?',
      events: [
        { t: 0, kind: 'param', key: 'K', factor: 1.4 }, { t: 0, kind: 'param', key: 'txDelay', factor: 1.5 },
        { t: 1, kind: 'sp', value: 60 }, { t: 11, kind: 'sp', value: 45 },
      ],
    },
    {
      id: 'saturation', name: 'Upset beyond the valve', duration: 22, initialSp: 50,
      purpose: 'A load bigger than the valve can cancel, then gone again: integral windup.',
      events: [{ t: 1, kind: 'dist', key: 'load', value: -60 }, { t: 11, kind: 'dist', key: 'load', value: 0 }],
    },
  ],
  characterizations: [],
};
