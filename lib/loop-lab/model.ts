// The pieces a Loop Lab loop is made of: a process (physics), the instruments
// around it (control valve, transmitter) and the tests it is put through.
// Controllers live in controllers.ts; simulation in sim.ts.

export type ParamGroup = 'process' | 'valve' | 'transmitter' | 'controller';

export type ParamSpec = {
  key: string;
  label: string;
  symbol?: string;
  unit: string;
  default: number;
  min: number;
  max: number;
  step?: number;
  group: ParamGroup;
  /** Where the value comes from, or what it means physically. */
  note?: string;
  /** A choice rather than a number (stored as the option's value). */
  options?: { value: number; label: string }[];
};

export type Params = Record<string, number>;

export type DisturbanceSpec = {
  key: string;
  label: string;
  unit: string;
  nominal: number;
  min: number;
  max: number;
  note?: string;
  /** Transmitter tag when the disturbance is measured (so feedforward can use it). */
  measured?: string;
};

export type StateSpec = { key: string; label: string; unit: string };

/** Measured variable: what the transmitter reads and the range it is scaled over. */
export type PvSpec = {
  label: string;
  symbol: string;
  unit: string;
  lo: number;
  hi: number;
  decimals: number;
};

/**
 * A second measurement between the valve and the main process variable (steam
 * flow ahead of a heat exchanger's temperature): what an inner cascade loop controls.
 */
export type SecondarySpec = PvSpec & {
  tag: string;
  /** Inner loop tag (e.g. FIC-301). */
  loopTag: string;
  /** The (unmeasured) disturbance that acts on this flow, such as its supply pressure. */
  upset?: string;
  /** A measurement for state feedback only, not something an inner loop could control (a crane's sway angle). */
  measureOnly?: boolean;
  of(x: number[], flow: number, d: Params, p: Params): number;
};

export type ScenarioEvent =
  | { t: number; kind: 'sp'; value: number }
  | { t: number; kind: 'dist'; key: string; value: number }
  /** A change to a parameter: a set value, or a factor on its current value. */
  | { t: number; kind: 'param'; key: string; value?: number; factor?: number }
  /** The transmitter holds its last reading for a while (a frozen or failed input). */
  | { t: number; kind: 'freeze'; duration: number };

export type Scenario = {
  id: string;
  name: string;
  /** What the test is checking, in a sentence. */
  purpose: string;
  duration: number;
  initialSp: number;
  /** Disturbances the test starts at (steady), instead of the nominal ones. */
  initialDist?: Params;
  events: ScenarioEvent[];
};

/**
 * A nonlinear inversion offered for this process: on the measurement
 * (control a transformed variable) or on the controller output.
 */
export type Characterization = {
  id: string;
  label: string;
  on: 'pv' | 'cv';
  /** pv: engineering value → transformed value. cv: controller % → valve %. */
  f: (v: number, p: Params) => number;
  /** cv only: valve % → controller % (for bumpless tracking in manual). */
  inv?: (v: number, p: Params) => number;
  unit?: string;
  note: string;
};

export type ProcessId = 'flow' | 'tank' | 'stirred' | 'hx' | 'surge' | 'feeder' | 'drum' | 'jacket' | 'blend' | 'crane' | 'servo' | 'maglev' | 'custom';

export type ProcessDef = {
  id: ProcessId;
  name: string;
  icon: string;
  summary: string;
  /** "Where PID is the right answer" or "where PID falls short". */
  family: 'pid-wins' | 'escalation';
  pv: PvSpec;
  /** Inner measurement for cascade control, if the process has one. */
  secondary?: SecondarySpec;
  tags: { loop: string; transmitter: string; valve: string };
  states: StateSpec[];
  params: ParamSpec[];
  disturbances: DisturbanceSpec[];
  /**
   * Process state derivatives. `flow` is the valve's flow fraction after its
   * characteristic (0–1), which is what the process sees.
   */
  derivatives(x: number[], flow: number, d: Params, p: Params): number[];
  /** The true process value (engineering units). */
  pvOf(x: number[], flow: number, d: Params, p: Params): number;
  /** Process states at steady state for a valve flow fraction, or null if there is none. */
  steady(flow: number, d: Params, p: Params): number[] | null;
  /**
   * Steady state for a PV directly, for processes where the valve position can't
   * be found by searching (integrating ones hold any level at one valve position).
   */
  steadyAt?: (pv: number, d: Params, p: Params) => { valve: number; x: number[] } | null;
  /** Test script times are in units of this (s), for processes whose speed is a parameter. */
  timeScale?: (p: Params) => number;
  /** Fastest process time constant (s), when the process has dynamics faster than its instruments: sets the integration step. */
  fastest?: (p: Params) => number;
  /**
   * A buffer whose level is there to absorb upsets (averaging level control):
   * it may swing `swing` % of span when the inflow changes by `upset` % of the
   * outlet's capacity. Auto-tuning then aims to use that room, not hold the level.
   */
  averaging?: { swing: number; upset: number };
  /**
   * Ratio control: the secondary (controlled) flow's setpoint is a ratio times
   * this measured disturbance (the wild flow), in the same units.
   */
  ratio?: { from: string; lo: number; hi: number; nominal: number };
  /** Split-range: one controller output drives two valves (the split point and gap are valve parameters). */
  split?: { low: string; high: string };
  /** Operating points (PV values) to linearize and test at: low, nominal, high. */
  opPoints: number[];
  nominalPv: number;
  /** Parameters varied for robustness checks, with their ± spread (fraction). */
  uncertain: { key: string; spread: number }[];
  scenarios: Scenario[];
  characterizations: Characterization[];
};

// ─── Instruments shared by every process ────────────────────────────────────

export const VALVE_CHARS = [
  { value: 0, label: 'Linear' },
  { value: 1, label: 'Equal percentage' },
  { value: 2, label: 'Quick opening' },
];
const RANGEABILITY = 50;

/** Inherent valve characteristic: stem position (0–1) → flow fraction at constant Δp (0–1). */
export function valveCharacteristic(kind: number, s: number) {
  const x = Math.min(1, Math.max(0, s));
  if (kind === 1) return (RANGEABILITY ** x - 1) / (RANGEABILITY - 1);
  if (kind === 2) return Math.sqrt(x);
  return x;
}

/** Inverse of the inherent characteristic (for output characterization). */
export function valveCharacteristicInverse(kind: number, f: number) {
  const y = Math.min(1, Math.max(0, f));
  if (kind === 1) return Math.log(1 + y * (RANGEABILITY - 1)) / Math.log(RANGEABILITY);
  if (kind === 2) return y * y;
  return y;
}

export type InstrumentDefaults = {
  valveTau: number; valveRate: number; valveChar: number;
  txTau: number; txNoise: number; txDelay: number; Ts: number;
  /** Damping of the secondary (inner-loop) transmitter, for processes that have one. */
  tx2Tau?: number;
  /** Drives and motion: millisecond actuators, sensors and cycles. */
  fast?: boolean;
};

/** Valve, transmitter and controller-cycle parameters, with this process's defaults. */
export function instrumentParams(d: InstrumentDefaults): ParamSpec[] {
  const f = d.fast ? 0.01 : 1;
  return [
    { key: 'valveChar', label: 'Valve characteristic', unit: '', default: d.valveChar, min: 0, max: 2, group: 'valve', options: VALVE_CHARS,
      note: 'Inherent characteristic: flow vs stem position at constant pressure drop. Installed, the piping changes it.' },
    { key: 'valveTau', label: 'Actuator time constant', symbol: 'τ_v', unit: 's', default: d.valveTau, min: 0.05 * f, max: 60, step: 0.1 * f, group: 'valve',
      note: 'How quickly the stem follows its signal: positioner, actuator volume and air supply.' },
    { key: 'valveRate', label: 'Stroking speed limit', unit: '%/s', default: d.valveRate, min: 0.5, max: d.fast ? 20000 : 200, step: 0.5, group: 'valve',
      note: 'The fastest the stem can travel, for big moves.' },
    { key: 'valveDeadband', label: 'Deadband (backlash)', unit: '%', default: 0, min: 0, max: 5, step: 0.1, group: 'valve',
      note: 'Signal change needed before the stem moves the other way: packing friction, worn linkages. Causes limit cycles with integral action.' },
    { key: 'txTau', label: 'Transmitter damping', symbol: 'τ_m', unit: 's', default: d.txTau, min: 0.05 * f, max: 30, step: 0.05 * f, group: 'transmitter',
      note: 'The first-order filter set in the transmitter. More damping = less noise, more lag.' },
    { key: 'txNoise', label: 'Measurement noise', unit: '% span', default: d.txNoise, min: 0, max: 5, step: 0.05, group: 'transmitter',
      note: 'Standard deviation of the noise on the reading: turbulence, electrical noise, a sloshing surface.' },
    { key: 'txDelay', label: 'Transport delay', symbol: 'θ', unit: 's', default: d.txDelay, min: 0, max: 120, step: 0.1 * f, group: 'transmitter',
      note: 'Dead time between the process and the reading, e.g. a sample line or a sensor mounted downstream.' },
    ...(d.tx2Tau !== undefined ? [{ key: 'tx2Tau', label: 'Inner transmitter damping', symbol: 'τ_m2', unit: 's', default: d.tx2Tau, min: 0.05 * f, max: 30, step: 0.05 * f, group: 'transmitter' as const,
      note: 'Filter on the secondary measurement the inner cascade loop uses.' }] : []),
    { key: 'Ts', label: 'Controller cycle', symbol: 'T_s', unit: 's', default: d.Ts, min: 0.01 * f, max: 10, step: 0.01 * f, group: 'controller',
      note: 'How often the controller runs: the cyclic interrupt OB it is called from.' },
  ];
}

export function defaultParams(proc: ProcessDef): Params {
  return Object.fromEntries(proc.params.map((s) => [s.key, s.default]));
}

export function nominalDisturbances(proc: ProcessDef): Params {
  return Object.fromEntries(proc.disturbances.map((s) => [s.key, s.nominal]));
}

/** Clamp parameter values to their specs (anything unknown falls back on the default). */
export function cleanParams(proc: ProcessDef, raw: unknown): Params {
  const src = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  return Object.fromEntries(proc.params.map((s) => {
    const v = Number(src[s.key]);
    return [s.key, Number.isFinite(v) ? Math.min(s.max, Math.max(s.min, v)) : s.default];
  }));
}

export const pvSpan = (proc: ProcessDef) => proc.pv.hi - proc.pv.lo;
export const toPct = (proc: ProcessDef, v: number) => ((v - proc.pv.lo) / pvSpan(proc)) * 100;
export const fromPct = (proc: ProcessDef, pct: number) => proc.pv.lo + (pct / 100) * pvSpan(proc);

/** % of the secondary measurement's span (and back). */
export const toPct2 = (s: SecondarySpec, v: number) => ((v - s.lo) / (s.hi - s.lo)) * 100;
export const fromPct2 = (s: SecondarySpec, pct: number) => s.lo + (pct / 100) * (s.hi - s.lo);

/** Disturbances a feedforward can use. */
export const measuredDisturbances = (proc: ProcessDef) => proc.disturbances.filter((d) => d.measured);
