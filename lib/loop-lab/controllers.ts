import { fromPct2, measuredDisturbances, pvSpan, toPct, toPct2, type Characterization, type Params, type ProcessDef, type ProcessId } from './model';

// Control strategies. Every controller runs once per cycle (T_s), takes the
// setpoint and the measurement in engineering units and returns the valve
// signal in %. Internally they work in % of span, as a DCS or a PLC with
// scaled inputs would.

export type AntiWindup = 'clamp' | 'backcalc' | 'none';

/** Ideal (ISA, non-interacting) PID with setpoint weighting, as PID_Compact uses. */
export type PidParams = {
  /** Proportional gain, % output per % of span (dimensionless). */
  Kc: number;
  /** Integral time, s (0 = no integral action). */
  Ti: number;
  /** Derivative time, s (0 = no derivative action). */
  Td: number;
  /** Setpoint weight on the proportional term (b). */
  b: number;
  /** Setpoint weight on the derivative term (c). */
  c: number;
  /** Derivative filter ratio: filter time constant = a·Td. */
  a: number;
  antiWindup: AntiWindup;
  outLo: number;
  outHi: number;
  /** Reverse the control direction (for a process where more output lowers the PV). */
  invert: boolean;
};

export type SchedulePoint = { at: number; Kc: number; Ti: number; Td: number };

/**
 * One feedforward term: a measured disturbance through a lead-lag,
 * gain·(lead·s + 1)/(lag·s + 1)·(d − d₀). Its output is added to the valve
 * signal (PID + feedforward) or to the inner setpoint (cascade), in % per unit
 * of the disturbance.
 */
export type FeedforwardTerm = { from: string; gain: number; lead: number; lag: number };

export type ControllerConfig =
  | { kind: 'onoff'; hyst: number; outOn: number; outOff: number }
  | { kind: 'pid'; pid: PidParams }
  | { kind: 'schedule'; pid: PidParams; on: 'pv' | 'sp'; points: SchedulePoint[] }
  | { kind: 'characterized'; pid: PidParams; char: string }
  | { kind: 'feedforward'; pid: PidParams; ff: FeedforwardTerm[] }
  | { kind: 'cascade'; outer: PidParams; inner: PidParams; ff: FeedforwardTerm[] };

export type ControllerKind = ControllerConfig['kind'];

export type ControllerInternals = {
  P: number; I: number; D: number; Kc: number; Ti: number; Td: number; e: number;
  /** Inner setpoint (cascade), engineering units; NaN otherwise. */
  sp2: number;
  /** Feedforward contribution, % (of output, or of the inner span in cascade). */
  ff: number;
};

/** Signals besides SP and PV: the inner measurement and the (measured) disturbances. */
export type ControllerAux = { pv2: number; d: Params };

export interface ControllerInstance {
  /** One cycle: setpoint and measurement (engineering units) → valve signal (%). */
  step(sp: number, pv: number, aux: ControllerAux): number;
  /** Manual mode: follow the valve signal being written, so switching to auto is bumpless. */
  track(valve: number, sp: number, pv: number, aux: ControllerAux): void;
  internals(): ControllerInternals;
}

export type Complexity = {
  /** Numbers someone has to choose and keep right. */
  tuningParams: number;
  /** What the strategy needs to know about the process beyond a bump test. */
  needsModel: string | null;
  extraInstruments: number;
  /** 1 (switch on and tune) … 5 (needs an engineer and plant tests). */
  commissioning: number;
  /** 1 (only its designer can touch it) … 5 (any technician can). */
  maintainability: number;
};

export type ControllerMeta = {
  kind: ControllerKind;
  name: string;
  short: string;
  /** Position on the controller ladder. */
  rung: number;
  icon: string;
};

export const CONTROLLER_KINDS: ControllerMeta[] = [
  { kind: 'onoff', name: 'On-off with hysteresis', short: 'On-off', rung: 1, icon: '⏻' },
  { kind: 'pid', name: 'PID', short: 'PID', rung: 2, icon: '🎛️' },
  { kind: 'schedule', name: 'Gain-scheduled PID', short: 'Gain scheduling', rung: 3, icon: '🗺️' },
  { kind: 'characterized', name: 'Characterized PID', short: 'Characterization', rung: 4, icon: '📐' },
  { kind: 'feedforward', name: 'PID with feedforward', short: 'Feedforward', rung: 5, icon: '⏩' },
  { kind: 'cascade', name: 'Cascade control', short: 'Cascade', rung: 6, icon: '🪜' },
];
export const controllerMeta = (kind: ControllerKind) => CONTROLLER_KINDS.find((c) => c.kind === kind)!;

/** Which controllers a process can run: feedforward needs a measured disturbance, cascade an inner measurement. */
export function isAvailable(proc: ProcessDef, kind: ControllerKind) {
  if (kind === 'characterized') return proc.characterizations.length > 0;
  if (kind === 'feedforward') return measuredDisturbances(proc).length > 0;
  if (kind === 'cascade') return !!proc.secondary;
  return true;
}

export const DEFAULT_PID: PidParams = { Kc: 1, Ti: 10, Td: 0, b: 1, c: 0, a: 0.1, antiWindup: 'clamp', outLo: 0, outHi: 100, invert: false };

/**
 * A starting PI for each process (SIMC). The conical tank's is tuned at the
 * bottom of the range, where a tank is usually first commissioned: the
 * baseline its case study starts from.
 */
export const BASELINE_PI: Record<ProcessId, Pick<PidParams, 'Kc' | 'Ti' | 'Td'>> = {
  flow: { Kc: 0.45, Ti: 1.8, Td: 0 },
  tank: { Kc: 3, Ti: 245, Td: 0 },
  stirred: { Kc: 9, Ti: 430, Td: 0 },
  hx: { Kc: 1.5, Ti: 29, Td: 0 },
  custom: { Kc: 1.2, Ti: 20, Td: 0 },
};

/** Starting cascade tunings (inner steam-flow PI, outer temperature PI) and feedforward. */
export const BASELINE_CASCADE: Partial<Record<ProcessId, { inner: Pick<PidParams, 'Kc' | 'Ti' | 'Td'>; outer: Pick<PidParams, 'Kc' | 'Ti' | 'Td'> }>> = {
  hx: { inner: { Kc: 1.8, Ti: 2.25, Td: 0 }, outer: { Kc: 1.5, Ti: 31, Td: 0 } },
};
export const BASELINE_FF: Partial<Record<ProcessId, { valve: FeedforwardTerm[]; inner: FeedforwardTerm[] }>> = {
  hx: {
    valve: [{ from: 'F', gain: 5, lead: 0, lag: 0 }, { from: 'Tin', gain: -1.24, lead: 0, lag: 0 }],
    inner: [{ from: 'F', gain: 4, lead: 0, lag: 0 }, { from: 'Tin', gain: -1, lead: 0, lag: 0 }],
  },
};

export function defaultController(kind: ControllerKind, proc: ProcessDef): ControllerConfig {
  const pid: PidParams = { ...DEFAULT_PID, ...BASELINE_PI[proc.id] };
  if (kind === 'onoff') return { kind, hyst: 2, outOn: 100, outOff: 0 };
  if (kind === 'pid') return { kind, pid };
  if (kind === 'schedule') {
    return { kind, pid, on: 'pv', points: proc.opPoints.map((at) => ({ at, Kc: pid.Kc, Ti: pid.Ti, Td: pid.Td })) };
  }
  const firstMeasured = measuredDisturbances(proc)[0]?.key ?? '';
  if (kind === 'feedforward') {
    return { kind, pid, ff: BASELINE_FF[proc.id]?.valve ?? (firstMeasured ? [{ from: firstMeasured, gain: 0, lead: 0, lag: 0 }] : []) };
  }
  if (kind === 'cascade') {
    const c = BASELINE_CASCADE[proc.id];
    return {
      kind,
      outer: { ...pid, ...c?.outer },
      inner: { ...DEFAULT_PID, ...(c?.inner ?? { Kc: 0.5, Ti: 3, Td: 0 }) },
      ff: [],
    };
  }
  return { kind, pid, char: proc.characterizations[0]?.id ?? '' };
}

/** Feedforward terms that would make sense in cascade (into the inner setpoint) for this process. */
export const defaultInnerFeedforward = (proc: ProcessDef): FeedforwardTerm[] =>
  BASELINE_FF[proc.id]?.inner ?? measuredDisturbances(proc).slice(0, 1).map((d) => ({ from: d.key, gain: 0, lead: 0, lag: 0 }));

// ─── Running a controller ───────────────────────────────────────────────────

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Interpolated gains for a schedule at a value of the scheduling variable. */
export function scheduledGains(points: SchedulePoint[], at: number): Omit<SchedulePoint, 'at'> {
  const pts = [...points].sort((p, q) => p.at - q.at);
  if (!pts.length) return { Kc: 0, Ti: 0, Td: 0 };
  if (at <= pts[0].at) return pts[0];
  const last = pts[pts.length - 1];
  if (at >= last.at) return last;
  const i = pts.findIndex((p) => p.at > at);
  const lo = pts[i - 1], hi = pts[i];
  const w = (at - lo.at) / (hi.at - lo.at);
  const mix = (x: number, y: number) => x + w * (y - x);
  return { Kc: mix(lo.Kc, hi.Kc), Ti: mix(lo.Ti, hi.Ti), Td: mix(lo.Td, hi.Td) };
}

export function findCharacterization(proc: ProcessDef, id: string): Characterization | undefined {
  return proc.characterizations.find((c) => c.id === id);
}

/**
 * The measurement scaling the controller works in: % of span, or % of the
 * characterized variable's span. `model` is the controller's copy of the
 * process parameters (what the engineer believed when commissioning).
 */
export function controlScale(proc: ProcessDef, config: ControllerConfig, model: Params) {
  const ch = config.kind === 'characterized' ? findCharacterization(proc, config.char) : undefined;
  if (ch?.on === 'pv') {
    const f0 = ch.f(proc.pv.lo, model), f1 = ch.f(proc.pv.hi, model);
    return { toC: (v: number) => ((ch.f(v, model) - f0) / (f1 - f0)) * 100, out: (u: number) => u, back: (v: number) => v };
  }
  if (ch?.on === 'cv') {
    return { toC: (v: number) => toPct(proc, v), out: (u: number) => ch.f(u, model), back: (v: number) => (ch.inv ? ch.inv(v, model) : v) };
  }
  return { toC: (v: number) => toPct(proc, v), out: (u: number) => u, back: (v: number) => v };
}

/**
 * The discrete PID itself: integral kept in output units (gain changes don't
 * bump), backward-Euler filtered derivative, three anti-windup options, and
 * an external hold (a cascade master stops integrating while its slave is saturated).
 */
class PidCore {
  I = 0;
  D = 0;
  private prevEd: number | null = null;
  constructor(private pid: PidParams, private Ts: number) {}

  run(e: number, eP: number, eD: number, g: { Kc: number; Ti: number; Td: number }, bias: number, hold = 0) {
    const { pid, Ts } = this;
    const P = g.Kc * eP;
    if (g.Td > 0 && this.prevEd !== null) {
      const Tf = Math.max(pid.a * g.Td, 1e-6);
      this.D = (Tf / (Tf + Ts)) * this.D + ((g.Kc * g.Td) / (Tf + Ts)) * (eD - this.prevEd);
    } else this.D = 0;
    this.prevEd = eD;
    const Inext = g.Ti > 0 ? this.I + ((g.Kc * Ts) / g.Ti) * e : this.I;
    const v = P + Inext + this.D + bias;
    const u = clamp(v, pid.outLo, pid.outHi);
    const inc = Inext - this.I;
    if ((hold > 0 && inc > 0) || (hold < 0 && inc < 0)) { /* the slave is saturated: hold */ }
    else if (pid.antiWindup === 'none' || g.Ti <= 0) this.I = Inext;
    else if (pid.antiWindup === 'clamp') {
      if (!((v > pid.outHi && inc > 0) || (v < pid.outLo && inc < 0))) this.I = Inext;
    } else {
      const Tt = g.Td > 0 ? Math.sqrt(g.Ti * g.Td) : g.Ti;
      this.I = Inext + (Ts / Math.max(Tt, Ts)) * (u - v);
    }
    return { u, P, sat: v > pid.outHi ? 1 : v < pid.outLo ? -1 : 0 };
  }

  /** Preload so the output equals `u` right now. */
  track(u: number, eP: number, eD: number, Kc: number, bias: number) {
    this.D = 0;
    this.prevEd = eD;
    this.I = clamp(u, this.pid.outLo, this.pid.outHi) - Kc * eP - bias;
  }
}

/** Discrete lead-lag on a measured disturbance, zero at the value it starts from. */
class FeedforwardCore {
  private x0: number | null = null;
  private xPrev = 0;
  private y = 0;
  constructor(private term: FeedforwardTerm, private Ts: number) {}

  step(d: Params) {
    const raw = d[this.term.from];
    if (!Number.isFinite(raw)) return 0;
    if (this.x0 === null) this.x0 = raw;
    const x = raw - this.x0;
    const { lead, lag } = this.term, Ts = this.Ts;
    // Backward Euler of (lead·s + 1)/(lag·s + 1).
    this.y = (lag / (lag + Ts)) * this.y + ((lead + Ts) / (lag + Ts)) * x - (lead / (lag + Ts)) * this.xPrev;
    this.xPrev = x;
    return this.term.gain * this.y;
  }

  /** Restart from the present disturbance values (bumpless). */
  reset(d: Params) {
    this.x0 = d[this.term.from] ?? null;
    this.xPrev = 0;
    this.y = 0;
  }
}

const errorsOf = (pid: PidParams, s: number, y: number) => {
  const sign = pid.invert ? -1 : 1;
  return { e: sign * (s - y), eP: sign * (pid.b * s - y), eD: sign * (pid.c * s - y) };
};

export function createController(proc: ProcessDef, config: ControllerConfig, model: Params, Ts: number): ControllerInstance {
  if (config.kind === 'onoff') {
    let on = false;
    const mid = (config.outOn + config.outOff) / 2;
    let last = { e: 0 };
    return {
      step(sp, pv) {
        const e = toPct(proc, sp) - toPct(proc, pv);
        if (e > config.hyst / 2) on = true;
        else if (e < -config.hyst / 2) on = false;
        last = { e };
        return on ? config.outOn : config.outOff;
      },
      track(valve) { on = valve > mid; },
      internals: () => ({ P: 0, I: 0, D: 0, Kc: 0, Ti: 0, Td: 0, e: last.e, sp2: NaN, ff: 0 }),
    };
  }

  if (config.kind === 'cascade') return createCascade(proc, config, Ts);

  const pid = config.pid;
  const scale = controlScale(proc, config, model);
  const core = new PidCore(pid, Ts);
  const ffs = config.kind === 'feedforward' ? config.ff.map((t) => new FeedforwardCore(t, Ts)) : [];
  let last: ControllerInternals = { P: 0, I: 0, D: 0, Kc: pid.Kc, Ti: pid.Ti, Td: pid.Td, e: 0, sp2: NaN, ff: 0 };
  const gains = (sp: number, pv: number) =>
    config.kind === 'schedule' ? scheduledGains(config.points, config.on === 'sp' ? sp : pv) : { Kc: pid.Kc, Ti: pid.Ti, Td: pid.Td };

  return {
    step(sp, pv, aux) {
      const g = gains(sp, pv);
      const { e, eP, eD } = errorsOf(pid, scale.toC(sp), scale.toC(pv));
      const ff = ffs.reduce((s, f) => s + f.step(aux.d), 0);
      const { u, P } = core.run(e, eP, eD, g, ff);
      last = { P, I: core.I, D: core.D, ...g, e, sp2: NaN, ff };
      return scale.out(u);
    },
    track(valve, sp, pv, aux) {
      const g = gains(sp, pv);
      const { e, eP, eD } = errorsOf(pid, scale.toC(sp), scale.toC(pv));
      ffs.forEach((f) => f.reset(aux.d));
      core.track(scale.back(valve), eP, eD, g.Kc, 0);
      last = { P: g.Kc * eP, I: core.I, D: 0, ...g, e, sp2: NaN, ff: 0 };
    },
    internals: () => last,
  };
}

/**
 * Cascade: the outer (master) PID on the main PV sets the inner (slave)
 * setpoint, in % of the secondary span; the inner PID drives the valve.
 * Feedforward adds to the inner setpoint. While the slave is saturated the
 * master holds its integral, so it doesn't wind up through the slave.
 */
function createCascade(proc: ProcessDef, config: Extract<ControllerConfig, { kind: 'cascade' }>, Ts: number): ControllerInstance {
  const sec = proc.secondary!;
  const outer = new PidCore(config.outer, Ts), inner = new PidCore(config.inner, Ts);
  const ffs = config.ff.map((t) => new FeedforwardCore(t, Ts));
  let innerSat = 0;
  let last: ControllerInternals = { P: 0, I: 0, D: 0, Kc: config.outer.Kc, Ti: config.outer.Ti, Td: config.outer.Td, e: 0, sp2: NaN, ff: 0 };
  const gOuter = { Kc: config.outer.Kc, Ti: config.outer.Ti, Td: config.outer.Td };
  const gInner = { Kc: config.inner.Kc, Ti: config.inner.Ti, Td: config.inner.Td };

  return {
    step(sp, pv, aux) {
      const o = errorsOf(config.outer, toPct(proc, sp), toPct(proc, pv));
      const ff = ffs.reduce((s, f) => s + f.step(aux.d), 0);
      const { u: u1, P } = outer.run(o.e, o.eP, o.eD, gOuter, ff, innerSat);
      const sp2 = fromPct2(sec, u1);
      const i = errorsOf(config.inner, u1, toPct2(sec, aux.pv2));
      const r = inner.run(i.e, i.eP, i.eD, gInner, 0);
      innerSat = r.sat * (config.inner.invert ? -1 : 1);
      last = { P, I: outer.I, D: outer.D, ...gOuter, e: o.e, sp2, ff };
      return r.u;
    },
    track(valve, sp, pv, aux) {
      // The slave follows the valve with its setpoint at the present measurement; the master follows that setpoint.
      const y2 = toPct2(sec, aux.pv2);
      const i = errorsOf(config.inner, y2, y2);
      inner.track(valve, i.eP, i.eD, gInner.Kc, 0);
      const o = errorsOf(config.outer, toPct(proc, sp), toPct(proc, pv));
      ffs.forEach((f) => f.reset(aux.d));
      outer.track(y2, o.eP, o.eD, gOuter.Kc, 0);
      innerSat = 0;
      last = { P: gOuter.Kc * o.eP, I: outer.I, D: 0, ...gOuter, e: o.e, sp2: aux.pv2, ff: 0 };
    },
    internals: () => last,
  };
}

// ─── Linear view of a controller (for analysis) ─────────────────────────────

export type LinearPid = PidParams & { slope: number };

/** The controller acting at one operating point, as linear blocks; null for on-off. */
export type LinearController =
  | { kind: 'single'; pid: LinearPid; ff: FeedforwardTerm[] }
  | { kind: 'cascade'; outer: LinearPid; inner: LinearPid; ff: FeedforwardTerm[] };

/**
 * The PID acting at one operating point, with the local slope of any
 * characterization folded into a loop-gain factor. Null for on-off, which has
 * no linear model. (For cascade: the outer PID.)
 */
export function linearPidAt(proc: ProcessDef, config: ControllerConfig, model: Params, pv: number, valve: number): LinearPid | null {
  if (config.kind === 'onoff') return null;
  if (config.kind === 'cascade') return { ...config.outer, slope: 1 };
  const g = config.kind === 'schedule' ? scheduledGains(config.points, pv) : config.pid;
  const scale = controlScale(proc, config, model);
  let slope = 1;
  if (config.kind === 'characterized') {
    const ch = findCharacterization(proc, config.char);
    if (ch?.on === 'pv') {
      const h = pvSpan(proc) * 1e-4;
      slope = (scale.toC(pv + h) - scale.toC(pv - h)) / (toPct(proc, pv + h) - toPct(proc, pv - h));
    } else if (ch?.on === 'cv') {
      const u = scale.back(valve), du = 0.01;
      slope = (scale.out(u + du) - scale.out(u - du)) / (2 * du);
    }
  }
  return { ...config.pid, Kc: g.Kc, Ti: g.Ti, Td: g.Td, slope: Number.isFinite(slope) ? slope : 1 };
}

export function linearControllerAt(proc: ProcessDef, config: ControllerConfig, model: Params, pv: number, valve: number): LinearController | null {
  if (config.kind === 'onoff') return null;
  if (config.kind === 'cascade') return { kind: 'cascade', outer: { ...config.outer, slope: 1 }, inner: { ...config.inner, slope: 1 }, ff: config.ff };
  return { kind: 'single', pid: linearPidAt(proc, config, model, pv, valve)!, ff: config.kind === 'feedforward' ? config.ff : [] };
}

// ─── Cost of complexity ─────────────────────────────────────────────────────

const pidCount = (p: { Ti: number; Td: number }) => 1 + (p.Ti > 0 ? 1 : 0) + (p.Td > 0 ? 1 : 0);
const ffModelNote = 'How the disturbance and the valve each move the PV (gain and dynamics of both)';

export function complexity(proc: ProcessDef, config: ControllerConfig): Complexity {
  if (config.kind === 'onoff') {
    return { tuningParams: 1, needsModel: null, extraInstruments: 0, commissioning: 1, maintainability: 5 };
  }
  if (config.kind === 'pid') {
    return { tuningParams: pidCount(config.pid), needsModel: null, extraInstruments: 0, commissioning: config.pid.Td > 0 ? 2 : 1, maintainability: 5 };
  }
  if (config.kind === 'schedule') {
    const per = config.points.reduce((n, p) => n + pidCount(p), 0);
    return {
      tuningParams: per + config.points.length,
      needsModel: 'A bump test (or a model) at every scheduling point',
      extraInstruments: 0, commissioning: 4, maintainability: 3,
    };
  }
  if (config.kind === 'feedforward') {
    return {
      tuningParams: pidCount(config.pid) + 3 * config.ff.length,
      needsModel: config.ff.length ? ffModelNote : null,
      extraInstruments: config.ff.length, commissioning: 3, maintainability: 4,
    };
  }
  if (config.kind === 'cascade') {
    const ff = config.ff.length;
    return {
      tuningParams: pidCount(config.outer) + pidCount(config.inner) + 3 * ff,
      needsModel: ff ? ffModelNote : null,
      extraInstruments: 1 + ff, commissioning: ff ? 4 : 3, maintainability: ff ? 3 : 4,
    };
  }
  const ch = findCharacterization(proc, config.char);
  return {
    tuningParams: pidCount(config.pid),
    needsModel: ch ? `The ${ch.on === 'pv' ? 'process' : 'valve'} nonlinearity: ${ch.label.toLowerCase()}` : 'The process nonlinearity',
    extraInstruments: 0, commissioning: 2, maintainability: 4,
  };
}

// ─── Validation (for configs from links and the notebook) ──────────────────

const num = (v: unknown, lo: number, hi: number, fallback: number) => {
  const n = Number(v);
  return Number.isFinite(n) ? clamp(n, lo, hi) : fallback;
};

function cleanPid(raw: unknown, fallback: PidParams): PidParams {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const outLo = num(r.outLo, -100, 200, fallback.outLo);
  return {
    Kc: num(r.Kc, 0, 1000, fallback.Kc),
    Ti: num(r.Ti, 0, 1e6, fallback.Ti),
    Td: num(r.Td, 0, 1e5, fallback.Td),
    b: num(r.b, 0, 1, fallback.b),
    c: num(r.c, 0, 1, fallback.c),
    a: num(r.a, 0.01, 1, fallback.a),
    antiWindup: r.antiWindup === 'backcalc' || r.antiWindup === 'none' || r.antiWindup === 'clamp' ? r.antiWindup : fallback.antiWindup,
    outLo,
    outHi: num(r.outHi, outLo + 1, 200, Math.max(fallback.outHi, outLo + 1)),
    invert: typeof r.invert === 'boolean' ? r.invert : fallback.invert,
  };
}

function cleanFeedforward(raw: unknown, proc: ProcessDef): FeedforwardTerm[] {
  const keys = new Set(measuredDisturbances(proc).map((d) => d.key));
  const list = Array.isArray(raw) ? raw.slice(0, 3) : [];
  return list.flatMap((t: unknown) => {
    const r = (t && typeof t === 'object' ? t : {}) as Record<string, unknown>;
    if (typeof r.from !== 'string' || !keys.has(r.from)) return [];
    return [{ from: r.from, gain: num(r.gain, -1e4, 1e4, 0), lead: num(r.lead, 0, 1e5, 0), lag: num(r.lag, 0, 1e5, 0) }];
  });
}

export function cleanController(raw: unknown, proc: ProcessDef): ControllerConfig {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const wanted = CONTROLLER_KINDS.some((k) => k.kind === r.kind) ? (r.kind as ControllerKind) : 'pid';
  const kind = isAvailable(proc, wanted) ? wanted : 'pid';
  const base = defaultController(kind, proc);
  if (base.kind === 'onoff') {
    return { kind: 'onoff', hyst: num(r.hyst, 0, 50, base.hyst), outOn: num(r.outOn, 0, 100, base.outOn), outOff: num(r.outOff, 0, 100, base.outOff) };
  }
  if (base.kind === 'cascade') {
    return { kind: 'cascade', outer: cleanPid(r.outer, base.outer), inner: cleanPid(r.inner, base.inner), ff: cleanFeedforward(r.ff, proc) };
  }
  const pid = cleanPid(r.pid, base.pid);
  if (base.kind === 'pid') return { kind: 'pid', pid };
  if (base.kind === 'feedforward') return { kind: 'feedforward', pid, ff: Array.isArray(r.ff) ? cleanFeedforward(r.ff, proc) : base.ff };
  if (base.kind === 'schedule') {
    const pts = Array.isArray(r.points) ? r.points.slice(0, 8) : base.points;
    const points = pts.map((p: unknown, i: number) => {
      const q = (p && typeof p === 'object' ? p : {}) as Record<string, unknown>;
      const d = base.points[Math.min(i, base.points.length - 1)];
      return { at: num(q.at, proc.pv.lo, proc.pv.hi, d.at), Kc: num(q.Kc, 0, 1000, d.Kc), Ti: num(q.Ti, 0, 1e6, d.Ti), Td: num(q.Td, 0, 1e5, d.Td) };
    });
    return { kind: 'schedule', pid, on: r.on === 'sp' ? 'sp' : 'pv', points: points.length ? points : base.points };
  }
  const char = proc.characterizations.some((c) => c.id === r.char) ? String(r.char) : base.char;
  return { kind: 'characterized', pid, char };
}

/** One line describing a controller's settings, for lists and the notebook. */
export function describeController(proc: ProcessDef, config: ControllerConfig) {
  const fmt = (v: number) => Number(v.toPrecision(3)).toString();
  const pidText = (p: { Kc: number; Ti: number; Td: number }) =>
    `Kc ${fmt(p.Kc)}${p.Ti > 0 ? `, Ti ${fmt(p.Ti)} s` : ''}${p.Td > 0 ? `, Td ${fmt(p.Td)} s` : ''}`;
  const ffText = (ff: FeedforwardTerm[]) => ff.map((t) => {
    const d = proc.disturbances.find((x) => x.key === t.from);
    return `FF from ${d?.label.toLowerCase() ?? t.from} ×${fmt(t.gain)}${t.lead || t.lag ? ` (lead ${fmt(t.lead)} s / lag ${fmt(t.lag)} s)` : ''}`;
  }).join(', ');
  if (config.kind === 'onoff') return `On-off, hysteresis ${fmt(config.hyst)} %`;
  if (config.kind === 'pid') return `${config.pid.Td > 0 ? 'PID' : config.pid.Ti > 0 ? 'PI' : 'P'}: ${pidText(config.pid)}`;
  if (config.kind === 'schedule') {
    return `Scheduled on ${config.on.toUpperCase()}: ${config.points.map((p) => `${fmt(p.at)} ${proc.pv.unit} → ${pidText(p)}`).join('; ')}`;
  }
  if (config.kind === 'feedforward') return `PID ${pidText(config.pid)}${config.ff.length ? ` + ${ffText(config.ff)}` : ''}`;
  if (config.kind === 'cascade') return `Cascade: outer ${pidText(config.outer)}; inner ${pidText(config.inner)}${config.ff.length ? ` + ${ffText(config.ff)}` : ''}`;
  const ch = findCharacterization(proc, config.char);
  return `${ch?.label ?? 'Characterized'} + ${pidText(config.pid)}`;
}
