import { pvSpan, toPct, type Characterization, type Params, type ProcessDef, type ProcessId } from './model';

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

export type ControllerConfig =
  | { kind: 'onoff'; hyst: number; outOn: number; outOff: number }
  | { kind: 'pid'; pid: PidParams }
  | { kind: 'schedule'; pid: PidParams; on: 'pv' | 'sp'; points: SchedulePoint[] }
  | { kind: 'characterized'; pid: PidParams; char: string };

export type ControllerKind = ControllerConfig['kind'];

export type ControllerInternals = { P: number; I: number; D: number; Kc: number; Ti: number; Td: number; e: number };

export interface ControllerInstance {
  /** One cycle: setpoint and measurement (engineering units) → valve signal (%). */
  step(sp: number, pv: number): number;
  /** Manual mode: follow the valve signal being written, so switching to auto is bumpless. */
  track(valve: number, sp: number, pv: number): void;
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
];
export const controllerMeta = (kind: ControllerKind) => CONTROLLER_KINDS.find((c) => c.kind === kind)!;

export const DEFAULT_PID: PidParams = { Kc: 1, Ti: 10, Td: 0, b: 1, c: 0, a: 0.1, antiWindup: 'clamp', outLo: 0, outHi: 100, invert: false };

/**
 * A starting PI for each process: tuned (SIMC) at the bottom of the range, where
 * a tank is usually first commissioned. Good for the flow loop everywhere;
 * for the tank it is the baseline the case study starts from.
 */
export const BASELINE_PI: Record<ProcessId, Pick<PidParams, 'Kc' | 'Ti' | 'Td'>> = {
  flow: { Kc: 0.45, Ti: 1.8, Td: 0 },
  tank: { Kc: 3, Ti: 245, Td: 0 },
};

export function defaultController(kind: ControllerKind, proc: ProcessDef): ControllerConfig {
  const pid: PidParams = { ...DEFAULT_PID, ...BASELINE_PI[proc.id] };
  if (kind === 'onoff') return { kind, hyst: 2, outOn: 100, outOff: 0 };
  if (kind === 'pid') return { kind, pid };
  if (kind === 'schedule') {
    return { kind, pid, on: 'pv', points: proc.opPoints.map((at) => ({ at, Kc: pid.Kc, Ti: pid.Ti, Td: pid.Td })) };
  }
  return { kind, pid, char: proc.characterizations[0]?.id ?? '' };
}

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

export function createController(proc: ProcessDef, config: ControllerConfig, model: Params, Ts: number): ControllerInstance {
  const scale = controlScale(proc, config, model);

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
      internals: () => ({ P: 0, I: 0, D: 0, Kc: 0, Ti: 0, Td: 0, e: last.e }),
    };
  }

  const pid = config.pid;
  let I = 0, D = 0, prevEd: number | null = null;
  let last: ControllerInternals = { P: 0, I: 0, D: 0, Kc: pid.Kc, Ti: pid.Ti, Td: pid.Td, e: 0 };

  const gains = (sp: number, pv: number) => {
    if (config.kind !== 'schedule') return { Kc: pid.Kc, Ti: pid.Ti, Td: pid.Td };
    return scheduledGains(config.points, config.on === 'sp' ? sp : pv);
  };
  const errors = (sp: number, pv: number) => {
    const s = scale.toC(sp), y = scale.toC(pv), sign = pid.invert ? -1 : 1;
    return { e: sign * (s - y), eP: sign * (pid.b * s - y), eD: sign * (pid.c * s - y) };
  };
  const derivative = (eD: number, Kc: number, Td: number) => {
    if (Td <= 0 || prevEd === null) return 0;
    const Tf = Math.max(pid.a * Td, 1e-6);
    return (Tf / (Tf + Ts)) * D + ((Kc * Td) / (Tf + Ts)) * (eD - prevEd);
  };

  return {
    step(sp, pv) {
      const { Kc, Ti, Td } = gains(sp, pv);
      const { e, eP, eD } = errors(sp, pv);
      const P = Kc * eP;
      D = derivative(eD, Kc, Td);
      prevEd = eD;
      const Inext = Ti > 0 ? I + ((Kc * Ts) / Ti) * e : I;
      const v = P + Inext + D;
      const u = clamp(v, pid.outLo, pid.outHi);
      if (pid.antiWindup === 'none' || Ti <= 0) I = Inext;
      else if (pid.antiWindup === 'clamp') {
        const inc = Inext - I;
        if (!((v > pid.outHi && inc > 0) || (v < pid.outLo && inc < 0))) I = Inext;
      } else {
        const Tt = Td > 0 ? Math.sqrt(Ti * Td) : Ti;
        I = Inext + (Ts / Math.max(Tt, Ts)) * (u - v);
      }
      last = { P, I, D, Kc, Ti, Td, e };
      return scale.out(u);
    },
    track(valve, sp, pv) {
      const { Kc } = gains(sp, pv);
      const { e, eP, eD } = errors(sp, pv);
      D = 0;
      prevEd = eD;
      I = clamp(scale.back(valve), pid.outLo, pid.outHi) - Kc * eP;
      last = { P: Kc * eP, I, D: 0, Kc, Ti: last.Ti, Td: last.Td, e };
    },
    internals: () => last,
  };
}

// ─── Linear view of a controller (for analysis) ─────────────────────────────

/**
 * The PID acting at one operating point, with the local slope of any
 * characterization folded into a loop-gain factor. Null for on-off, which has
 * no linear model.
 */
export function linearPidAt(proc: ProcessDef, config: ControllerConfig, model: Params, pv: number, valve: number) {
  if (config.kind === 'onoff') return null;
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
export type LinearPid = NonNullable<ReturnType<typeof linearPidAt>>;

// ─── Cost of complexity ─────────────────────────────────────────────────────

export function complexity(proc: ProcessDef, config: ControllerConfig): Complexity {
  if (config.kind === 'onoff') {
    return { tuningParams: 1, needsModel: null, extraInstruments: 0, commissioning: 1, maintainability: 5 };
  }
  const pidCount = (p: { Ti: number; Td: number }) => 1 + (p.Ti > 0 ? 1 : 0) + (p.Td > 0 ? 1 : 0);
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

export function cleanController(raw: unknown, proc: ProcessDef): ControllerConfig {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const kind = CONTROLLER_KINDS.some((k) => k.kind === r.kind) ? (r.kind as ControllerKind) : 'pid';
  const base = defaultController(kind, proc);
  if (base.kind === 'onoff') {
    return { kind: 'onoff', hyst: num(r.hyst, 0, 50, base.hyst), outOn: num(r.outOn, 0, 100, base.outOn), outOff: num(r.outOff, 0, 100, base.outOff) };
  }
  const pid = cleanPid(r.pid, base.pid);
  if (base.kind === 'pid') return { kind: 'pid', pid };
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
  if (config.kind === 'onoff') return `On-off, hysteresis ${fmt(config.hyst)} %`;
  if (config.kind === 'pid') return `${config.pid.Td > 0 ? 'PID' : config.pid.Ti > 0 ? 'PI' : 'P'}: ${pidText(config.pid)}`;
  if (config.kind === 'schedule') {
    return `Scheduled on ${config.on.toUpperCase()}: ${config.points.map((p) => `${fmt(p.at)} ${proc.pv.unit} → ${pidText(p)}`).join('; ')}`;
  }
  const ch = findCharacterization(proc, config.char);
  return `${ch?.label ?? 'Characterized'} + ${pidText(config.pid)}`;
}
