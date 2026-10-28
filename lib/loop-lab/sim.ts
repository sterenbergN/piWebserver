import { createController, type ControllerConfig, type ControllerInstance } from './controllers';
import { rng } from './linalg';
import { cleanParams, nominalDisturbances, pvSpan, valveCharacteristic, type Params, type ProcessDef, type Scenario } from './model';

// Time simulation of a closed loop. The plant (valve stem, process, transmitter
// filter) is integrated with RK4 in small steps; the controller runs once per
// cycle T_s and holds its output in between, like a PLC cyclic interrupt.
//
// State vector: [valve stem %, ...process states, transmitter reading,
// secondary transmitter reading (only for processes with an inner measurement)].

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export type LoopSetup = { params: Params; controller: ControllerConfig; seed?: number };

/** Steady state of the process at a PV value: the valve position that holds it, and the states. */
export function findSteady(proc: ProcessDef, p: Params, d: Params, pv: number) {
  const at = (valve: number) => {
    const flow = valveCharacteristic(p.valveChar, valve / 100);
    const x = proc.steady(flow, d, p);
    return x ? { valve, x, pv: proc.pvOf(x, flow, d, p), pv2: proc.secondary ? proc.secondary.of(x, flow, d, p) : NaN } : null;
  };
  if (proc.steadyAt) {
    const direct = proc.steadyAt(pv, d, p);
    if (direct) {
      const flow = valveCharacteristic(p.valveChar, direct.valve / 100);
      return { valve: direct.valve, x: direct.x, pv: proc.pvOf(direct.x, flow, d, p), pv2: proc.secondary ? proc.secondary.of(direct.x, flow, d, p) : NaN };
    }
  }
  // Bisection on valve position (PV rises with opening on every process here).
  let lo = 0, hi = 100;
  const top = at(hi);
  if (top && top.pv <= pv) return top;
  const bottom = at(lo);
  if (bottom && bottom.pv >= pv) return bottom;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    const s = at(mid);
    if (!s || s.pv > pv) hi = mid;
    else lo = mid;
  }
  return at(lo) ?? { valve: lo, x: proc.states.map(() => 0), pv, pv2: NaN };
}

/** The full plant state at a steady state: [valve, ...process, reading, (secondary reading)]. */
export function steadyState(proc: ProcessDef, s: ReturnType<typeof findSteady>) {
  return proc.secondary ? [s.valve, ...s.x, s.pv, s.pv2] : [s.valve, ...s.x, s.pv];
}

/** Derivatives of the whole plant (valve + process + transmitter) for a valve signal. */
export function plantDerivatives(proc: ProcessDef, p: Params, d: Params, x: number[], target: number, rateLimit = true) {
  const n = proc.states.length;
  const xv = x[0];
  let dv = (target - xv) / p.valveTau;
  if (rateLimit) dv = clamp(dv, -p.valveRate, p.valveRate);
  const flow = valveCharacteristic(p.valveChar, xv / 100);
  const px = x.slice(1, 1 + n);
  const dp = proc.derivatives(px, flow, d, p);
  const pvTrue = proc.pvOf(px, flow, d, p);
  const dm = (pvTrue - x[n + 1]) / p.txTau;
  if (!proc.secondary) return [dv, ...dp, dm];
  const dm2 = (proc.secondary.of(px, flow, d, p) - x[n + 2]) / p.tx2Tau;
  return [dv, ...dp, dm, dm2];
}

export function truePv(proc: ProcessDef, p: Params, d: Params, x: number[]) {
  const flow = valveCharacteristic(p.valveChar, x[0] / 100);
  return proc.pvOf(x.slice(1, 1 + proc.states.length), flow, d, p);
}

export type Sample = {
  t: number; sp: number; pv: number; pvTrue: number; cv: number; valve: number;
  P: number; I: number; D: number; Kc: number;
  /** Inner loop: its measurement and setpoint (NaN without cascade). */
  pv2: number; sp2: number;
  /** Feedforward's share of the output (0 without feedforward). */
  ff: number;
};

/** A running loop: step it one controller cycle at a time. Used by test runs and the live faceplate. */
export class Loop {
  readonly proc: ProcessDef;
  readonly Ts: number;
  /** Plant parameters (can drift away from what the controller was set up for). */
  p: Params;
  d: Params;
  x: number[];
  t = 0;
  sp: number;
  auto = true;
  manualOut: number;
  lastCv: number;
  private ctrl: ControllerInstance;
  private held: number;
  private delay: number[] = [];
  private frozenUntil = -1;
  private lastMeas: number;
  private lastMeas2 = NaN;
  private noise: ReturnType<typeof rng>;

  constructor(proc: ProcessDef, setup: LoopSetup, opts: { sp: number; d?: Params; plantParams?: Params }) {
    this.proc = proc;
    const model = cleanParams(proc, setup.params);
    this.p = { ...(opts.plantParams ?? model) };
    this.Ts = model.Ts;
    this.d = { ...nominalDisturbances(proc), ...(opts.d ?? {}) };
    this.sp = opts.sp;
    const s = findSteady(proc, this.p, this.d, opts.sp);
    this.x = steadyState(proc, s);
    this.ctrl = createController(proc, setup.controller, model, this.Ts);
    this.lastMeas2 = s.pv2;
    this.ctrl.track(s.valve, opts.sp, s.pv, this.aux());
    this.manualOut = s.valve;
    this.lastCv = s.valve;
    this.held = s.valve;
    this.lastMeas = s.pv;
    this.noise = rng(setup.seed ?? 1);
  }

  /**
   * Carry on from another loop on the same process (after a settings change):
   * same state, time, setpoint, disturbances and mode, with this loop's
   * controller picking up the valve signal bumplessly.
   */
  adopt(prev: Loop) {
    if (prev.proc.id !== this.proc.id || prev.x.length !== this.x.length) return;
    this.x = prev.x.slice();
    this.t = prev.t;
    this.sp = prev.sp;
    this.d = { ...prev.d };
    this.auto = prev.auto;
    this.manualOut = prev.manualOut;
    this.lastCv = prev.lastCv;
    this.held = prev.held;
    this.lastMeas = prev.lastMeas;
    this.lastMeas2 = prev.lastMeas2;
    this.ctrl.track(prev.lastCv, this.sp, prev.lastMeas, this.aux());
  }

  /** What controllers see besides SP and PV: the inner measurement and the disturbances. */
  private aux() {
    return { pv2: this.lastMeas2, d: this.d };
  }

  freeze(duration: number) { this.frozenUntil = this.t + duration; }

  setMode(auto: boolean) {
    if (!auto) this.manualOut = this.lastCv;
    this.auto = auto;
  }

  /** The transmitter reading the controller sees this cycle. */
  private measure() {
    if (this.t < this.frozenUntil) return this.lastMeas;
    const n = this.proc.states.length;
    this.delay.push(this.x[n + 1]);
    const lag = Math.round(this.p.txDelay / this.Ts);
    while (this.delay.length > lag + 1) this.delay.shift();
    const delayed = this.delay[0];
    const span = pvSpan(this.proc);
    const noisy = delayed + ((this.p.txNoise / 100) * span) * this.noise.gauss();
    // A 4–20 mA input saturates a little outside its range.
    this.lastMeas = clamp(noisy, this.proc.pv.lo - 0.02 * span, this.proc.pv.hi + 0.02 * span);
    const sec = this.proc.secondary;
    if (sec) {
      const span2 = sec.hi - sec.lo;
      this.lastMeas2 = clamp(this.x[n + 2] + ((this.p.txNoise / 100) * span2) * this.noise.gauss(), sec.lo - 0.02 * span2, sec.hi + 0.02 * span2);
    }
    return this.lastMeas;
  }

  /** One controller cycle. Returns what happened at the start of it. */
  step(): Sample {
    const pv = this.measure();
    let cv: number;
    if (this.auto) cv = this.ctrl.step(this.sp, pv, this.aux());
    else {
      cv = clamp(this.manualOut, 0, 100);
      this.ctrl.track(cv, this.sp, pv, this.aux());
    }
    cv = clamp(cv, 0, 100);
    this.lastCv = cv;
    // Deadband: the stem only follows once the signal has moved past the slack.
    const half = this.p.valveDeadband / 2;
    if (cv > this.held + half) this.held = cv - half;
    else if (cv < this.held - half) this.held = cv + half;

    const sample: Sample = {
      t: this.t, sp: this.sp, pv, pvTrue: truePv(this.proc, this.p, this.d, this.x), cv, valve: this.x[0],
      pv2: this.lastMeas2, ...pick(this.ctrl.internals()),
    };
    this.integrate(this.Ts, this.held);
    this.t += this.Ts;
    return sample;
  }

  private integrate(dt: number, target: number) {
    const hmax = 0.25 * Math.min(this.p.valveTau, this.p.txTau, this.proc.secondary ? this.p.tx2Tau : Infinity, this.proc.fastest?.(this.p) ?? Infinity);
    const n = Math.max(1, Math.ceil(dt / hmax));
    const h = dt / n;
    const f = (x: number[]) => plantDerivatives(this.proc, this.p, this.d, x, target);
    for (let i = 0; i < n; i++) {
      const x = this.x;
      const k1 = f(x);
      const k2 = f(x.map((v, j) => v + (h / 2) * k1[j]));
      const k3 = f(x.map((v, j) => v + (h / 2) * k2[j]));
      const k4 = f(x.map((v, j) => v + h * k3[j]));
      this.x = x.map((v, j) => v + (h / 6) * (k1[j] + 2 * k2[j] + 2 * k3[j] + k4[j]));
      this.x[0] = clamp(this.x[0], 0, 100);
    }
  }
}

const pick = ({ P, I, D, Kc, sp2, ff }: { P: number; I: number; D: number; Kc: number; sp2: number; ff: number }) => ({ P, I, D, Kc, sp2, ff });

export type Trace = {
  t: Float64Array; sp: Float64Array; pv: Float64Array; pvTrue: Float64Array;
  cv: Float64Array; valve: Float64Array; P: Float64Array; I: Float64Array; D: Float64Array; Kc: Float64Array;
  pv2: Float64Array; sp2: Float64Array; ff: Float64Array;
  dist: Record<string, Float64Array>;
};

export type Run = { scenario: Scenario; trace: Trace; Ts: number };

/** A test script in seconds: scaled for processes whose time scale is a parameter. */
export function scaledScenario(proc: ProcessDef, p: Params, scenario: Scenario): Scenario {
  const k = proc.timeScale?.(p) ?? 1;
  if (k === 1) return scenario;
  return {
    ...scenario,
    duration: scenario.duration * k,
    events: scenario.events.map((e) => (e.kind === 'freeze' ? { ...e, t: e.t * k, duration: e.duration * k } : { ...e, t: e.t * k })),
  };
}

/** Run one test script from start to finish. */
export function runScenario(proc: ProcessDef, setup: LoopSetup, rawScenario: Scenario): Run {
  const model = cleanParams(proc, setup.params);
  const scenario = scaledScenario(proc, model, rawScenario);
  // Changes at t = 0 describe the plant as it really is; the controller keeps the setup's view.
  const plant = { ...model };
  const sorted = [...scenario.events].sort((a, b) => a.t - b.t);
  const initial = (e: Scenario['events'][number]) => e.t <= 0 && e.kind === 'param';
  for (const ev of sorted) if (ev.kind === 'param' && initial(ev)) applyParam(plant, ev.key, ev.value, ev.factor);
  const events = sorted.filter((e) => !initial(e));
  const loop = new Loop(proc, setup, { sp: scenario.initialSp, plantParams: plant });
  const n = Math.floor(scenario.duration / loop.Ts) + 1;
  const keys = ['t', 'sp', 'pv', 'pvTrue', 'cv', 'valve', 'P', 'I', 'D', 'Kc', 'pv2', 'sp2', 'ff'] as const;
  const trace = Object.fromEntries(keys.map((k) => [k, new Float64Array(n)])) as unknown as Trace;
  trace.dist = Object.fromEntries(proc.disturbances.map((s) => [s.key, new Float64Array(n)]));
  let next = 0;
  for (let i = 0; i < n; i++) {
    while (next < events.length && events[next].t <= loop.t + 1e-9) {
      const ev = events[next++];
      if (ev.kind === 'sp') loop.sp = ev.value;
      else if (ev.kind === 'dist') loop.d[ev.key] = ev.value;
      else if (ev.kind === 'param') applyParam(loop.p, ev.key, ev.value, ev.factor);
      else loop.freeze(ev.duration);
    }
    const s = loop.step();
    for (const k of keys) trace[k][i] = s[k];
    for (const key of Object.keys(trace.dist)) trace.dist[key][i] = loop.d[key];
  }
  return { scenario, trace, Ts: loop.Ts };
}

function applyParam(p: Params, key: string, value?: number, factor?: number) {
  if (!(key in p)) return;
  if (value !== undefined) p[key] = value;
  else if (factor !== undefined) p[key] *= factor;
}

export function runAll(proc: ProcessDef, setup: LoopSetup, scenarioIds?: string[]) {
  return proc.scenarios.filter((s) => !scenarioIds || scenarioIds.includes(s.id)).map((s) => runScenario(proc, setup, s));
}
