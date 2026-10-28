import { linearPidAt, type ControllerConfig, type LinearPid } from './controllers';
import { c2d, cabs, carg, cdiv, cexpj, cmul, cx, eig, rng, solve, solveShifted, zeros, type Complex, type Mat } from './linalg';
import { cleanParams, nominalDisturbances, pvSpan, type Params, type ProcessDef } from './model';
import { findSteady, plantDerivatives, truePv } from './sim';

// Linear analysis: linearize the nonlinear plant at an operating point the
// way you would on paper (Jacobian at steady state), then the classical tools:
// frequency response, margins, closed-loop poles and step responses.
// Signals are in % (valve signal in, % of transmitter span out).

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
  /** Transport delay, s. */
  theta: number;
  poles: Complex[];
  /** Static gain, % per % (Infinity for an integrating plant). */
  K: number;
};

export function linearizePlant(proc: ProcessDef, p: Params, pv: number, d: Params = nominalDisturbances(proc)): PlantModel {
  const s = findSteady(proc, p, d, pv);
  const x0 = [s.valve, ...s.x, s.pv];
  const u0 = s.valve;
  const n = x0.length;
  const f = (x: number[], u: number) => plantDerivatives(proc, p, d, x, u, false);
  const A = zeros(n);
  const Ctrue = new Array(n).fill(0);
  const span = pvSpan(proc);
  for (let j = 0; j < n; j++) {
    const h = 1e-6 * Math.max(1, Math.abs(x0[j]));
    const xp = x0.slice(), xm = x0.slice();
    xp[j] += h; xm[j] -= h;
    const fp = f(xp, u0), fm = f(xm, u0);
    for (let i = 0; i < n; i++) A[i][j] = (fp[i] - fm[i]) / (2 * h);
    Ctrue[j] = ((truePv(proc, p, d, xp) - truePv(proc, p, d, xm)) / (2 * h)) * (100 / span);
  }
  const hu = 1e-6 * Math.max(1, Math.abs(u0));
  const fp = f(x0, u0 + hu), fm = f(x0, u0 - hu);
  const B = fp.map((v, i) => (v - fm[i]) / (2 * hu));
  const C = new Array(n).fill(0);
  C[n - 1] = 100 / span;
  const inv = solve(A, B);
  const K = inv ? -C.reduce((acc, c, i) => acc + c * inv[i], 0) : Infinity;
  return {
    pv: s.pv, valve: s.valve, reachable: Math.abs(s.pv - pv) < span * 1e-3,
    A, B, C, Ctrue, theta: p.txDelay, poles: eig(A), K: Math.abs(K) > 1e9 ? Infinity : K,
  };
}

/** Plant frequency response G(jω), including the exact transport delay. */
export function plantResponse(m: PlantModel, w: number): Complex {
  const x = solveShifted(m.A, w, m.B);
  let g = cx(0);
  for (let i = 0; i < x.length; i++) if (m.C[i]) g = { re: g.re + m.C[i] * x[i].re, im: g.im + m.C[i] * x[i].im };
  return cmul(g, cexpj(-w * m.theta));
}

/** Time constants (s) of the plant's real poles, slowest first. */
export function timeConstants(m: PlantModel) {
  return m.poles.filter((p) => p.re < 0).map((p) => 1 / Math.hypot(p.re, p.im)).sort((a, b) => b - a);
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
 */
export function approximate(m: PlantModel, extraDelay = 0): Fopdt {
  const t = timeConstants(m);
  const theta0 = m.theta + extraDelay;
  const [t1 = 0, t2 = 0, t3 = 0, ...rest] = t;
  const restSum = rest.reduce((s, v) => s + v, 0);
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

/** Log-spaced frequencies covering the plant's and controller's dynamics. */
export function frequencyGrid(m: PlantModel, c: LinearPid | null, delay: number, count = 500) {
  const rates = m.poles.map((p) => Math.hypot(p.re, p.im)).filter((v) => v > 1e-9);
  if (c?.Ti) rates.push(1 / c.Ti);
  if (c?.Td) rates.push(1 / (c.a * c.Td));
  if (delay > 0) rates.push(1 / delay);
  const lo = Math.min(...rates, 1) * 0.01;
  const hi = Math.max(...rates, 0.01) * 50;
  const out: number[] = [];
  for (let i = 0; i < count; i++) out.push(lo * (hi / lo) ** (i / (count - 1)));
  return out;
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
  pid: LinearPid;
  /** Total loop delay: transport + half a controller cycle. */
  delay: number;
  loop: BodePoint[];
  plantBode: BodePoint[];
  margins: Margins;
};

/** Open-loop L = C·G at an operating point, its Bode data and stability margins. */
export function analyzeLoop(proc: ProcessDef, setupParams: Params, config: ControllerConfig, pv: number, plantParams?: Params): LoopAnalysis | null {
  const model = cleanParams(proc, setupParams);
  const m = linearizePlant(proc, plantParams ?? model, pv);
  const pid = linearPidAt(proc, config, model, pv, m.valve);
  if (!pid) return null;
  const delay = m.theta + model.Ts / 2;
  const ws = frequencyGrid(m, pid, delay);
  const rational = (w: number) => {
    const x = solveShifted(m.A, w, m.B);
    let g = cx(0);
    for (let i = 0; i < x.length; i++) if (m.C[i]) g = { re: g.re + m.C[i] * x[i].re, im: g.im + m.C[i] * x[i].im };
    return g;
  };
  const plantBode = bode(ws, rational, m.theta);
  const loop = bode(ws, (w) => cmul(pidResponse(pid, w), rational(w)), delay);
  return { plant: m, pid, delay, loop, plantBode, margins: margins(loop) };
}

export function margins(loop: BodePoint[]): Margins {
  let pm = Infinity, wc = NaN, gm = Infinity, w180 = NaN, ms = 0;
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
      const m = 180 + v;
      if (m < pm) { pm = m; wc = w; }
    }
    if ((a.phase > -180 && b.phase <= -180) || (a.phase <= -180 && b.phase > -180)) {
      const { w, v } = interp(a, b, 'phase', -180);
      if (-v < gm) { gm = -v; w180 = w; }
    }
  }
  for (const p of loop) {
    const L = { re: 10 ** (p.mag / 20) * Math.cos((p.phase * Math.PI) / 180), im: 10 ** (p.mag / 20) * Math.sin((p.phase * Math.PI) / 180) };
    ms = Math.max(ms, 1 / Math.hypot(1 + L.re, L.im));
  }
  const delayMargin = Number.isFinite(pm) && wc > 0 ? ((pm * Math.PI) / 180) / wc : Infinity;
  return { gm, pm, wc, w180, ms, delayMargin };
}

// ─── Closed loop in state space ─────────────────────────────────────────────

export type ClosedLoop = {
  A: Mat;
  /** Inputs: [setpoint, load disturbance at the valve]. */
  B: Mat;
  /** Outputs: [true PV %, controller output %]. */
  C: Mat;
  poles: Complex[];
  /** Controller output's direct response to the setpoint (P and D setpoint weights). */
  Kr: number;
  /** Index ranges of the parts, for labelling poles. */
  parts: { plant: number; delay: number; controller: number };
};

/** Second-order Padé approximation of e^{-θs} as a state-space system. */
export function pade2(theta: number) {
  const a1 = 6 / theta, a0 = 12 / (theta * theta);
  return { A: [[0, 1], [-a0, -a1]], B: [0, 1], C: [0, -12 / theta], D: 1 };
}

export function closedLoop(m: PlantModel, pid: LinearPid, delay: number): ClosedLoop {
  const np = m.A.length;
  const nq = delay > 0 ? 2 : 0;
  const hasI = pid.Ti > 0, hasD = pid.Td > 0;
  const n = np + nq + (hasI ? 1 : 0) + (hasD ? 1 : 0);
  const iq = np, ii = np + nq, id = ii + (hasI ? 1 : 0);
  const A = zeros(n), B = zeros(n, 2), C = zeros(2, n);
  const k = (pid.invert ? -1 : 1) * pid.Kc * pid.slope;
  const Tf = Math.max(pid.a * pid.Td, 1e-9);
  // Measured y as a row over the state.
  const Cy = new Array(n).fill(0);
  const pd = nq ? pade2(delay) : null;
  for (let j = 0; j < np; j++) Cy[j] = (pd ? pd.D : 1) * m.C[j];
  if (pd) { Cy[iq] = pd.C[0]; Cy[iq + 1] = pd.C[1]; }
  // u = Ku·x + Kr·r
  const dGain = hasD ? pid.Td / Tf : 0;
  const Ku = Cy.map((v) => -k * v * (1 + dGain));
  if (hasI) Ku[ii] += k / pid.Ti;
  if (hasD) Ku[id] += -k * dGain;
  const Kr = k * (pid.b + (hasD ? pid.c * dGain : 0));
  // Plant: ẋp = A xp + B (u + load)
  for (let i = 0; i < np; i++) {
    for (let j = 0; j < np; j++) A[i][j] += m.A[i][j];
    for (let j = 0; j < n; j++) A[i][j] += m.B[i] * Ku[j];
    B[i][0] = m.B[i] * Kr;
    B[i][1] = m.B[i];
  }
  // Delay approximation driven by the transmitter reading.
  if (pd) {
    for (let r = 0; r < 2; r++) {
      A[iq + r][iq] = pd.A[r][0];
      A[iq + r][iq + 1] = pd.A[r][1];
      for (let j = 0; j < np; j++) A[iq + r][j] += pd.B[r] * m.C[j];
    }
  }
  if (hasI) {
    for (let j = 0; j < n; j++) A[ii][j] -= Cy[j];
    B[ii][0] = 1;
  }
  if (hasD) {
    for (let j = 0; j < n; j++) A[id][j] -= Cy[j] / Tf;
    A[id][id] -= 1 / Tf;
    B[id][0] = pid.c / Tf;
  }
  for (let j = 0; j < np; j++) C[0][j] = m.Ctrue[j];
  C[1] = Ku.slice();
  return { A, B, C, poles: eig(A), Kr, parts: { plant: np, delay: nq, controller: n - np - nq } };
}

export type StepResponse = { t: number[]; y: number[]; u: number[] };

/** Response of the linear closed loop to a unit step on one input (0 = setpoint, 1 = load). */
export function stepResponse(cl: ClosedLoop, input: 0 | 1, horizon: number, points = 400): StepResponse {
  const h = horizon / points;
  const { Phi, Gamma } = c2d(cl.A, cl.B.map((r) => [r[input]]), h);
  const n = cl.A.length;
  let x = new Array(n).fill(0);
  const t: number[] = [], y: number[] = [], u: number[] = [];
  // On a setpoint step the controller output also jumps straight away (P and D setpoint weights).
  const ff = input === 0 ? cl.Kr : 0;
  for (let k = 0; k <= points; k++) {
    t.push(k * h);
    y.push(cl.C[0].reduce((s, c, i) => s + c * x[i], 0));
    u.push(cl.C[1].reduce((s, c, i) => s + c * x[i], 0) + ff);
    x = Phi.map((row, i) => row.reduce((s, v, j) => s + v * x[j], 0) + Gamma[i][0]);
  }
  return { t, y, u };
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
 */
export function robustness(proc: ProcessDef, setupParams: Params, config: ControllerConfig, samples = 20): RobustPoint[] {
  const model = cleanParams(proc, setupParams);
  const r = rng(7);
  return proc.opPoints.map((pv) => {
    const nominal = analyzeLoop(proc, model, config, pv)?.margins ?? null;
    if (!nominal) return { pv, nominal: null, worst: null, stableAll: true };
    let worst: Margins = { ...nominal };
    let stableAll = true;
    for (let i = 0; i < samples; i++) {
      const plant = { ...model };
      for (const u of proc.uncertain) plant[u.key] = model[u.key] * (1 + u.spread * (2 * r.next() - 1));
      const a = analyzeLoop(proc, model, config, pv, plant);
      if (!a) continue;
      const mg = a.margins;
      const pdl = linearPidAt(proc, config, model, pv, a.plant.valve);
      if (pdl && !isStable(closedLoop(a.plant, pdl, a.delay).poles)) stableAll = false;
      worst = {
        gm: Math.min(worst.gm, mg.gm), pm: Math.min(worst.pm, mg.pm), ms: Math.max(worst.ms, mg.ms),
        wc: worst.wc, w180: worst.w180, delayMargin: Math.min(worst.delayMargin, mg.delayMargin),
      };
    }
    return { pv, nominal, worst, stableAll };
  });
}
