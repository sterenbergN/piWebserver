import { linearPidAt, type ControllerConfig, type PidParams } from './controllers';
import { fitModel } from './ident';
import { analyzeLoop, approximate, closedLoop, isStable, linearizePlant, robustness, openLoopStep, pathModel, settleHorizon, ssResponse, stepResponse, timeConstants, type Fopdt, type PlantModel } from './linear';
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
function innerClosed(m: PlantModel, config: { inner: PidParams }, Ts: number) {
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
  if ((config.kind === 'cascade' || config.kind === 'ratio' || (config.kind === 'override' && config.on === 'pv2')) && m.C2 && loop !== 'main') {
    if (loop === 'inner' || config.kind === 'override') f = approximate(pathModel(m, m.C2, 0), p.Ts / 2);
    else {
      const cl = innerClosed(m, config, p.Ts);
      const horizon = settleHorizon(cl.poles, 60) * 1.5;
      const r = stepResponse(cl, 0, horizon, 600);
      f = fitStep(r.t, r.y, m.theta + p.Ts / 2) ?? approximate(m, p.Ts / 2);
      // Ratio: the trim moves R, and R × the wild flow moves the inner setpoint.
      if (config.kind === 'ratio') slope = linearPidAt(proc, { ...config, trim: true }, p, pv, m.valve)?.slope ?? 1;
    }
  } else {
    f = approximate(pathModel(m, m.C, m.theta), p.Ts / 2);
    const lp = config.kind === 'onoff' ? null : linearPidAt(proc, config, p, pv, m.valve);
    slope = lp?.slope ?? 1;
    if (config.kind === 'smith') {
      // The predictor takes its model's dead time out of what the PID sees; whatever is left (or wrong) stays.
      const rest = (v: number) => Math.max(Math.abs(v - config.model.theta), p.Ts / 2);
      f = { ...f, theta: rest(f.theta), theta2: rest(f.theta2) };
    }
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
  const plain = approximate(m, p.Ts / 2);
  if (plain.integrating) return integratingFeedforward(m, p, config, key, plain);
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


/** Final ramp rate of a path, G(jω) ≈ k′/(jω) at low frequency (signed). */
const rampRate = (A: number[][], col: number[], row: number[]) => {
  const w = 1e-7;
  return -w * ssResponse(A, col, row, w).im;
};

/**
 * On an integrating process (a level) there is no steady-state gain to divide:
 * the feedforward has to stop the ramp, so its gain is the ratio of the two
 * ramp rates. For a drum or a tank that is just the mass balance: one unit
 * more out, one unit more in.
 */
function integratingFeedforward(m: PlantModel, p: Params, config: ControllerConfig, key: string, plain: Fopdt): FeedforwardDesign | null {
  let ku: number;
  if (config.kind === 'cascade' && m.C2) {
    const cl = innerClosed(m, config, p.Ts);
    ku = rampRate(cl.A, cl.B.map((r) => r[0]), cl.C[0]);
  } else ku = rampRate(m.A, m.B, m.C);
  const kd = rampRate(m.A, m.Bd[key], m.C);
  if (!ku || !Number.isFinite(ku) || !Number.isFinite(kd)) return null;
  const fit = (k: number): Fopdt => ({ ...plain, K: k * plain.tau, kPrime: k });
  return {
    gain: -kd / ku, lead: 0, lag: 0, u: fit(ku), d: fit(kd),
    note: 'The process integrates, so the feedforward balances the ramp rates (for a level: flow in matches flow out). Inverse response such as swell is left to the feedback.',
  };
}

// Classic tuning rules, each from a first-order-plus-dead-time model
// K·e^{-θs}/(τs+1) (or its second-order version). Results are for the ideal
// (non-interacting) PID form used throughout Loop Lab.

export type TuningRuleId = 'simc' | 'lambda' | 'averaging' | 'zn' | 'cc' | 'amigo';
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
    id: 'averaging', name: 'Lambda for integrating (averaging level)', usesSpeed: true, types: ['P', 'PI'],
    formula: String.raw`K_c = \frac{2\lambda + \theta}{k'(\lambda + \theta)^2},\quad T_i = 2\lambda + \theta`,
    assumptions: "For integrating processes such as levels, from the ramp rate k′ (% of span per second, per % of output). λ is the arrest time: how long the level keeps moving after an inflow upset. For a step upset Δ (in % of output) the level swings about k′·Δ·λ/e before it turns round, so choose λ from the room the tank has. A long λ lets the tank absorb the upset and keeps the outflow smooth: averaging level control. P-only: Kc = 1/(k′λ), which leaves an offset that is harmless in a buffer.",
    tune(m, type, lambda) {
      const k = Math.abs(m.kPrime), lam = Math.max(lambda, 1e-6), th = m.theta;
      if (!(k > 0)) return null;
      if (type === 'P') return ok({ Kc: 1 / (k * (lam + th)), Ti: 0, Td: 0 });
      return ok({ Kc: (2 * lam + th) / (k * (lam + th) ** 2), Ti: 2 * lam + th, Td: 0 });
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

// ─── One-click tuning ───────────────────────────────────────────────────────

const round3 = (v: number) => Number(v.toPrecision(3));
const tidy = (t: Tuning) => ({ Kc: round3(t.Kc), Ti: round3(t.Ti), Td: round3(t.Td) });

/** Measurement noise passed straight to the output by the proportional gain, at most (% σ). */
const NOISE_TO_OUTPUT = 2;

/**
 * The closed-loop time constant auto-tuning aims for: 3θ (robust: Ms about
 * 1.4–1.5 on every process here), slowed down if needed so the gain
 * Kc ≈ τ/(K(τc + θ)) doesn't pass more than NOISE_TO_OUTPUT % of measurement
 * noise to the valve.
 */
function autoSpeed(m: TuningModel, noisePct: number) {
  const byNoise = noisePct > 0 && m.K > 0 ? (m.tau / m.K) * (noisePct / NOISE_TO_OUTPUT) - m.theta : 0;
  return Math.max(3 * m.theta, byNoise);
}

/**
 * Closed-loop speed for the PID inside a Smith predictor. It could aim for the
 * process lag alone, but then a dead-time error of a few percent makes it ring:
 * the delay mismatch acts like extra dead time the PID doesn't know about. So
 * it aims for the larger of the lag and half the dead time, and no
 * faster than the noise allows.
 */
function smithSpeed(plain: TuningModel, m: TuningModel, noisePct: number) {
  return Math.max(SMITH_SPEED.lag * plain.tau, SMITH_SPEED.theta * plain.theta, autoSpeed(m, noisePct));
}
export const SMITH_SPEED = { lag: 1, theta: 0.5 };

/**
 * A sensible starting tuning in one step: SIMC at the nominal operating
 * point with a noise-aware closed-loop speed, P/PI/PID kept as it is; the
 * slave then the master in cascade; schedules at each breakpoint with the
 * same closed-loop speed; feedforward terms designed from the model.
 */
function autoTuneRules(proc: ProcessDef, params: Params, config: ControllerConfig, slow = 1): { config: ControllerConfig; note: string } | null {
  if (config.kind === 'onoff') return null;
  const rule = getRule('simc');
  const pv = proc.nominalPv;
  const noise = cleanParams(proc, params).txNoise;
  const at = (cfg: ControllerConfig, loop: TuningLoop, type: ControlType, x = pv, speed?: number) => {
    const m = tuningModel(proc, params, cfg, x, loop);
    const tc = speed ?? autoSpeed(m, noise) * slow;
    const t = rule.tune(m, type, tc);
    return t ? { t: tidy(t), m, tc, slowed: tc > 3 * m.theta * 1.01 } : null;
  };
  const slowNote = (slowed: boolean) => (slowed ? ' Slowed down to keep the measurement noise off the valve.' : '');
  const typeOf = (p: { Ti: number; Td: number }): ControlType => (p.Td > 0 ? 'PID' : 'PI');
  const withFf = (cfg: ControllerConfig) => {
    if ((cfg.kind !== 'feedforward' && cfg.kind !== 'cascade') || !cfg.ff.length) return cfg;
    const ff = cfg.ff.map((term) => {
      const r = feedforwardDesign(proc, params, cfg, pv, term.from);
      if (!r) return term;
      // Nearly equal lead and lag cancel: keep it a plain gain.
      const cancel = r.lead > 0 && r.lag > 0 && Math.abs(r.lead - r.lag) <= 0.15 * Math.max(r.lead, r.lag);
      return { ...term, gain: round3(r.gain), lead: cancel ? 0 : round3(r.lead), lag: cancel ? 0 : round3(r.lag) };
    });
    return { ...cfg, ff };
  };
  const where = `${round3(pv)} ${proc.pv.unit}`;

  if (config.kind === 'override') {
    // The normal controller as if it were alone; the override tight (SIMC) at its limit, acting the same way.
    const normal = autoTune(proc, params, { kind: 'pid', pid: config.pid });
    const o = config.on === 'pv2' ? at(config, 'inner', typeOf(config.ovr)) : at(config, 'main', typeOf(config.ovr), config.limit);
    if (!normal || normal.config.kind !== 'pid' || !o) return null;
    const ovr = { ...config.ovr, ...o.t, invert: o.m.negative };
    return {
      config: { ...config, pid: normal.config.pid, ovr },
      note: `Normal controller: ${normal.note} Override at its limit (${round3(config.limit)} ${config.on === 'pv2' ? proc.secondary?.unit : proc.pv.unit}): SIMC Kc ${o.t.Kc}, Ti ${o.t.Ti} s, much tighter, because once it is in charge its job is to hold the limit.`,
    };
  }
  if (config.kind === 'ratio') {
    const inner = at(config, 'inner', typeOf(config.inner));
    if (!inner) return null;
    const step1 = { ...config, inner: { ...config.inner, ...inner.t } };
    const outer = at(step1, 'outer', typeOf(config.outer));
    if (!outer) return null;
    return {
      config: { ...step1, outer: { ...config.outer, ...outer.t } },
      note: `SIMC at ${where}: the flow loop first (Kc ${inner.t.Kc}, Ti ${inner.t.Ti} s), then the trim on the ratio with the flow loop closed (Kc ${outer.t.Kc}, Ti ${outer.t.Ti} s). In ratio units its gain doesn't change with the throughput.${slowNote(inner.slowed || outer.slowed)}`,
    };
  }
  if (config.kind === 'cascade') {
    const inner = at(config, 'inner', typeOf(config.inner));
    if (!inner) return null;
    const step1 = { ...config, inner: { ...config.inner, ...inner.t } };
    const outer = at(step1, 'outer', typeOf(config.outer));
    if (!outer) return null;
    const done = withFf({ ...step1, outer: { ...config.outer, ...outer.t } });
    return { config: done, note: `SIMC at ${where}: slave first (Kc ${inner.t.Kc}, Ti ${inner.t.Ti} s), then the master with the slave closed (Kc ${outer.t.Kc}, Ti ${outer.t.Ti} s).${slowNote(inner.slowed || outer.slowed)}` };
  }
  if (config.kind === 'smith') {
    // The model first (from the plant's step response), then the PID for what the predictor leaves.
    const plain = tuningModel(proc, params, { kind: 'pid', pid: config.pid }, pv);
    const model = { K: round3((plain.negative ? -1 : 1) * plain.K), tau: round3(plain.tau), theta: round3(plain.theta) };
    const withModel = { ...config, model };
    const type = typeOf(config.pid);
    const m = tuningModel(proc, params, withModel, pv);
    const tc = smithSpeed(plain, m, noise);
    const t = rule.tune(m, type, tc);
    if (!t) return null;
    const pid = { ...config.pid, ...tidy(t), invert: plain.negative };
    return {
      config: { ...withModel, pid },
      note: `Model from the plant at ${where}: K ${model.K}, τ ${model.tau} s, θ ${model.theta} s. The PI is then tuned (SIMC) as if the dead time weren't there, aiming for a closed-loop time constant of ${round3(tc)} s: slower than the predictor would allow, so a dead time that is off by 20 % doesn't make it oscillate.`,
    };
  }
  if (config.kind === 'schedule') {
    // One closed-loop speed, chosen at the nominal point, for every breakpoint: the point of scheduling.
    const ref = at(config, 'main', 'PI');
    if (!ref) return null;
    const points = config.points.map((p) => {
      const r = at(config, 'main', typeOf(p), p.at, ref.tc);
      return r ? { ...p, ...r.t } : p;
    });
    return { config: { ...config, points }, note: `SIMC at each breakpoint (${points.map((p) => `${round3(p.at)} ${proc.pv.unit}`).join(', ')}) with the same closed-loop time constant, ${round3(ref.tc)} s.${slowNote(ref.slowed)}` };
  }
  if (proc.averaging && (config.kind === 'pid' || config.kind === 'feedforward')) {
    // Averaging level: arrest time chosen so a design upset uses the room the tank has (swing ≈ k′·Δ·λ/e).
    const m = tuningModel(proc, params, config, pv);
    const { swing, upset } = proc.averaging;
    const lambda = (Math.E * swing) / (Math.abs(m.kPrime) * upset);
    const type: ControlType = config.pid.Ti > 0 ? 'PI' : 'P';
    const t = getRule('averaging').tune(m, type, lambda);
    if (!t) return null;
    const pid = { ...config.pid, ...tidy(t), invert: m.negative };
    return {
      config: withFf({ ...config, pid }),
      note: `Averaging level (Lambda for integrating): the level may swing about ${swing} % of span when the inflow changes by ${upset} % of the outlet's capacity, so the arrest time is λ = e·${swing}/(k′·${upset}) = ${round3(lambda / 60)} min with k′ ${round3(Math.abs(m.kPrime))} %/s per %. Tight level control would pass every upstream swing straight to the outflow.${m.negative ? ' More outflow lowers the level, so the action is inverted.' : ''}`,
    };
  }
  if (config.kind === 'statefb') return null;
  const type = typeOf(config.pid);
  const r = at(config, 'main', type);
  if (!r) return null;
  const pid = { ...config.pid, ...r.t, invert: r.m.negative, a: type === 'PID' ? Math.max(config.pid.a, 0.3) : config.pid.a };
  const done = withFf({ ...config, pid });
  return {
    config: done,
    note: `SIMC ${type} at ${where} from K ${round3(r.m.K)}, τ ${round3(r.m.tau)} s, θ ${round3(r.m.theta)} s, aiming for a closed-loop time constant of ${round3(r.tc)} s.${slowNote(r.slowed)}${type === 'PID' ? ' Derivative filter ratio at least 0.3.' : ''}${r.m.negative ? ' The process gain is negative, so the action is inverted.' : ''}`,
  };
}

/** Every gain in a PID-based controller, times k (schedules, cascades, overrides included). */
function scaleGains(config: ControllerConfig, k: number): ControllerConfig {
  const s = <T extends { Kc: number }>(p: T): T => ({ ...p, Kc: round3(p.Kc * k) });
  if (config.kind === 'cascade' || config.kind === 'ratio') return { ...config, outer: s(config.outer) };
  if (config.kind === 'schedule') return { ...config, pid: s(config.pid), points: config.points.map(s) };
  if (config.kind === 'override') return { ...config, pid: s(config.pid) };
  if (config.kind === 'onoff' || config.kind === 'statefb') return config;
  return { ...config, pid: s(config.pid) };
}

/** Stable at the nominal point, and its peak sensitivity there. */
function nominalCheck(proc: ProcessDef, params: Params, config: ControllerConfig) {
  const a = analyzeLoop(proc, params, config, proc.nominalPv);
  if (!a) return { stable: true, ms: 0 };
  return { stable: isStable(closedLoop(a.plant, a.ctrl, a.delay).poles), ms: Math.max(a.margins.ms, a.inner?.margins.ms ?? 0) };
}

/**
 * The tuning rules all fit a first-order (or integrating) model with dead time. A plant that is
 * open-loop unstable has no such model, so no rule applies; one with a lightly damped resonance
 * (a swinging load, a flexible shaft) fits one, but the resonance the model leaves out can still
 * make the rule's tuning unstable. Then the gain is cut until the loop is stable with some margin.
 */
export function autoTune(proc: ProcessDef, params: Params, config: ControllerConfig): { config: ControllerConfig; note: string } | null {
  if (config.kind === 'statefb') return tuneStateFb(proc, params, config);
  const m = linearizePlant(proc, cleanParams(proc, params), proc.nominalPv);
  const scale = Math.max(1, ...m.poles.map((p) => Math.hypot(p.re, p.im)));
  if (config.kind !== 'onoff' && m.poles.some((p) => p.re > 1e-9 * scale)) {
    const fast = Math.max(...m.poles.filter((p) => p.re > 0).map((p) => p.re));
    return {
      config,
      note: `No tuning rule applies: the plant is unstable on its own (a pole at +${round3(fast)} rad/s), and SIMC, Lambda and the rest all assume a stable or integrating process. Tune by hand from the Control tab (the loop must cross over well above ${round3(fast)} rad/s, so derivative action is needed), or design by pole placement with state feedback.`,
    };
  }
  const r = autoTuneRules(proc, params, config);
  if (!r) return r;
  let c = r.config, k = 1, check = nominalCheck(proc, params, c), last = r;
  if (check.stable && check.ms <= 1.7) return r;
  // Cut until it is stable with margin over the plant's spread too (the resonance moves with the uncertain parameters).
  const spread = (cfg: ControllerConfig) => {
    const pts = robustness(proc, params, cfg, 6);
    return { stable: pts.every((p) => p.stableAll), ms: Math.max(...pts.map((p) => p.worst?.ms ?? 0)) };
  };
  // Slow the rule down (a longer closed-loop time constant, so the integral slows with the gain) until it is.
  for (let i = 0; i < 24 && !(check.stable && check.ms <= 1.6); i++) {
    k *= 1.5;
    const next = autoTuneRules(proc, params, config, k);
    if (!next) break;
    last = next;
    c = next.config;
    check = nominalCheck(proc, params, c);
    if (check.stable && check.ms <= 1.6) check = spread(c);
  }
  return {
    config: c,
    note: `${last.note} The rule's model leaves out a lightly damped mode (a resonance) that this plant has: at the rule's own speed the loop is ${nominalCheck(proc, params, r.config).stable ? 'too close to the edge' : 'unstable'}, so it is slowed down ${round3(k)}× (Ms ${round3(check.ms)}). PID can't do better here without seeing that mode: see the state-feedback rung.`,
  };
}

/**
 * State feedback: the fastest design whose loop, broken at the valve, keeps
 * Ms ≤ 1.6 at the design point: the dominant poles' ω_n for pole placement,
 * the output weight for LQR (with the integral weight following it).
 */
function tuneStateFb(proc: ProcessDef, params: Params, config: Extract<ControllerConfig, { kind: 'statefb' }>) {
  const model = cleanParams(proc, params);
  const m = linearizePlant(proc, model, proc.nominalPv);
  const rates = m.poles.map((p) => Math.hypot(p.re, p.im)).filter((v) => v > 1e-9);
  const lo = Math.min(...rates, 1 / Math.max(model.Ts, 1e-3)) * 0.05, hi = Math.min(Math.max(...rates, 1) * 2, 0.5 / model.Ts);
  let best: { c: ControllerConfig; v: number; ms: number } | null = null;
  for (let i = 0; i <= 30; i++) {
    const x = lo * (hi / lo) ** (i / 30);
    const c: ControllerConfig = config.design === 'poles'
      ? { ...config, wn: round3(x) }
      : { ...config, qy: round3((x / Math.max(lo, 1e-9)) ** 2), qi: config.integral === 'error' ? round3(((x / Math.max(lo, 1e-9)) ** 2) * (x / 5) ** 2) : config.qi };
    const chk = nominalCheck(proc, model, c);
    if (chk.stable && chk.ms > 0 && chk.ms <= 1.6) best = { c, v: x, ms: chk.ms };
  }
  if (!best) return { config, note: 'No design in the range tried keeps Ms ≤ 1.6 at the design point: try another observer, measurement or offset-free option.' };
  const what = config.design === 'poles' ? `dominant poles at ω_n ${round3(best.v)} rad/s` : `output weight q_y ${(best.c as { qy: number }).qy}`;
  return { config: best.c, note: `The fastest design that keeps the loop's peak sensitivity at or below 1.6 at ${round3(proc.nominalPv)} ${proc.pv.unit}: ${what} (Ms ${round3(best.ms)}). Check it on the mismatch test: the controller's model is only right at its design point.` };
}
