import { linearControllerAt, type ControllerConfig, type FeedforwardTerm, type LinearController, type LinearPid } from './controllers';
import { c2d, cabs, carg, cdiv, cexpj, cmul, cx, eig, rng, solve, solveShifted, zeros, type Complex, type Mat } from './linalg';
import { cleanParams, nominalDisturbances, pvSpan, type Params, type ProcessDef } from './model';
import { findSteady, plantDerivatives, steadyState, truePv } from './sim';

// Linear analysis: linearize the nonlinear plant at an operating point the
// way you would on paper (Jacobian at steady state), then the classical tools:
// frequency response, margins, closed-loop poles and step responses.
// Signals are in % (valve signal in, % of transmitter span out); disturbances
// in their own units.

export type PlantModel = {
  /** Operating point the model is taken at. */
  pv: number;
  valve: number;
  /** False when the PV can't be reached (valve fully open or shut). */
  reachable: boolean;
  A: Mat;
  B: number[];
  /** Transmitter reading, % of span. */
  C: number[];
  /** True process value, % of span. */
  Ctrue: number[];
  /** Secondary (inner-loop) reading, % of its span; null when the process has none. */
  C2: number[] | null;
  /** How each disturbance enters the state equations (per unit of the disturbance). */
  Bd: Record<string, number[]>;
  /** Direct effect of each disturbance on the true PV (% of span per unit), for algebraic processes. */
  Dd: Record<string, number>;
  /** Transport delay, s. */
  theta: number;
  poles: Complex[];
  /** Static gain, % per % (Infinity for an integrating plant). */
  K: number;
  /** Which of the full plant states ([valve, ...process, reading, (secondary reading)]) the model kept. */
  keep: number[];
};

export function linearizePlant(proc: ProcessDef, p: Params, pv: number, d: Params = nominalDisturbances(proc)): PlantModel {
  const s = findSteady(proc, p, d, pv);
  const x0 = steadyState(proc, s);
  const u0 = s.valve;
  const n = x0.length;
  const nProc = proc.states.length;
  const f = (x: number[], u: number, dd = d) => plantDerivatives(proc, p, dd, x, u, false);
  const span = pvSpan(proc);
  let A = zeros(n);
  let Ctrue = new Array(n).fill(0);
  for (let j = 0; j < n; j++) {
    const h = 1e-6 * Math.max(1, Math.abs(x0[j]));
    const xp = x0.slice(), xm = x0.slice();
    xp[j] += h; xm[j] -= h;
    const fp = f(xp, u0), fm = f(xm, u0);
    for (let i = 0; i < n; i++) A[i][j] = (fp[i] - fm[i]) / (2 * h);
    Ctrue[j] = ((truePv(proc, p, d, xp) - truePv(proc, p, d, xm)) / (2 * h)) * (100 / span);
  }
  const hu = 1e-6 * Math.max(1, Math.abs(u0));
  const fu = f(x0, u0 + hu), fm = f(x0, u0 - hu);
  let B = fu.map((v, i) => (v - fm[i]) / (2 * hu));
  let C = new Array(n).fill(0);
  C[nProc + 1] = 100 / span;
  let C2: number[] | null = null;
  if (proc.secondary) {
    C2 = new Array(n).fill(0);
    C2[nProc + 2] = 100 / (proc.secondary.hi - proc.secondary.lo);
  }
  let Bd: Record<string, number[]> = {};
  const Dd: Record<string, number> = {};
  for (const ds of proc.disturbances) {
    const v = d[ds.key];
    const h = 1e-6 * Math.max(1, Math.abs(v));
    const dp = { ...d, [ds.key]: v + h }, dm = { ...d, [ds.key]: v - h };
    const a = f(x0, u0, dp), b = f(x0, u0, dm);
    Bd[ds.key] = a.map((q, i) => (q - b[i]) / (2 * h));
    Dd[ds.key] = ((truePv(proc, p, dp, x0) - truePv(proc, p, dm, x0)) / (2 * h)) * (100 / span);
  }

  // Drop states nothing depends on (e.g. an unused second lag): they'd only add fake poles.
  const keep = Array.from({ length: n }, (_, j) => j).filter((j) =>
    A.some((row, i) => i !== j && row[j] !== 0) || C[j] || Ctrue[j] || C2?.[j] || A[j][j] !== 0);
  if (keep.length < n) {
    A = keep.map((i) => keep.map((j) => A[i][j]));
    B = keep.map((i) => B[i]);
    C = keep.map((j) => C[j]);
    Ctrue = keep.map((j) => Ctrue[j]);
    C2 = C2 ? keep.map((j) => C2![j]) : null;
    Bd = Object.fromEntries(Object.entries(Bd).map(([k, col]) => [k, keep.map((i) => col[i])]));
  }

  const inv = solve(A, B);
  const K = inv ? -C.reduce((acc, c, i) => acc + c * inv[i], 0) : Infinity;
  return {
    pv: s.pv, valve: s.valve, reachable: Math.abs(s.pv - pv) < span * 1e-3,
    A, B, C, Ctrue, C2, Bd, Dd, theta: p.txDelay, poles: eig(A), K: Math.abs(K) > 1e9 ? Infinity : K, keep,
  };
}

/**
 * The part of the plant between the valve and one output: states the valve
 * can move *and* that can move the output. Others (the inner transmitter, as
 * seen from the main PV; the thermal states, as seen from steam flow) would
 * only add poles the path doesn't have.
 */
export function pathModel(m: PlantModel, row: number[], theta: number): PlantModel {
  const n = m.A.length;
  const reach = (start: number[], next: (j: number) => number[]) => {
    const seen = new Set(start);
    const stack = [...start];
    while (stack.length) for (const k of next(stack.pop()!)) if (!seen.has(k)) { seen.add(k); stack.push(k); }
    return seen;
  };
  const idx = Array.from({ length: n }, (_, i) => i);
  const fromInput = reach(idx.filter((i) => m.B[i] !== 0), (j) => idx.filter((i) => i !== j && m.A[i][j] !== 0));
  const toOutput = reach(idx.filter((j) => row[j] !== 0), (i) => idx.filter((j) => j !== i && m.A[i][j] !== 0));
  const keep = idx.filter((i) => fromInput.has(i) && toOutput.has(i));
  const A = keep.map((i) => keep.map((j) => m.A[i][j]));
  const B = keep.map((i) => m.B[i]);
  const C = keep.map((j) => row[j]);
  const inv = solve(A, B);
  const K = inv ? -C.reduce((acc, c, i) => acc + c * inv[i], 0) : Infinity;
  return {
    ...m, A, B, C, Ctrue: C, C2: null, Bd: {}, Dd: {}, theta, poles: eig(A), K: Math.abs(K) > 1e9 ? Infinity : K, keep: keep.map((i) => m.keep[i]),
  };
}

/** row·(jωI − A)⁻¹·col: one output's response to one input, without delay. */
export function ssResponse(A: Mat, col: number[], row: number[], w: number): Complex {
  const x = solveShifted(A, w, col);
  let g = cx(0);
  for (let i = 0; i < x.length; i++) if (row[i]) g = { re: g.re + row[i] * x[i].re, im: g.im + row[i] * x[i].im };
  return g;
}

/** Plant frequency response G(jω), including the exact transport delay. */
export function plantResponse(m: PlantModel, w: number): Complex {
  return cmul(ssResponse(m.A, m.B, m.C, w), cexpj(-w * m.theta));
}

const isZeroPole = (p: Complex, scale: number) => Math.hypot(p.re, p.im) < 1e-9 * Math.max(1, scale);

/** Time constants (s) of the plant's real poles, slowest first (integrators left out). */
export function timeConstants(m: PlantModel) {
  const scale = Math.max(...m.poles.map((p) => Math.hypot(p.re, p.im)), 1);
  return m.poles.filter((p) => p.re < 0 && !isZeroPole(p, scale)).map((p) => 1 / Math.hypot(p.re, p.im)).sort((a, b) => b - a);
}

export type Fopdt = {
  K: number; tau: number; theta: number;
  /** Second-order version: K e^{-θ2 s}/((τ s+1)(τ2 s+1)). */
  tau1: number; tau2: number; theta2: number;
  /** Slope of the integrating approximation, %/s per % (K/τ). */
  kPrime: number;
  /** The slowest pole is so slow that the plant acts as an integrator over the loop's time scale. */
  integrating: boolean;
};

/**
 * First- and second-order-plus-dead-time approximations by Skogestad's half
 * rule: half of the first neglected time constant goes to the kept one, the
 * other half and all smaller ones become effective dead time. `extraDelay`
 * adds the sample-and-hold delay of a digital controller (T_s/2).
 * A true integrator is represented by a very long τ with K = k′·τ, so every
 * tuning rule still applies (SIMC then gives its integrating-process tuning).
 */
export function approximate(m: PlantModel, extraDelay = 0): Fopdt {
  const t = timeConstants(m);
  const theta0 = m.theta + extraDelay;
  const scale = Math.max(...m.poles.map((p) => Math.hypot(p.re, p.im)), 1);
  const integrator = m.poles.some((p) => isZeroPole(p, scale));
  const [t1 = 0, t2 = 0, t3 = 0, ...rest] = integrator ? [0, ...t] : t;
  const restSum = rest.reduce((s, v) => s + v, 0);
  const lags = t.reduce((s, v) => s + v, 0);
  if (integrator) {
    // k′ from the low-frequency asymptote G(jω) ≈ k′/(jω), keeping its sign.
    const w = 1e-6 / Math.max(1, lags + theta0);
    const g = ssResponse(m.A, m.B, m.C, w);
    const kPrime = Math.sign(-g.im || 1) * w * cabs(g);
    const tauBig = 1e4 * Math.max(1, lags + theta0);
    // The ramp's asymptote k′(t − θe) lags by Σ pole time constants − Σ zero time constants, so an
    // inverse response (a right-half-plane zero, like a drum's shrink) counts as dead time too.
    // The poles alone would miss it.
    const wl = 1e-4 / Math.max(1, lags + theta0);
    const gl = ssResponse(m.A, m.B, m.C, wl);
    const kl = -wl * gl.im;
    const lagged = kl ? -gl.re / kl : 0;
    const extra = Math.max(0, lagged - (t2 + t3 + restSum));
    const theta = theta0 + t2 + t3 + restSum + extra;
    return { K: kPrime * tauBig, tau: tauBig, theta: Math.max(theta, 1e-6), tau1: tauBig, tau2: t2, theta2: Math.max(theta0 + t3 + restSum + extra, 1e-6), kPrime, integrating: true };
  }
  const tau = t1 + t2 / 2;
  const theta = theta0 + t2 / 2 + t3 + restSum;
  const tau2 = t2 + t3 / 2;
  const theta2 = theta0 + t3 / 2 + restSum;
  const K = Number.isFinite(m.K) ? m.K : NaN;
  const kPrime = Number.isFinite(K) && tau > 0 ? K / tau : NaN;
  return { K, tau, theta: Math.max(theta, 1e-6), tau1: tau, tau2, theta2: Math.max(theta2, 1e-6), kPrime, integrating: tau > 20 * theta };
}

// ─── The loop ───────────────────────────────────────────────────────────────

/** Controller frequency response for the error path (b = c = 1), including any characterization slope. */
export function pidResponse(c: LinearPid, w: number): Complex {
  const s = cx(0, w);
  const sign = c.invert ? -1 : 1;
  let r = cx(1);
  if (c.Ti > 0) r = { re: r.re, im: r.im - 1 / (w * c.Ti) };
  if (c.Td > 0) {
    const d = cdiv(cmul(cx(c.Td), s), { re: 1, im: w * c.a * c.Td });
    r = { re: r.re + d.re, im: r.im + d.im };
  }
  const k = sign * c.Kc * c.slope;
  return { re: k * r.re, im: k * r.im };
}

export type BodePoint = { w: number; mag: number; phase: number };

/** Log-spaced frequencies covering the plant's and controllers' dynamics. */
export function frequencyGrid(m: PlantModel, pids: (LinearPid | null)[], delay: number, count = 500, extra: number[] = []) {
  const rates = [...m.poles, ...extra.map((w) => cx(w))].map((p) => Math.hypot(p.re, p.im)).filter((v) => v > 1e-9);
  for (const c of pids) {
    if (c?.Ti) rates.push(1 / c.Ti);
    if (c?.Td) rates.push(1 / (c.a * c.Td));
  }
  if (delay > 0) rates.push(1 / delay);
  const lo = Math.min(...rates, 1) * 0.01;
  const hi = Math.max(...rates, 0.01) * 50;
  const out: number[] = [];
  for (let i = 0; i < count; i++) out.push(lo * (hi / lo) ** (i / (count - 1)));
  return out;
}

/** A frequency grid with extra points every π/8 of the model delay's phase, for the Smith predictor's ripples. */
function smithGrid(base: number[], theta: number) {
  if (!(theta > 0)) return base;
  const lo = base[0], hi = base[base.length - 1];
  const step = Math.PI / (8 * theta);
  const top = Math.min(hi, 200 / theta);
  const extra: number[] = [];
  for (let w = Math.max(lo, step); w <= top && extra.length < 4000; w += step) extra.push(w);
  return [...base, ...extra].sort((a, b) => a - b);
}

/** Bode data with a continuous (unwrapped) phase in degrees; the delay's phase is added exactly. */
export function bode(ws: number[], rational: (w: number) => Complex, delay: number): BodePoint[] {
  let prev = 0, offset = 0;
  return ws.map((w, i) => {
    const v = rational(w);
    let ph = carg(v);
    if (i > 0) {
      while (ph + offset - prev > Math.PI) offset -= 2 * Math.PI;
      while (ph + offset - prev < -Math.PI) offset += 2 * Math.PI;
    }
    prev = ph + offset;
    ph = prev - w * delay;
    return { w, mag: 20 * Math.log10(Math.max(cabs(v), 1e-300)), phase: (ph * 180) / Math.PI };
  });
}

export type Margins = {
  /** Gain margin, dB (Infinity if the phase never reaches −180°). */
  gm: number;
  /** Phase margin, degrees (Infinity if the gain never crosses 1). */
  pm: number;
  /** Gain crossover frequency, rad/s. */
  wc: number;
  /** Phase crossover frequency, rad/s. */
  w180: number;
  /** Peak sensitivity max|1/(1+L)|: below 1.4 robust, above 2 fragile. */
  ms: number;
  /** How much extra dead time the loop tolerates before going unstable, s. */
  delayMargin: number;
};

export type LoopAnalysis = {
  plant: PlantModel;
  ctrl: LinearController;
  /** The single PID, or the outer (master) one in cascade. */
  pid: LinearPid;
  /** Total delay in the main loop: transport + half a controller cycle. */
  delay: number;
  /** Open loop L = C·G (for cascade: the outer loop with the inner one closed). */
  loop: BodePoint[];
  plantBode: BodePoint[];
  margins: Margins;
  /** Cascade only: the inner loop on its own. */
  inner?: { loop: BodePoint[]; plantBode: BodePoint[]; margins: Margins };
};

/** Open loop at an operating point, its Bode data and stability margins (both loops in cascade). */
export function analyzeLoop(proc: ProcessDef, setupParams: Params, config: ControllerConfig, pv: number, plantParams?: Params): LoopAnalysis | null {
  const model = cleanParams(proc, setupParams);
  const m = linearizePlant(proc, plantParams ?? model, pv);
  const ctrl = linearControllerAt(proc, config, model, pv, m.valve);
  if (!ctrl) return null;
  const sample = model.Ts / 2;
  const delay = m.theta + sample;
  const G1 = (w: number) => ssResponse(m.A, m.B, m.C, w);
  if (ctrl.kind === 'single') {
    const ws = frequencyGrid(m, [ctrl.pid], delay);
    const loop = bode(ws, (w) => cmul(pidResponse(ctrl.pid, w), G1(w)), delay);
    return { plant: m, ctrl, pid: ctrl.pid, delay, loop, plantBode: bode(ws, G1, m.theta), margins: margins(loop) };
  }
  if (ctrl.kind === 'smith') {
    // The predictor makes the controller C/(1 + C·Gm(1 − e^{−θm·s})). Its delay term ripples
    // with frequency, so the grid gets a fine linear part where the loop still has gain.
    const { K, tau, theta } = ctrl.model;
    const ws = smithGrid(frequencyGrid(m, [ctrl.pid], delay), theta);
    const eff = (w: number) => {
      const c = pidResponse(ctrl.pid, w);
      const gm = cdiv(cx(K), { re: 1, im: w * tau });
      const pred = cmul(gm, { re: 1 - Math.cos(w * theta), im: Math.sin(w * theta) });
      const cg = cmul(c, pred);
      return cdiv(c, { re: 1 + cg.re, im: cg.im });
    };
    const loop = bode(ws, (w) => cmul(eff(w), G1(w)), delay);
    return { plant: m, ctrl, pid: ctrl.pid, delay, loop, plantBode: bode(ws, G1, m.theta), margins: margins(loop, true) };
  }
  if (ctrl.kind === 'ss') {
    // Broken at the valve: L = −Σ C_y,k(jω)·G_k(jω), the main measurement behind its transport delay,
    // the whole loop behind half a cycle of hold.
    const { ss, inputs } = ctrl;
    const ws = frequencyGrid(m, [], delay, 600, eig(ss.A).map((p) => Math.hypot(p.re, p.im)));
    const G2 = (w: number) => ssResponse(m.A, m.B, m.C2 ?? m.C, w);
    const L = (w: number) => inputs.reduce((acc, key, k) => {
      const g = key === 'pv' ? cmul(G1(w), cexpj(-w * m.theta)) : G2(w);
      const v = cmul(ssResponse(ss.A, ss.By.map((r) => r[k]), ss.C, w), g);
      return { re: acc.re - v.re, im: acc.im - v.im };
    }, cx(0));
    const loop = bode(ws, L, sample);
    const pid: LinearPid = { Kc: 0, Ti: 0, Td: 0, b: 1, c: 0, a: 0.1, antiWindup: 'clamp', outLo: 0, outHi: 100, invert: false, slope: 1 };
    // A state-feedback loop's phase can wind round the origin (integrators and resonances on both sides), so
    // the phase margin is the angle from L to −1, as for the Smith predictor.
    return { plant: m, ctrl, pid, delay, loop, plantBode: bode(ws, G1, m.theta), margins: margins(loop, true) };
  }
  // Cascade: the inner loop sees the sampling delay; the outer loop sees the inner one closed, plus the transport delay.
  const C2 = m.C2!;
  const G2 = (w: number) => ssResponse(m.A, m.B, C2, w);
  const ws = frequencyGrid(m, [ctrl.outer, ctrl.inner], delay);
  const Li = (w: number) => cmul(cmul(pidResponse(ctrl.inner, w), G2(w)), cexpj(-w * sample));
  const innerLoop = bode(ws, (w) => cmul(pidResponse(ctrl.inner, w), G2(w)), sample);
  const outer = (w: number) => {
    const li = Li(w);
    const ti = cdiv(cmul(pidResponse(ctrl.inner, w), cexpj(-w * sample)), { re: 1 + li.re, im: li.im });
    return cmul(cmul(pidResponse(ctrl.outer, w), ti), G1(w));
  };
  const loop = bode(ws, outer, m.theta);
  return {
    plant: m, ctrl, pid: ctrl.outer, delay, loop, plantBode: bode(ws, G1, m.theta), margins: margins(loop),
    inner: { loop: innerLoop, plantBode: bode(ws, G2, 0), margins: margins(innerLoop) },
  };
}

/**
 * Margins from the open-loop Bode data. `rippled`: the loop has a dead-time
 * model inside the controller (Smith predictor), whose phase winds round many
 * times, so the phase margin is taken as the angle between L and −1 at each
 * crossover, whichever way round.
 */
export function margins(loop: BodePoint[], rippled = false): Margins {
  let pm = Infinity, wc = NaN, gm = Infinity, w180 = NaN, ms = 0, delayMargin = Infinity;
  const interp = (a: BodePoint, b: BodePoint, key: 'mag' | 'phase', target: number) => {
    const f = (target - a[key]) / (b[key] - a[key]);
    const lw = Math.log(a.w) + f * (Math.log(b.w) - Math.log(a.w));
    const other = key === 'mag' ? 'phase' : 'mag';
    return { w: Math.exp(lw), v: a[other] + f * (b[other] - a[other]) };
  };
  for (let i = 1; i < loop.length; i++) {
    const a = loop[i - 1], b = loop[i];
    if ((a.mag >= 0 && b.mag < 0) || (a.mag < 0 && b.mag >= 0)) {
      const { w, v } = interp(a, b, 'mag', 0);
      // A long delay (or a Smith predictor's ripples) can carry the phase past −360° before
      // a crossover: what counts is where it points, so take it within one turn.
      let ph = v;
      while (ph <= -360) ph += 360;
      while (ph > 0) ph -= 360;
      const m = rippled ? 180 - Math.abs(ph + 360 * Math.round(-ph / 360)) : 180 + ph;
      if (m < pm) { pm = m; wc = w; }
      // Extra dead time turns L clockwise by ω·Δθ: the margin is the smallest turn, over every crossover, that reaches −1.
      const turnToMinus1 = rippled ? (((ph + 180) % 360) + 360) % 360 : m;
      if (w > 0) delayMargin = Math.min(delayMargin, ((turnToMinus1 * Math.PI) / 180) / w);
    }
    // Phase crossovers at −180°, −540°, …: every time the loop points at −1.
    const turn = (ph: number) => Math.floor((ph + 180) / 360);
    if (turn(a.phase) !== turn(b.phase)) {
      const { w, v } = interp(a, b, 'phase', -180 + 360 * Math.max(turn(a.phase), turn(b.phase)));
      if (-v < gm) { gm = -v; w180 = w; }
    }
  }
  for (const p of loop) {
    const L = { re: 10 ** (p.mag / 20) * Math.cos((p.phase * Math.PI) / 180), im: 10 ** (p.mag / 20) * Math.sin((p.phase * Math.PI) / 180) };
    ms = Math.max(ms, 1 / Math.hypot(1 + L.re, L.im));
  }
  return { gm, pm, wc, w180, ms, delayMargin };
}

/** The worse of two sets of margins (cascade: the outer and inner loops together). */
export const worseMargins = (a: Margins, b?: Margins): Margins => (b ? {
  gm: Math.min(a.gm, b.gm), pm: Math.min(a.pm, b.pm), ms: Math.max(a.ms, b.ms),
  wc: a.wc, w180: a.w180, delayMargin: Math.min(a.delayMargin, b.delayMargin),
} : a);

// ─── Closed loop in state space ─────────────────────────────────────────────

export type ClosedLoop = {
  A: Mat;
  /** Inputs: [setpoint, load at the valve, the chosen disturbance]. */
  B: Mat;
  /** Outputs: [true PV %, controller output %]. */
  C: Mat;
  /** Direct feed-through from the inputs to the outputs. */
  D: Mat;
  poles: Complex[];
  /** Controller output's direct response to the setpoint (P and D setpoint weights). */
  Kr: number;
  /** Number of states in each part, for labelling poles. */
  parts: { plant: number; delay: number; controller: number };
};

/** Second-order Padé approximation of e^{-θs} as a state-space system. */
export function pade2(theta: number) {
  const a1 = 6 / theta, a0 = 12 / (theta * theta);
  return { A: [[0, 1], [-a0, -a1]], B: [0, 1], C: [0, -12 / theta], D: 1 };
}

/** A signal as a linear combination of the states and the three inputs. */
type Sig = { x: number[]; r: number; l: number; d: number };
const sig = (n: number): Sig => ({ x: new Array(n).fill(0), r: 0, l: 0, d: 0 });
const add = (a: Sig, b: Sig, k = 1): Sig => ({ x: a.x.map((v, i) => v + k * b.x[i]), r: a.r + k * b.r, l: a.l + k * b.l, d: a.d + k * b.d });
const scale = (a: Sig, k: number): Sig => ({ x: a.x.map((v) => v * k), r: a.r * k, l: a.l * k, d: a.d * k });
const unit = (n: number, i: number): Sig => { const s = sig(n); s.x[i] = 1; return s; };
const rowSig = (n: number, row: number[], offset = 0): Sig => { const s = sig(n); row.forEach((v, i) => { s.x[offset + i] = v; }); return s; };

/**
 * The linear closed loop, built from blocks: plant, delay (Padé on the main
 * measurement), feedforward lead-lags on the chosen disturbance, and the PID
 * (or the two PIDs of a cascade).
 */
export function closedLoop(m: PlantModel, ctrl: LinearController, delay: number, dKey?: string): ClosedLoop {
  const np = m.A.length;
  const nq = delay > 0 ? 2 : 0;
  const ffTerms: FeedforwardTerm[] = (ctrl.ff ?? []).filter((t) => t.from === dKey);
  const ffStates = ffTerms.map((t) => (t.lag > 0 ? 1 : 0) as number);
  const pids = ctrl.kind === 'cascade' ? [ctrl.outer, ctrl.inner] : ctrl.kind === 'ss' ? [] : [ctrl.pid];
  const pidStates = pids.map((p) => (p.Ti > 0 ? 1 : 0) + (p.Td > 0 ? 1 : 0));
  const smith = ctrl.kind === 'smith' ? ctrl.model : null;
  const smithStates = smith ? 1 + (smith.theta > 0 ? 2 : 0) : 0;
  const ssStates = ctrl.kind === 'ss' ? ctrl.ss.A.length : 0;
  const n = np + nq + ffStates.reduce((s, v) => s + v, 0) + pidStates.reduce((s, v) => s + v, 0) + smithStates + ssStates;
  const deriv: Sig[] = Array.from({ length: n }, () => sig(n));
  let next = np + nq;

  // Measurements.
  const pd = nq ? pade2(delay) : null;
  const yRaw = rowSig(n, m.C);
  const y = pd ? add(scale(yRaw, pd.D), add(scale(unit(n, np), pd.C[0]), unit(n, np + 1), pd.C[1])) : yRaw;
  const y2 = m.C2 ? rowSig(n, m.C2) : sig(n);
  const dd: Sig = { ...sig(n), d: 1 };
  const r: Sig = { ...sig(n), r: 1 };

  // Feedforward: gain·(lead·s + 1)/(lag·s + 1) on the disturbance.
  let v = sig(n);
  ffTerms.forEach((t) => {
    if (t.lag > 0) {
      const i = next++;
      deriv[i] = scale(add(dd, unit(n, i), -1), 1 / t.lag);
      const k = t.lead / t.lag;
      v = add(v, add(scale(dd, k), unit(n, i), 1 - k), t.gain);
    } else v = add(v, dd, t.gain);
  });

  const pidBlock = (p: LinearPid, rS: Sig, yS: Sig) => {
    const k = (p.invert ? -1 : 1) * p.Kc * p.slope;
    const e = add(rS, yS, -1), eP = add(scale(rS, p.b), yS, -1), eD = add(scale(rS, p.c), yS, -1);
    let out = scale(eP, k);
    if (p.Ti > 0) {
      const i = next++;
      deriv[i] = e;
      out = add(out, unit(n, i), k / p.Ti);
    }
    if (p.Td > 0) {
      const i = next++;
      const Tf = Math.max(p.a * p.Td, 1e-9);
      deriv[i] = scale(add(eD, unit(n, i), -1), 1 / Tf);
      out = add(out, add(eD, unit(n, i), -1), (k * p.Td) / Tf);
    }
    return out;
  };

  let u: Sig;
  if (ctrl.kind === 'single') u = add(pidBlock(ctrl.pid, r, y), v);
  else if (ctrl.kind === 'smith') {
    // Model lag z (undelayed prediction) and a Padé copy of its delay; the PID sees y + z − delayed z.
    const sm = ctrl.model;
    const iz = next++;
    const iq = next;
    next += sm.theta > 0 ? 2 : 0;
    const mp = sm.theta > 0 ? pade2(sm.theta) : null;
    const z = unit(n, iz);
    const zd = mp ? add(scale(z, mp.D), add(scale(unit(n, iq), mp.C[0]), unit(n, iq + 1), mp.C[1])) : z;
    u = pidBlock(ctrl.pid, r, add(y, add(z, zd, -1)));
    deriv[iz] = scale(add(scale(u, sm.K), z, -1), 1 / Math.max(sm.tau, 1e-2));
    if (mp) for (let k = 0; k < 2; k++) deriv[iq + k] = add(add(scale(unit(n, iq), mp.A[k][0]), unit(n, iq + 1), mp.A[k][1]), z, mp.B[k]);
  } else if (ctrl.kind === 'ss') {
    const { ss, inputs } = ctrl;
    const base = next;
    next += ss.A.length;
    const ys = inputs.map((k) => (k === 'pv' ? y : y2));
    for (let i = 0; i < ss.A.length; i++) {
      let s = add(rowSig(n, ss.A[i], base), r, ss.Br[i]);
      ys.forEach((yk, k) => { s = add(s, yk, ss.By[i][k]); });
      deriv[base + i] = s;
    }
    u = add(add(rowSig(n, ss.C, base), r, ss.Dr), v);
  } else u =pidBlock(ctrl.inner, add(pidBlock(ctrl.outer, r, y), v), y2);

  // Plant and delay.
  const drive = add(u, { ...sig(n), l: 1 });
  const bd = (dKey && m.Bd[dKey]) || new Array(np).fill(0);
  for (let i = 0; i < np; i++) {
    let s = rowSig(n, m.A[i]);
    s = add(s, drive, m.B[i]);
    s = add(s, dd, bd[i]);
    deriv[i] = s;
  }
  if (pd) {
    for (let k = 0; k < 2; k++) {
      deriv[np + k] = add(add(scale(unit(n, np), pd.A[k][0]), unit(n, np + 1), pd.A[k][1]), yRaw, pd.B[k]);
    }
  }

  const A = deriv.map((s) => s.x);
  const B = deriv.map((s) => [s.r, s.l, s.d]);
  const yTrue = rowSig(n, m.Ctrue);
  const C = [yTrue.x, u.x];
  const D = [[0, 0, (dKey && m.Dd[dKey]) || 0], [u.r, u.l, u.d]];
  return { A, B, C, D, poles: eig(A), Kr: u.r, parts: { plant: np, delay: nq, controller: n - np - nq } };
}

export type StepResponse = { t: number[]; y: number[]; u: number[] };

/** Response of the linear closed loop to a unit step on one input (0 setpoint, 1 load, 2 disturbance). */
export function stepResponse(cl: ClosedLoop, input: 0 | 1 | 2, horizon: number, points = 400): StepResponse {
  const h = horizon / points;
  const { Phi, Gamma } = c2d(cl.A, cl.B.map((r) => [r[input]]), h);
  let x = new Array(cl.A.length).fill(0);
  const t: number[] = [], y: number[] = [], u: number[] = [];
  for (let k = 0; k <= points; k++) {
    t.push(k * h);
    y.push(cl.C[0].reduce((s, c, i) => s + c * x[i], 0) + cl.D[0][input]);
    u.push(cl.C[1].reduce((s, c, i) => s + c * x[i], 0) + cl.D[1][input]);
    x = Phi.map((row, i) => row.reduce((s, v, j) => s + v * x[j], 0) + Gamma[i][0]);
  }
  return { t, y, u };
}

/** Open-loop step response of one output to one input column (for fitting simple models to paths). */
export function openLoopStep(A: Mat, col: number[], row: number[], direct: number, horizon: number, points = 600) {
  const h = horizon / points;
  const { Phi, Gamma } = c2d(A, col.map((v) => [v]), h);
  let x = new Array(A.length).fill(0);
  const t: number[] = [], y: number[] = [];
  for (let k = 0; k <= points; k++) {
    t.push(k * h);
    y.push(row.reduce((s, c, i) => s + c * x[i], 0) + direct);
    x = Phi.map((r, i) => r.reduce((s, v, j) => s + v * x[j], 0) + Gamma[i][0]);
  }
  return { t, y };
}

/** A time axis long enough for the slowest closed-loop mode to settle. */
export function settleHorizon(poles: Complex[], fallback: number) {
  const stable = poles.filter((p) => p.re < -1e-12).map((p) => -p.re);
  if (!stable.length) return fallback;
  return Math.min(Math.max(6 / Math.min(...stable), fallback / 20), fallback * 50);
}

export const isStable = (poles: Complex[]) => poles.every((p) => p.re < 1e-9);

// ─── Robustness ─────────────────────────────────────────────────────────────

export type RobustPoint = { pv: number; nominal: Margins | null; worst: Margins | null; stableAll: boolean };

/**
 * Margins at each operating point, nominal and the worst over a seeded random
 * spread of the uncertain plant parameters (the controller keeps its tuning).
 * In cascade both loops count.
 */
export function robustness(proc: ProcessDef, setupParams: Params, config: ControllerConfig, samples = 20): RobustPoint[] {
  const model = cleanParams(proc, setupParams);
  const r = rng(7);
  return proc.opPoints.map((pv) => {
    const a0 = analyzeLoop(proc, model, config, pv);
    if (!a0) return { pv, nominal: null, worst: null, stableAll: true };
    const nominal = worseMargins(a0.margins, a0.inner?.margins);
    let worst: Margins = { ...nominal };
    let stableAll = isStable(closedLoop(a0.plant, a0.ctrl, a0.delay).poles);
    for (let i = 0; i < samples; i++) {
      const plant = { ...model };
      for (const u of proc.uncertain) plant[u.key] = model[u.key] * (1 + u.spread * (2 * r.next() - 1));
      const a = analyzeLoop(proc, model, config, pv, plant);
      if (!a) continue;
      if (!isStable(closedLoop(a.plant, a.ctrl, a.delay).poles)) stableAll = false;
      worst = worseMargins(worst, worseMargins(a.margins, a.inner?.margins));
    }
    return { pv, nominal, worst, stableAll };
  });
}
