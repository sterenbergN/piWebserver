import { linearPidAt, type ControllerConfig } from './controllers';
import { fitModel } from './ident';
import { approximate, closedLoop, linearizePlant, openLoopStep, pathModel, settleHorizon, stepResponse, timeConstants, type Fopdt, type PlantModel } from './linear';
import { cleanParams, type Params, type ProcessDef } from './model';

export type TuningLoop = 'main' | 'inner' | 'outer';

export type TuningModel = Fopdt & {
  /** Characterization slope folded into K (1 when there is none). */
  slope: number;
  reachable: boolean;
  valve: number;
  /** The process gain is negative: the controller needs "invert". (K is reported as its magnitude.) */
  negative: boolean;
};

/** A first-or-second-order-plus-dead-time model fitted to a simulated step response. */
function fitStep(t: number[], y: number[], extraDelay: number): Fopdt | null {
  const f = fitModel(t, t.map(() => 1), y, 'sopdt', { u0: 0, y0: 0 });
  if (!f || !Number.isFinite(f.K)) return null;
  const [t1, t2] = f.tau1 >= f.tau2 ? [f.tau1, f.tau2] : [f.tau2, f.tau1];
  const theta = f.theta + extraDelay;
  const tau = t1 + t2 / 2, thetaF = theta + t2 / 2;
  return { K: f.K, tau, theta: Math.max(thetaF, 1e-6), tau1: t1, tau2: t2, theta2: Math.max(theta, 1e-6), kPrime: f.K / tau, integrating: tau > 20 * thetaF };
}

/** The inner loop closed with its own PI: what the outer controller sees (inner setpoint → main reading). */
function innerClosed(m: PlantModel, config: Extract<ControllerConfig, { kind: 'cascade' }>, Ts: number) {
  const mi: PlantModel = { ...m, C: m.C2!, Ctrue: m.C, theta: 0, Dd: {} };
  return closedLoop(mi, { kind: 'single', pid: { ...config.inner, slope: 1 }, ff: [] }, Ts / 2);
}

/**
 * The model a tuning rule should use at an operating point: the plant as the
 * controller sees it (including any characterization), approximated as
 * first/second order plus dead time, with half a controller cycle of delay.
 * In cascade: the inner loop (valve → secondary), or the outer loop (inner
 * setpoint → main PV, with the inner loop closed at its present tuning).
 */
export function tuningModel(proc: ProcessDef, params: Params, config: ControllerConfig, pv: number, loop: TuningLoop = 'main'): TuningModel {
  const p = cleanParams(proc, params);
  const m = linearizePlant(proc, p, pv);
  let f: Fopdt;
  let slope = 1;
  if (config.kind === 'cascade' && m.C2 && loop !== 'main') {
    if (loop === 'inner') f = approximate(pathModel(m, m.C2, 0), p.Ts / 2);
    else {
      const cl = innerClosed(m, config, p.Ts);
      const horizon = settleHorizon(cl.poles, 60) * 1.5;
      const r = stepResponse(cl, 0, horizon, 600);
      f = fitStep(r.t, r.y, m.theta + p.Ts / 2) ?? approximate(m, p.Ts / 2);
    }
  } else {
    f = approximate(pathModel(m, m.C, m.theta), p.Ts / 2);
    const lp = config.kind === 'onoff' ? null : linearPidAt(proc, config, p, pv, m.valve);
    slope = lp?.slope ?? 1;
  }
  const K = f.K * slope;
  return { ...f, K: Math.abs(K), kPrime: Math.abs(f.kPrime * slope), slope, reachable: m.reachable, valve: m.valve, negative: K < 0 };
}

export type FeedforwardDesign = {
  gain: number; lead: number; lag: number;
  /** The two paths as fitted: valve (or inner setpoint) → PV, and disturbance → PV. */
  u: Fopdt; d: Fopdt;
  /** What the design can't do, in a sentence (null when it can do it all). */
  note: string | null;
};

/**
 * Feedforward from a measured disturbance: fit simple models to the two paths
 * into the PV and invert. Ideal FF = −G_d/G_u ≈ −(K_d/K_u)·(τ_u s + 1)/(τ_d s + 1)·e^{−(θ_d − θ_u)s}.
 */
export function feedforwardDesign(proc: ProcessDef, params: Params, config: ControllerConfig, pv: number, key: string): FeedforwardDesign | null {
  const p = cleanParams(proc, params);
  const m = linearizePlant(proc, p, pv);
  if (!m.Bd[key]) return null;
  const slowest = Math.max(...timeConstants(m), 1);
  const horizon = 8 * slowest + 4 * m.theta;
  let uPath: Fopdt | null;
  if (config.kind === 'cascade' && m.C2) {
    const cl = innerClosed(m, config, p.Ts);
    const r = stepResponse(cl, 0, Math.max(horizon, settleHorizon(cl.poles, 60) * 1.5), 600);
    uPath = fitStep(r.t, r.y, m.theta);
  } else {
    const r = openLoopStep(m.A, m.B, m.C, 0, horizon);
    uPath = fitStep(r.t, r.y, m.theta);
  }
  const rd = openLoopStep(m.A, m.Bd[key], m.C, 0, horizon);
  const dPath = fitStep(rd.t, rd.y, m.theta);
  if (!uPath || !dPath || !uPath.K) return null;
  const gain = -dPath.K / uPath.K;
  const lead = uPath.tau, lag = dPath.tau;
  const dt = dPath.theta - uPath.theta;
  const note = dt < -0.5
    ? `The disturbance reaches the PV ${dt < 0 ? Math.abs(dt).toPrecision(2) : ''} s sooner than the valve can: feedforward can only partly cancel it.`
    : dt > 0.5 ? `Ideally the feedforward would wait ${dt.toPrecision(2)} s (the disturbance is slower than the valve); the lead-lag alone is a little early.` : null;
  return { gain, lead, lag, u: uPath, d: dPath, note };
}


// Classic tuning rules, each from a first-order-plus-dead-time model
// K·e^{-θs}/(τs+1) (or its second-order version). Results are for the ideal
// (non-interacting) PID form used throughout Loop Lab.

export type TuningRuleId = 'simc' | 'lambda' | 'zn' | 'cc' | 'amigo';
export type ControlType = 'P' | 'PI' | 'PID';
export type Tuning = { Kc: number; Ti: number; Td: number };

export type TuningRule = {
  id: TuningRuleId;
  name: string;
  /** Uses the closed-loop speed slider (τc or λ). */
  usesSpeed: boolean;
  types: ControlType[];
  /** The formulas, in LaTeX, for the PI version. */
  formula: string;
  assumptions: string;
  tune(m: Fopdt, type: ControlType, speed: number): Tuning | null;
};

const ok = (t: Tuning) => (Number.isFinite(t.Kc) && t.Kc > 0 && Number.isFinite(t.Ti) && Number.isFinite(t.Td) ? t : null);

/** Series (interacting) PID → ideal form. */
function seriesToIdeal(Kc: number, Ti: number, Td: number): Tuning {
  if (Td <= 0) return { Kc, Ti, Td: 0 };
  const f = 1 + Td / Ti;
  return { Kc: Kc * f, Ti: Ti * f, Td: Td / f };
}

export const TUNING_RULES: TuningRule[] = [
  {
    id: 'simc', name: 'SIMC (Skogestad)', usesSpeed: true, types: ['PI', 'PID'],
    formula: String.raw`K_c = \frac{\tau}{K(\tau_c + \theta)},\quad T_i = \min\big(\tau,\ 4(\tau_c + \theta)\big)`,
    assumptions: 'Model-based, one tuning knob: the closed-loop time constant τc. τc = θ gives a fast, still robust loop (Ms ≈ 1.6); larger τc is smoother. The min() on Ti keeps lag-dominant and integrating processes from responding too slowly to load upsets. PID uses the second-order model: Td = τ2 in series form.',
    tune(m, type, tc) {
      const tauC = Math.max(tc, 1e-6);
      if (type === 'PID') {
        const Kc = m.tau1 / (m.K * (tauC + m.theta2));
        const Ti = Math.min(m.tau1, 4 * (tauC + m.theta2));
        return ok(seriesToIdeal(Kc, Ti, m.tau2));
      }
      return ok({ Kc: m.tau / (m.K * (tauC + m.theta)), Ti: Math.min(m.tau, 4 * (tauC + m.theta)), Td: 0 });
    },
  },
  {
    id: 'lambda', name: 'Lambda (IMC)', usesSpeed: true, types: ['PI'],
    formula: String.raw`K_c = \frac{\tau}{K(\lambda + \theta)},\quad T_i = \tau`,
    assumptions: 'The process-industry favourite: choose λ, the closed-loop time constant, and the setpoint response is first-order with no overshoot. Ti = τ cancels the process pole, which makes load rejection slow on lag-dominant processes. λ = 1–3 × τ is typical for robustness.',
    tune(m, _type, lambda) {
      return ok({ Kc: m.tau / (m.K * (Math.max(lambda, 1e-6) + m.theta)), Ti: m.tau, Td: 0 });
    },
  },
  {
    id: 'zn', name: 'Ziegler–Nichols (reaction curve)', usesSpeed: false, types: ['P', 'PI', 'PID'],
    formula: String.raw`K_c = \frac{0.9\,\tau}{K\theta},\quad T_i = 3.33\,\theta`,
    assumptions: 'The 1942 rules, aiming for a quarter-amplitude decay. Aggressive: Ms is often above 2, so the loop rings and is sensitive to model error. Worth knowing because so many loops in the field were tuned this way.',
    tune(m, type) {
      const r = m.tau / (m.K * m.theta);
      if (type === 'P') return ok({ Kc: r, Ti: 0, Td: 0 });
      if (type === 'PI') return ok({ Kc: 0.9 * r, Ti: 3.33 * m.theta, Td: 0 });
      return ok({ Kc: 1.2 * r, Ti: 2 * m.theta, Td: 0.5 * m.theta });
    },
  },
  {
    id: 'cc', name: 'Cohen–Coon', usesSpeed: false, types: ['P', 'PI', 'PID'],
    formula: String.raw`K_c = \frac{\tau}{K\theta}\Big(0.9 + \frac{\theta}{12\tau}\Big),\quad T_i = \theta\,\frac{30 + 3\theta/\tau}{9 + 20\theta/\tau}`,
    assumptions: 'Like Ziegler–Nichols but corrected for dead time, so it copes better when θ/τ is large. Also aimed at quarter-amplitude decay, so also aggressive.',
    tune(m, type) {
      const r = m.theta / m.tau, k = m.tau / (m.K * m.theta);
      if (type === 'P') return ok({ Kc: k * (1 + r / 3), Ti: 0, Td: 0 });
      if (type === 'PI') return ok({ Kc: k * (0.9 + r / 12), Ti: (m.theta * (30 + 3 * r)) / (9 + 20 * r), Td: 0 });
      return ok({ Kc: k * (4 / 3 + r / 4), Ti: (m.theta * (32 + 6 * r)) / (13 + 8 * r), Td: (4 * m.theta) / (11 + 2 * r) });
    },
  },
  {
    id: 'amigo', name: 'AMIGO (Åström–Hägglund)', usesSpeed: false, types: ['PI', 'PID'],
    formula: String.raw`K_c = \frac{0.15}{K} + \Big(0.35 - \frac{\theta\tau}{(\theta+\tau)^2}\Big)\frac{\tau}{K\theta},\quad T_i = 0.35\theta + \frac{13\theta\tau^2}{\tau^2 + 12\theta\tau + 7\theta^2}`,
    assumptions: 'Derived by optimizing load rejection with a robustness limit (Ms ≈ 1.4) over a large test batch of processes. A safe modern default when you have no reason to choose a speed.',
    tune(m, type) {
      const { K, tau, theta } = m;
      if (type === 'PID') {
        return ok({ Kc: (0.2 + (0.45 * tau) / theta) / K, Ti: ((0.4 * theta + 0.8 * tau) / (theta + 0.1 * tau)) * theta, Td: (0.5 * theta * tau) / (0.3 * theta + tau) });
      }
      return ok({
        Kc: 0.15 / K + (0.35 - (theta * tau) / (theta + tau) ** 2) * (tau / (K * theta)),
        Ti: 0.35 * theta + (13 * theta * tau * tau) / (tau * tau + 12 * theta * tau + 7 * theta * theta),
        Td: 0,
      });
    },
  },
];

export const getRule = (id: TuningRuleId) => TUNING_RULES.find((r) => r.id === id) ?? TUNING_RULES[0];
