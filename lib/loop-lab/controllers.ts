import { fromPct, fromPct2, measuredDisturbances, nominalDisturbances, pvSpan, toPct, toPct2, valveCharacteristic, type Characterization, type Params, type ProcessDef, type ProcessId } from './model';
import { designStateFb, type StateFbDesign } from './statespace';

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

/**
 * The Smith predictor's copy of the process: K·e^{−θs}/(τs + 1), from the
 * controller output (%) to the measurement (% of span). θ is the whole dead
 * time the loop sees, half a controller cycle included.
 */
export type SmithModel = { K: number; tau: number; theta: number };

export type ControllerConfig =
  | { kind: 'onoff'; hyst: number; outOn: number; outOff: number }
  | { kind: 'pid'; pid: PidParams }
  | { kind: 'schedule'; pid: PidParams; on: 'pv' | 'sp'; points: SchedulePoint[] }
  | { kind: 'characterized'; pid: PidParams; char: string }
  | { kind: 'feedforward'; pid: PidParams; ff: FeedforwardTerm[] }
  | { kind: 'cascade'; outer: PidParams; inner: PidParams; ff: FeedforwardTerm[] }
  | { kind: 'smith'; pid: PidParams; model: SmithModel }
  /**
   * Override: a second controller with its own (limit) setpoint, on the same
   * measurement or on the secondary one; the higher or lower of the two
   * outputs drives the valve. With
   * tracking, the controller not in charge follows the one that is (external
   * reset feedback), so it can take over without unwinding first.
   */
  | { kind: 'override'; pid: PidParams; ovr: PidParams; on: 'pv' | 'pv2'; limit: number; select: 'max' | 'min'; tracking: boolean }
  /**
   * Ratio: the controlled flow's setpoint is R × the wild flow. R is fixed, or
   * set by an outer (trim) controller on the main PV over [rLo, rHi].
   */
  | { kind: 'ratio'; outer: PidParams; inner: PidParams; trim: boolean; ratio: number; rLo: number; rHi: number }
  /**
   * State feedback with an observer. The controller holds a linear model of
   * the plant (linearized at its design point), estimates every state from the
   * measurements and feeds them all back: u = u₀ − K·x̂ − K_z·∫e + N_r·r.
   * K by pole placement (a dominant pair ω_n, ζ) or LQR (weights on the PV, the
   * secondary measurement and the integral, against 1 on the output); the
   * observer by pole placement (a multiple of the regulator's poles) or as a
   * Kalman filter (load upsets it expects, against the transmitter noise).
   * Offset-free with an integral of the error, or by estimating a constant
   * disturbance in the observer and cancelling it.
   */
  | {
    kind: 'statefb'; design: 'poles' | 'lqr'; wn: number; zeta: number; qy: number; q2: number; qi: number;
    observer: 'poles' | 'kalman'; obsSpeed: number; qw: number; measure: 'pv' | 'pv2' | 'both'; integral: 'none' | 'error' | 'dist';
  };

export type ControllerKind = ControllerConfig['kind'];

export type ControllerInternals = {
  P: number; I: number; D: number; Kc: number; Ti: number; Td: number; e: number;
  /** Inner setpoint (cascade), engineering units; NaN otherwise. */
  sp2: number;
  /** Feedforward contribution, % (of output, or of the inner span in cascade). */
  ff: number;
  /** Smith predictor: the measurement as the PID sees it, with the dead time predicted away (engineering units); NaN otherwise. */
  pred: number;
  /** Override: the override controller's own output, %; NaN otherwise. */
  alt: number;
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
  { kind: 'smith', name: 'Smith predictor', short: 'Smith predictor', rung: 7, icon: '🔮' },
  { kind: 'override', name: 'Override (selector) control', short: 'Override', rung: 8, icon: '🚧' },
  { kind: 'ratio', name: 'Ratio control', short: 'Ratio', rung: 9, icon: '⚗️' },
  { kind: 'statefb', name: 'State feedback with an observer (pole placement, LQR, Kalman)', short: 'State feedback', rung: 10, icon: '🧭' },
];
export const controllerMeta = (kind: ControllerKind) => CONTROLLER_KINDS.find((c) => c.kind === kind)!;

/** Which controllers a process can run: feedforward needs a measured disturbance, cascade an inner measurement. */
export function isAvailable(proc: ProcessDef, kind: ControllerKind) {
  if (kind === 'characterized') return proc.characterizations.length > 0;
  if (kind === 'feedforward') return measuredDisturbances(proc).length > 0;
  if (kind === 'cascade') return !!proc.secondary && !proc.secondary.measureOnly;
  if (kind === 'ratio') return !!proc.secondary && !!proc.ratio;
  return true;
}

export const DEFAULT_PID: PidParams = { Kc: 1, Ti: 10, Td: 0, b: 1, c: 0, a: 0.1, antiWindup: 'clamp', outLo: 0, outHi: 100, invert: false };

/**
 * A starting PI for each process (SIMC). The conical tank's is tuned at the
 * bottom of the range, where a tank is usually first commissioned: the
 * baseline its case study starts from.
 */
export const BASELINE_PI: Record<ProcessId, Pick<PidParams, 'Kc' | 'Ti' | 'Td'> & Partial<PidParams>> = {
  flow: { Kc: 0.45, Ti: 1.8, Td: 0 },
  tank: { Kc: 3, Ti: 245, Td: 0 },
  stirred: { Kc: 9, Ti: 430, Td: 0 },
  hx: { Kc: 1.5, Ti: 29, Td: 0 },
  surge: { Kc: 6, Ti: 450, Td: 0, invert: true },
  feeder: { Kc: 0.1, Ti: 5.5, Td: 0 },
  drum: { Kc: 0.7, Ti: 740, Td: 0 },
  jacket: { Kc: 3.2, Ti: 170, Td: 0 },
  blend: { Kc: 0.4, Ti: 38.5, Td: 0 },
  // The crane's and the drive's are about the most a PI can do on the load before the swing (or the shaft) rings.
  crane: { Kc: 0.2, Ti: 100, Td: 0 },
  servo: { Kc: 0.8, Ti: 1, Td: 0 },
  // Unstable: PD first (the derivative is what stabilizes it), a slow integral, and a setpoint weight so a gap change doesn't kick the coil.
  maglev: { Kc: 4, Ti: 0.15, Td: 0.02, a: 0.2, b: 0.3, invert: true },
  custom: { Kc: 1.2, Ti: 20, Td: 0 },
};

/** Starting cascade tunings (inner steam-flow PI, outer temperature PI) and feedforward. */
export const BASELINE_CASCADE: Partial<Record<ProcessId, { inner: Pick<PidParams, 'Kc' | 'Ti' | 'Td'>; outer: Pick<PidParams, 'Kc' | 'Ti' | 'Td'> }>> = {
  hx: { inner: { Kc: 1.8, Ti: 2.25, Td: 0 }, outer: { Kc: 1.5, Ti: 31, Td: 0 } },
  drum: { inner: { Kc: 1, Ti: 2.5, Td: 0 }, outer: { Kc: 0.6, Ti: 740, Td: 0 } },
  blend: { inner: { Kc: 0.88, Ti: 1.75, Td: 0 }, outer: { Kc: 0.4, Ti: 38.6, Td: 0 } },
};
export const BASELINE_FF: Partial<Record<ProcessId, { valve: FeedforwardTerm[]; inner: FeedforwardTerm[] }>> = {
  hx: {
    valve: [{ from: 'F', gain: 5, lead: 0, lag: 0 }, { from: 'Tin', gain: -1.24, lead: 0, lag: 0 }],
    inner: [{ from: 'F', gain: 4, lead: 0, lag: 0 }, { from: 'Tin', gain: -1, lead: 0, lag: 0 }],
  },
  // Steam flow into feedwater: 1 t/h more steam, 1 t/h more feedwater (1 % of the valve, 0.83 % of FT-502's span).
  drum: { valve: [{ from: 'qs', gain: 1, lead: 0, lag: 0 }], inner: [{ from: 'qs', gain: 0.833, lead: 0, lag: 0 }] },
  // Diluent flow into concentrate: the ratio 0.25 (1 % of the valve, 1 % of FT-802's 0–25 m³/h, per m³/h).
  blend: { valve: [{ from: 'FA', gain: 1, lead: 0, lag: 0 }], inner: [{ from: 'FA', gain: 1, lead: 0, lag: 0 }] },
};

/** Starting Smith predictors: the model from the plant's step response, the PI tuned for the undelayed part. */
export const BASELINE_SMITH: Partial<Record<ProcessId, { pid: Pick<PidParams, 'Kc' | 'Ti' | 'Td'>; model: SmithModel }>> = {
  feeder: { pid: { Kc: 0.41, Ti: 5.5, Td: 0 }, model: { K: 0.8, tau: 5.5, theta: 32.8 } },
};

/** Starting overrides: a high-level limit on the surge tank, tight, above the averaging controller. */
export const BASELINE_OVERRIDE: Partial<Record<ProcessId, { pid: Pick<PidParams, 'Kc' | 'Ti' | 'Td'> & Partial<PidParams>; ovr: Pick<PidParams, 'Kc' | 'Ti' | 'Td'> & Partial<PidParams>; on: 'pv' | 'pv2'; limit: number; select: 'max' | 'min' }>> = {
  surge: { pid: { Kc: 0.73, Ti: 3920, Td: 0, invert: true }, ovr: { Kc: 6, Ti: 450, Td: 0, invert: true }, on: 'pv', limit: 2.4, select: 'max' },
  // The boiler can spare 1000 kg/h: a steam flow limiter under the temperature controller.
  hx: { pid: { Kc: 1.5, Ti: 29, Td: 0 }, ovr: { Kc: 1.8, Ti: 2.25, Td: 0 }, on: 'pv2', limit: 1000, select: 'min' },
};
/** Starting ratio loops: the flow slave, and a slow trim on the analyzer. */
export const BASELINE_RATIO: Partial<Record<ProcessId, { inner: Pick<PidParams, 'Kc' | 'Ti' | 'Td'>; outer: Pick<PidParams, 'Kc' | 'Ti' | 'Td'> }>> = {
  blend: { inner: { Kc: 0.88, Ti: 1.75, Td: 0 }, outer: { Kc: 0.5, Ti: 38.6, Td: 0 } },
};

type StateFbSettings = Omit<Extract<ControllerConfig, { kind: 'statefb' }>, 'kind'>;
/** Starting state-feedback designs, checked on each process's tests. */
export const BASELINE_STATEFB: Partial<Record<ProcessId, Partial<StateFbSettings>>> = {
  crane: { design: 'poles', wn: 0.5, zeta: 0.8, qy: 100, q2: 100, integral: 'dist', observer: 'kalman', qw: 1, obsSpeed: 2, measure: 'both' },
  servo: { design: 'poles', wn: 40, zeta: 0.7, qy: 100, q2: 0, integral: 'dist', observer: 'kalman', qw: 3, obsSpeed: 2, measure: 'both' },
  maglev: { design: 'poles', wn: 60, zeta: 0.8, qy: 1000, integral: 'dist', observer: 'kalman', qw: 3, obsSpeed: 2, measure: 'pv' },
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
  if (kind === 'override') {
    const b = BASELINE_OVERRIDE[proc.id];
    const span = pvSpan(proc);
    return {
      kind, pid: { ...pid, ...b?.pid }, ovr: { ...pid, ...(b?.ovr ?? { Kc: pid.Kc * 3, Ti: pid.Ti }) }, on: b?.on ?? 'pv',
      limit: b?.limit ?? Math.min(proc.pv.hi, proc.nominalPv + 0.3 * span), select: b?.select ?? (pid.invert ? 'max' : 'min'), tracking: true,
    };
  }
  if (kind === 'ratio') {
    const b = BASELINE_RATIO[proc.id], r = proc.ratio;
    return {
      kind, outer: { ...pid, ...b?.outer }, inner: { ...DEFAULT_PID, ...(b?.inner ?? { Kc: 0.5, Ti: 3, Td: 0 }) },
      trim: true, ratio: r?.nominal ?? 1, rLo: r?.lo ?? 0, rHi: r?.hi ?? 2,
    };
  }
  if (kind === 'smith') {
    const b = BASELINE_SMITH[proc.id];
    return { kind, pid: { ...pid, ...b?.pid }, model: b?.model ?? { K: 1, tau: 10, theta: 5 } };
  }
  if (kind === 'statefb') {
    // Without a checked design: weights for a closed loop about as fast as the tests are long allow.
    const T = (proc.scenarios[0]?.duration ?? 100) / 20;
    return {
      kind, design: 'lqr', wn: 4 / T, zeta: 0.8, qy: 1, q2: 0, qi: 1 / (T * T), observer: 'kalman', obsSpeed: 2, qw: 1,
      measure: proc.secondary ? 'both' : 'pv', integral: 'error', ...BASELINE_STATEFB[proc.id],
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
      internals: () => ({ P: 0, I: 0, D: 0, Kc: 0, Ti: 0, Td: 0, e: last.e, sp2: NaN, ff: 0, pred: NaN, alt: NaN }),
    };
  }

  if (config.kind === 'cascade') return createCascade(proc, config, Ts);
  if (config.kind === 'smith') return createSmith(proc, config, Ts);
  if (config.kind === 'override') return createOverride(proc, config, Ts);
  if (config.kind === 'ratio') return createRatio(proc, config, Ts);
  if (config.kind === 'statefb') return createStateFb(proc, config, model);

  const pid = config.pid;
  const scale = controlScale(proc, config, model);
  const core = new PidCore(pid, Ts);
  const ffs = config.kind === 'feedforward' ? config.ff.map((t) => new FeedforwardCore(t, Ts)) : [];
  let last: ControllerInternals = { P: 0, I: 0, D: 0, Kc: pid.Kc, Ti: pid.Ti, Td: pid.Td, e: 0, sp2: NaN, ff: 0, pred: NaN, alt: NaN };
  const gains = (sp: number, pv: number) =>
    config.kind === 'schedule' ? scheduledGains(config.points, config.on === 'sp' ? sp : pv) : { Kc: pid.Kc, Ti: pid.Ti, Td: pid.Td };

  return {
    step(sp, pv, aux) {
      const g = gains(sp, pv);
      const { e, eP, eD } = errorsOf(pid, scale.toC(sp), scale.toC(pv));
      const ff = ffs.reduce((s, f) => s + f.step(aux.d), 0);
      const { u, P } = core.run(e, eP, eD, g, ff);
      last = { P, I: core.I, D: core.D, ...g, e, sp2: NaN, ff, pred: NaN, alt: NaN };
      return scale.out(u);
    },
    track(valve, sp, pv, aux) {
      const g = gains(sp, pv);
      const { e, eP, eD } = errorsOf(pid, scale.toC(sp), scale.toC(pv));
      ffs.forEach((f) => f.reset(aux.d));
      core.track(scale.back(valve), eP, eD, g.Kc, 0);
      last = { P: g.Kc * eP, I: core.I, D: 0, ...g, e, sp2: NaN, ff: 0, pred: NaN, alt: NaN };
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
  let last: ControllerInternals = { P: 0, I: 0, D: 0, Kc: config.outer.Kc, Ti: config.outer.Ti, Td: config.outer.Td, e: 0, sp2: NaN, ff: 0, pred: NaN, alt: NaN };
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
      last = { P, I: outer.I, D: outer.D, ...gOuter, e: o.e, sp2, ff, pred: NaN, alt: NaN };
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
      last = { P: gOuter.Kc * o.eP, I: outer.I, D: 0, ...gOuter, e: o.e, sp2: aux.pv2, ff: 0, pred: NaN, alt: NaN };
    },
    internals: () => last,
  };
}

/**
 * Smith predictor: a model of the process without its dead time runs beside
 * the plant, and a delayed copy of it. The PID is fed the measurement plus
 * (undelayed − delayed model): what the measurement will be once the dead time
 * has passed. With a perfect model the PID only sees the fast part of the
 * process, so it can be tuned as if the dead time weren't there.
 */
function createSmith(proc: ProcessDef, config: Extract<ControllerConfig, { kind: 'smith' }>, Ts: number): ControllerInstance {
  const { pid, model } = config;
  const core = new PidCore(pid, Ts);
  const g = { Kc: pid.Kc, Ti: pid.Ti, Td: pid.Td };
  // Exact discretization of K/(τs + 1) behind a hold; the hold's half cycle is part of θ.
  const a = model.tau > 0 ? Math.exp(-Ts / model.tau) : 0;
  const n = Math.max(0, Math.floor(model.theta / Ts + 1e-9));
  const buf = new Array<number>(n).fill(0);
  let head = 0, ym = 0, u0 = 0;
  let last: ControllerInternals = { P: 0, I: 0, D: 0, ...g, e: 0, sp2: NaN, ff: 0, pred: NaN, alt: NaN };
  const delayed = () => (n ? buf[head] : ym);
  const advance = (u: number) => {
    if (n) { buf[head] = ym; head = (head + 1) % n; }
    ym = a * ym + (1 - a) * model.K * (u - u0);
  };
  const span = pvSpan(proc);

  return {
    step(sp, pv) {
      const yfb = toPct(proc, pv) + ym - delayed();
      const { e, eP, eD } = errorsOf(pid, toPct(proc, sp), yfb);
      const { u, P } = core.run(e, eP, eD, g, 0);
      advance(u);
      last = { P, I: core.I, D: core.D, ...g, e, sp2: NaN, ff: 0, pred: proc.pv.lo + (yfb / 100) * span, alt: NaN };
      return u;
    },
    track(valve, sp, pv) {
      // Restart the model from here: no prediction until the controller moves the output.
      u0 = valve; ym = 0; head = 0; buf.fill(0);
      const { e, eP, eD } = errorsOf(pid, toPct(proc, sp), toPct(proc, pv));
      core.track(valve, eP, eD, g.Kc, 0);
      last = { P: g.Kc * eP, I: core.I, D: 0, ...g, e, sp2: NaN, ff: 0, pred: pv, alt: NaN };
    },
    internals: () => last,
  };
}

/**
 * Override: both controllers run every cycle on the same measurement, the
 * selector picks one output. With tracking (external reset feedback), the
 * integral of the one not selected follows the selected output through its
 * own Ti lag: its output is then the valve signal plus its own P and D, so it
 * takes over smoothly exactly when its error says it should. Without, it runs
 * on its own against its output limits.
 */
function createOverride(proc: ProcessDef, config: Extract<ControllerConfig, { kind: 'override' }>, Ts: number): ControllerInstance {
  const main = new PidCore(config.pid, Ts), ovr = new PidCore(config.ovr, Ts);
  const gM = { Kc: config.pid.Kc, Ti: config.pid.Ti, Td: config.pid.Td };
  const gO = { Kc: config.ovr.Kc, Ti: config.ovr.Ti, Td: config.ovr.Td };
  let last: ControllerInternals = { P: 0, I: 0, D: 0, ...gM, e: 0, sp2: NaN, ff: 0, pred: NaN, alt: NaN };
  const pick = (a: number, b: number) => (config.select === 'max' ? Math.max(a, b) : Math.min(a, b));
  const sec = proc.secondary;
  // The override's measurement and limit, in % of their span.
  const onSec = config.on === 'pv2' && !!sec;
  const ovrErrors = (pv: number, aux: ControllerAux) => (onSec
    ? errorsOf(config.ovr, toPct2(sec!, config.limit), toPct2(sec!, aux.pv2))
    : errorsOf(config.ovr, toPct(proc, config.limit), toPct(proc, pv)));
  return {
    step(sp, pv, aux) {
      const y = toPct(proc, pv);
      const a = errorsOf(config.pid, toPct(proc, sp), y), b = ovrErrors(pv, aux);
      const ra = main.run(a.e, a.eP, a.eD, gM, 0), rb = ovr.run(b.e, b.eP, b.eD, gO, 0);
      const u = pick(ra.u, rb.u);
      const overridden = u !== ra.u;
      if (config.tracking) {
        const idle = overridden ? main : ovr, Ti = overridden ? gM.Ti : gO.Ti;
        idle.I += (Ts / Math.max(Ti > 0 ? Ti : Ts, Ts)) * (u - idle.I);
      }
      last = { P: ra.P, I: main.I, D: main.D, ...gM, e: a.e, sp2: NaN, ff: 0, pred: NaN, alt: rb.u };
      return u;
    },
    track(valve, sp, pv, aux) {
      const y = toPct(proc, pv);
      const a = errorsOf(config.pid, toPct(proc, sp), y), b = ovrErrors(pv, aux);
      main.track(valve, a.eP, a.eD, gM.Kc, 0);
      // The override starts wherever it would be in auto: its integral on the valve signal if it tracks, else pinned at its far limit.
      ovr.track(config.select === 'max' ? config.ovr.outLo : config.ovr.outHi, b.eP, b.eD, gO.Kc, 0);
      if (config.tracking) ovr.I = valve;
      last = { P: gM.Kc * a.eP, I: main.I, D: 0, ...gM, e: a.e, sp2: NaN, ff: 0, pred: NaN, alt: valve };
    },
    internals: () => last,
  };
}

/**
 * Ratio: the inner (flow) controller's setpoint is R × the wild flow. With
 * trim, the outer controller's output (0–100 %) sets R over [rLo, rHi]; the
 * outer holds its integral while the inner is saturated, as in cascade.
 */
function createRatio(proc: ProcessDef, config: Extract<ControllerConfig, { kind: 'ratio' }>, Ts: number): ControllerInstance {
  const sec = proc.secondary!, from = proc.ratio?.from ?? '';
  const outer = new PidCore(config.outer, Ts), inner = new PidCore(config.inner, Ts);
  const gO = { Kc: config.outer.Kc, Ti: config.outer.Ti, Td: config.outer.Td };
  const gI = { Kc: config.inner.Kc, Ti: config.inner.Ti, Td: config.inner.Td };
  const range = config.rHi - config.rLo || 1;
  let innerSat = 0;
  let last: ControllerInternals = { P: 0, I: 0, D: 0, ...gO, e: 0, sp2: NaN, ff: 0, pred: NaN, alt: NaN };
  return {
    step(sp, pv, aux) {
      const wild = Math.max(0, aux.d[from] ?? 0);
      const o = errorsOf(config.outer, toPct(proc, sp), toPct(proc, pv));
      let R = config.ratio, P = 0;
      if (config.trim) {
        const r = outer.run(o.e, o.eP, o.eD, gO, 0, innerSat);
        R = config.rLo + (r.u / 100) * range;
        P = r.P;
      }
      const sp2 = Math.min(sec.hi, Math.max(sec.lo, R * wild));
      const i = errorsOf(config.inner, toPct2(sec, sp2), toPct2(sec, aux.pv2));
      const ri = inner.run(i.e, i.eP, i.eD, gI, 0);
      innerSat = ri.sat * (config.inner.invert ? -1 : 1);
      last = { P, I: outer.I, D: outer.D, ...gO, e: o.e, sp2, ff: 0, pred: NaN, alt: NaN };
      return ri.u;
    },
    track(valve, sp, pv, aux) {
      const y2 = toPct2(sec, aux.pv2);
      const i = errorsOf(config.inner, y2, y2);
      inner.track(valve, i.eP, i.eD, gI.Kc, 0);
      // The trim follows the ratio the operator is running at.
      const wild = Math.max(1e-6, aux.d[from] ?? 0);
      const o = errorsOf(config.outer, toPct(proc, sp), toPct(proc, pv));
      outer.track(((aux.pv2 / wild - config.rLo) / range) * 100, o.eP, o.eD, gO.Kc, 0);
      innerSat = 0;
      last = { P: gO.Kc * o.eP, I: outer.I, D: 0, ...gO, e: o.e, sp2: aux.pv2, ff: 0, pred: NaN, alt: NaN };
    },
    internals: () => last,
  };
}

/**
 * State feedback with an observer, run as the discretized design: each cycle
 * the observer takes in the output it applied last cycle and the new
 * measurements, then the output is computed from the estimate. The integral
 * stops while the output is saturated; the observer always sees the clamped
 * output, so it doesn't wind up either. Everything in deviations from the
 * design point, in %.
 */
function createStateFb(proc: ProcessDef, config: Extract<ControllerConfig, { kind: 'statefb' }>, model: Params): ControllerInstance {
  const des = designStateFb(proc, config, model);
  const { n, integral } = des;
  const extra = des.mode !== 'none';
  let xc = new Array(n + (extra ? 1 : 0)).fill(0);
  let uPrev = des.u0;
  const sec = proc.secondary;
  const meas = (pv: number, aux: ControllerAux) => des.inputs.map((k) => (k === 'pv' ? toPct(proc, pv) - des.y0 : toPct2(sec!, aux.pv2) - des.y20));
  const dot = (a: number[], b: number[]) => a.reduce((s, v, i) => s + v * b[i], 0);
  const feedback = () => -dot(des.K, xc);
  const intPart = () => (extra ? des.ctrl.C[n] * xc[n] : 0);
  const estimate = () => fromPct(proc, des.y0 + dot(des.Cpv, xc));
  const blank: ControllerInternals = { P: 0, I: 0, D: 0, Kc: 0, Ti: 0, Td: 0, e: 0, sp2: NaN, ff: 0, pred: NaN, alt: NaN };
  let last = blank;
  const report = (r: number, pv: number) => {
    last = { ...blank, P: feedback(), I: intPart(), ff: des.Nr * r, e: r + des.y0 - toPct(proc, pv), pred: estimate() };
  };
  return {
    step(sp, pv, aux) {
      if (!des.ok) return uPrev;
      const r = toPct(proc, sp) - des.y0;
      const w = [uPrev - des.u0, ...meas(pv, aux), r];
      const z0 = extra ? xc[n] : 0;
      const { Phi, Gamma } = des.disc;
      xc = Phi.map((row, i) => dot(row, xc) + dot(Gamma[i], w));
      const out = () => des.u0 + feedback() + intPart() + des.Nr * r;
      let v = out();
      if (integral) {
        const push = des.ctrl.C[n] * (xc[n] - z0);
        if ((v > 100 && push > 0) || (v < 0 && push < 0)) { xc[n] = z0; v = out(); }
      }
      uPrev = clamp(v, 0, 100);
      report(r, pv);
      return uPrev;
    },
    track(valve, sp, pv) {
      // Start from the steady state that matches the measurement, with the integral (or the
      // disturbance estimate) holding the valve where it is.
      const r = toPct(proc, sp) - des.y0, dy = toPct(proc, pv) - des.y0;
      xc = [...des.Nx.map((v) => v * dy), ...(extra ? [0] : [])];
      if (extra && des.ctrl.C[n]) xc[n] = (valve - des.u0 - feedback() - des.Nr * r) / des.ctrl.C[n];
      uPrev = valve;
      report(r, pv);
    },
    internals: () => last,
  };
}

// ─── Linear view of a controller (for analysis) ─────────────────────────────

export type LinearPid = PidParams & { slope: number };

/** The controller acting at one operating point, as linear blocks; null for on-off. */
export type LinearController =
  | { kind: 'single'; pid: LinearPid; ff: FeedforwardTerm[] }
  | { kind: 'cascade'; outer: LinearPid; inner: LinearPid; ff: FeedforwardTerm[] }
  | { kind: 'smith'; pid: LinearPid; model: SmithModel; ff: FeedforwardTerm[] }
  /** A controller given as a linear system from the measurements and the setpoint to the output (state feedback). */
  | { kind: 'ss'; ss: StateFbDesign['ctrl']; inputs: ('pv' | 'pv2')[]; ff: FeedforwardTerm[] };

/**
 * The PID acting at one operating point, with the local slope of any
 * characterization folded into a loop-gain factor. Null for on-off, which has
 * no linear model. (For cascade: the outer PID.)
 */
export function linearPidAt(proc: ProcessDef, config: ControllerConfig, model: Params, pv: number, valve: number): LinearPid | null {
  if (config.kind === 'onoff') return null;
  if (config.kind === 'statefb') return { ...DEFAULT_PID, Kc: 0, Ti: 0, Td: 0, slope: 1 };
  if (config.kind === 'cascade') return { ...config.outer, slope: 1 };
  if (config.kind === 'smith' || config.kind === 'override') return { ...config.pid, slope: 1 };
  if (config.kind === 'ratio') return { ...config.outer, ...(config.trim ? {} : { Kc: 0, Ti: 0, Td: 0 }), slope: ratioAt(proc, config, model, valve).slope };
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
  if (config.kind === 'statefb') {
    const des = designStateFb(proc, config, model);
    return des.ok ? { kind: 'ss', ss: des.ctrl, inputs: des.inputs, ff: [] } : null;
  }
  if (config.kind === 'cascade') return { kind: 'cascade', outer: { ...config.outer, slope: 1 }, inner: { ...config.inner, slope: 1 }, ff: config.ff };
  if (config.kind === 'smith') return { kind: 'smith', pid: { ...config.pid, slope: 1 }, model: config.model, ff: [] };
  if (config.kind === 'override') return { kind: 'single', pid: { ...config.pid, slope: 1 }, ff: [] };
  if (config.kind === 'ratio') {
    // Linearized, R × F_A is a cascade: the trim's output scaled by F_A, plus feedforward R₀ from F_A.
    const r = ratioAt(proc, config, model, valve);
    return {
      kind: 'cascade', outer: linearPidAt(proc, config, model, pv, valve)!, inner: { ...config.inner, slope: 1 },
      ff: [{ from: proc.ratio!.from, gain: r.ffGain, lead: 0, lag: 0 }],
    };
  }
  return { kind: 'single', pid: linearPidAt(proc, config, model, pv, valve)!, ff: config.kind === 'feedforward' ? config.ff : [] };
}

/**
 * The ratio station at an operating point: δSP₂ = R₀·δF_A + F_A₀·δR, in % of the
 * secondary span. `slope`: SP₂ % per % of trim output; `ffGain`: SP₂ % per unit of F_A.
 */
export function ratioAt(proc: ProcessDef, config: Extract<ControllerConfig, { kind: 'ratio' }>, model: Params, valve: number) {
  const sec = proc.secondary!, span2 = sec.hi - sec.lo;
  const d = nominalDisturbances(proc);
  const wild = d[proc.ratio!.from] || 1;
  const flow = valveCharacteristic(model.valveChar, valve / 100);
  const x = proc.steady(flow, d, model) ?? proc.states.map(() => 0);
  const R0 = sec.of(x, flow, d, model) / wild;
  return { R0, wild, slope: (wild * (config.rHi - config.rLo)) / span2, ffGain: (R0 * 100) / span2 };
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
  if (config.kind === 'override') {
    return {
      tuningParams: pidCount(config.pid) + pidCount(config.ovr) + 1,
      needsModel: null, extraInstruments: 0, commissioning: 3, maintainability: config.tracking ? 4 : 3,
    };
  }
  if (config.kind === 'ratio') {
    return {
      tuningParams: pidCount(config.inner) + (config.trim ? pidCount(config.outer) + 2 : 1),
      needsModel: 'The ratio the recipe needs (a mass balance), and the range the trim may move it over',
      extraInstruments: 2, commissioning: 3, maintainability: 4,
    };
  }
  if (config.kind === 'statefb') {
    return {
      tuningParams: (config.design === 'lqr' ? (proc.secondary ? 2 : 1) : 2) + (config.integral === 'error' && config.design === 'lqr' ? 1 : 0) + 1,
      needsModel: 'A state-space model of the whole loop around the design point: every state, the actuator and transmitters included',
      extraInstruments: config.measure === 'both' ? 1 : 0, commissioning: 5, maintainability: 1,
    };
  }
  if (config.kind === 'smith') {
    return {
      tuningParams: pidCount(config.pid) + 3,
      needsModel: 'Gain, lag and dead time of the process, the dead time accurately (a 20 % error can make the loop worse than plain PI)',
      extraInstruments: 0, commissioning: 4, maintainability: 2,
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
  if (base.kind === 'override') {
    const pidC = cleanPid(r.pid, base.pid);
    const on = r.on === 'pv2' && proc.secondary && !proc.secondary.measureOnly ? 'pv2' : r.on === 'pv' ? 'pv' : base.on;
    const range = on === 'pv2' ? proc.secondary! : proc.pv;
    return {
      kind: 'override', pid: pidC, ovr: cleanPid(r.ovr, base.ovr), on,
      limit: num(r.limit, range.lo, range.hi, on === base.on ? base.limit : (range.lo + range.hi) / 2), select: r.select === 'min' || r.select === 'max' ? r.select : base.select,
      tracking: typeof r.tracking === 'boolean' ? r.tracking : base.tracking,
    };
  }
  if (base.kind === 'ratio') {
    const rLo = num(r.rLo, 0, 1e4, base.rLo);
    const rHi = num(r.rHi, rLo + 1e-6, 1e4, Math.max(base.rHi, rLo + 1e-6));
    return {
      kind: 'ratio', outer: cleanPid(r.outer, base.outer), inner: cleanPid(r.inner, base.inner),
      trim: typeof r.trim === 'boolean' ? r.trim : base.trim, ratio: num(r.ratio, 0, 1e4, base.ratio), rLo, rHi,
    };
  }
  if (base.kind === 'statefb') {
    const measure = r.measure === 'pv' || ((r.measure === 'pv2' || r.measure === 'both') && proc.secondary) ? (r.measure as 'pv' | 'pv2' | 'both') : base.measure;
    return {
      kind: 'statefb', design: r.design === 'poles' || r.design === 'lqr' ? r.design : base.design,
      wn: num(r.wn, 1e-4, 1e4, base.wn), zeta: num(r.zeta, 0.1, 3, base.zeta),
      qy: num(r.qy, 0, 1e8, base.qy), q2: num(r.q2, 0, 1e8, base.q2), qi: num(r.qi, 0, 1e8, base.qi),
      observer: r.observer === 'poles' || r.observer === 'kalman' ? r.observer : base.observer,
      obsSpeed: num(r.obsSpeed, 1, 20, base.obsSpeed), qw: num(r.qw, 1e-4, 1e4, base.qw), measure,
      integral: r.integral === 'none' || r.integral === 'error' || r.integral === 'dist' ? r.integral : base.integral,
    };
  }
  if (base.kind === 'smith') {
    const m = (r.model && typeof r.model === 'object' ? r.model : {}) as Record<string, unknown>;
    return {
      kind: 'smith', pid: cleanPid(r.pid, base.pid),
      model: { K: num(m.K, -1e4, 1e4, base.model.K), tau: num(m.tau, 0, 1e6, base.model.tau), theta: num(m.theta, 0, 1e5, base.model.theta) },
    };
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
  if (config.kind === 'override') {
    const on = config.on === 'pv2' && proc.secondary ? proc.secondary : proc.pv;
    return `Override: ${pidText(config.pid)}; ${config.select === 'max' ? 'high' : 'low'} select with a ${on.label.toLowerCase()} limit at ${fmt(config.limit)} ${on.unit} (${pidText(config.ovr)})${config.tracking ? ', tracking' : ', no tracking'}`;
  }
  if (config.kind === 'ratio') {
    return `Ratio ${proc.secondary?.label.toLowerCase() ?? 'flow'} / ${proc.disturbances.find((d) => d.key === proc.ratio?.from)?.label.toLowerCase() ?? 'wild flow'}: ${config.trim ? `trimmed over ${fmt(config.rLo)}–${fmt(config.rHi)} (${pidText(config.outer)})` : `fixed at ${fmt(config.ratio)}`}; flow loop ${pidText(config.inner)}`;
  }
  if (config.kind === 'statefb') {
    const on = config.measure === 'both' ? `${proc.pv.label.toLowerCase()} and ${proc.secondary?.label.toLowerCase()}` : config.measure === 'pv2' ? `${proc.secondary?.label.toLowerCase()} only` : proc.pv.label.toLowerCase();
    const reg = config.design === 'lqr'
      ? `LQR (q_y ${fmt(config.qy)}${proc.secondary && config.q2 ? `, q₂ ${fmt(config.q2)}` : ''}${config.integral === 'error' ? `, q_i ${fmt(config.qi)}` : ''})`
      : `poles at ω_n ${fmt(config.wn)} rad/s, ζ ${fmt(config.zeta)}`;
    const obs = config.observer === 'kalman' ? `Kalman filter (load upsets ${fmt(config.qw)})` : `observer ${fmt(config.obsSpeed)}× faster`;
    return `State feedback, ${reg}${config.integral === 'error' ? ' + integral' : config.integral === 'dist' ? ' + disturbance estimate' : ''}; ${obs} on ${on}`;
  }
  if (config.kind === 'smith') return `Smith predictor:${pidText(config.pid)}; model K ${fmt(config.model.K)}, τ ${fmt(config.model.tau)} s, θ ${fmt(config.model.theta)} s`;
  if (config.kind === 'cascade') return `Cascade: outer ${pidText(config.outer)}; inner ${pidText(config.inner)}${config.ff.length ? ` + ${ffText(config.ff)}` : ''}`;
  const ch = findCharacterization(proc, config.char);
  return `${ch?.label ?? 'Characterized'} + ${pidText(config.pid)}`;
}
