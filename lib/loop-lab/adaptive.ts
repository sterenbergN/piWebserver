import { approximate, linearizePlant, pathModel, type Fopdt } from './linear';
import type { Params, ProcessDef } from './model';

// A self-tuning regulator (indirect adaptive control): recursive least
// squares fits a first-order model to the measurement as the loop runs,
//   y(k) = a·y(k−1) + b·u(k−1−d) + c,
// with forgetting, so it follows a plant that changes; every cycle the PI is
// retuned from that model by SIMC. Signals in % (output) and % of span.

/** Recursive least squares with exponential forgetting. */
export class Rls {
  theta: number[];
  P: number[][];
  constructor(theta0: number[], p0: number, readonly lambda: number) {
    this.theta = theta0.slice();
    this.P = theta0.map((_, i) => theta0.map((__, j) => (i === j ? p0 : 0)));
  }

  /** One new observation y = φᵀθ + e. Returns the prediction error before the update. */
  update(phi: number[], y: number) {
    const n = phi.length;
    const Pphi = this.P.map((r) => r.reduce((s, v, j) => s + v * phi[j], 0));
    const denom = this.lambda + phi.reduce((s, v, i) => s + v * Pphi[i], 0);
    const err = y - phi.reduce((s, v, i) => s + v * this.theta[i], 0);
    const k = Pphi.map((v) => v / denom);
    this.theta = this.theta.map((t, i) => t + k[i] * err);
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) this.P[i][j] = (this.P[i][j] - k[i] * Pphi[j]) / this.lambda;
    // Keep P symmetric and bounded (forgetting without excitation makes it grow without limit: "windup").
    for (let i = 0; i < n; i++) for (let j = 0; j < i; j++) { const v = (this.P[i][j] + this.P[j][i]) / 2; this.P[i][j] = this.P[j][i] = v; }
    const tr = this.P.reduce((s, r, i) => s + r[i], 0);
    if (tr > 1e4) this.P = this.P.map((r) => r.map((v) => (v * 1e4) / tr));
    return err;
  }
}

/** SIMC PI from a fitted model; an integrating (or slightly unstable) fit is tuned as an integrator. */
export function simcPi(f: { K: number; tau: number; theta: number; integrating: boolean; kPrime: number }, tc: number) {
  const span = tc + f.theta;
  if (f.integrating || !(f.tau > 0) || !Number.isFinite(f.K)) {
    const kp = Math.abs(f.kPrime);
    return kp > 0 ? { Kc: 1 / (kp * span), Ti: 4 * span, negative: f.kPrime < 0 } : null;
  }
  return { Kc: f.tau / (Math.abs(f.K) * span), Ti: Math.min(f.tau, 4 * span), negative: f.K < 0 };
}

/** The first-order discrete model y(k) = a·y(k−1) + b·u(k−1−d) + c as gain, time constant and slope. */
export function fromArx(a: number, b: number, Ts: number, theta: number) {
  const integrating = a >= 0.9995;
  const tau = integrating ? Infinity : -Ts / Math.log(Math.max(a, 1e-6));
  const K = integrating ? Infinity : b / (1 - a);
  return { K, tau, theta, integrating, kPrime: b / Ts };
}

/** Where the estimator starts: the plant's first-order model at the design point, as a discrete one. */
export function initialArx(proc: ProcessDef, model: Params): { a: number; b: number; f: Fopdt } {
  const m = linearizePlant(proc, model, proc.nominalPv);
  const f = approximate(pathModel(m, m.C, m.theta), model.Ts / 2);
  const Ts = model.Ts;
  if (f.integrating || !Number.isFinite(f.K)) return { a: 1, b: f.kPrime * Ts, f };
  const a = Math.exp(-Ts / f.tau);
  return { a, b: f.K * (1 - a), f };
}
