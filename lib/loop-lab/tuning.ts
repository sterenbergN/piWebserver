import { linearPidAt, type ControllerConfig } from './controllers';
import { approximate, linearizePlant, type Fopdt } from './linear';
import { cleanParams, type Params, type ProcessDef } from './model';

/**
 * The model a tuning rule should use at an operating point: the plant as the
 * controller sees it (including any characterization), approximated as
 * first/second order plus dead time, with half a controller cycle of delay.
 */
export function tuningModel(proc: ProcessDef, params: Params, config: ControllerConfig, pv: number) {
  const p = cleanParams(proc, params);
  const m = linearizePlant(proc, p, pv);
  const f = approximate(m, p.Ts / 2);
  const lp = config.kind === 'onoff' ? null : linearPidAt(proc, config, p, pv, m.valve);
  const slope = lp?.slope ?? 1;
  return { ...f, K: f.K * slope, kPrime: f.kPrime * slope, slope, reachable: m.reachable, valve: m.valve };
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
