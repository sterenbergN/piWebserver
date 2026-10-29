import type { ControllerConfig } from './controllers';
import { c2d, type Mat } from './linalg';

// Linear active disturbance rejection control (Han, Gao): treat the plant as
// a chain of n integrators driven by b₀·u plus a "total disturbance" f that
// lumps together everything else (the rest of the dynamics, model error,
// loads). An extended state observer estimates the output, its derivatives
// and f; the control law cancels f and puts a simple n-th order response on
// what is left. Tuning is two bandwidths and a rough b₀.
//   ESO:  ż = A z + B u + L (y − z₁),  observer poles all at −ω_o
//   law:  u = (k_p (r − z₁) − k_d z₂ − z_{n+1}) / b₀,  closed-loop poles at −ω_c
// Signals in % (output) and % of span (measurement).

export type AdrcConfig = Extract<ControllerConfig, { kind: 'adrc' }>;

const binom = (n: number, k: number) => { let r = 1; for (let i = 1; i <= k; i++) r = (r * (n - k + i)) / i; return r; };

export type AdrcDesign = {
  n: number;
  Ts: number;
  /** Observer: ż = Ao z + Bo [u, y] (continuous) and its ZOH discretization. */
  Ao: Mat;
  Bo: Mat;
  Phi: Mat;
  Gamma: Mat;
  /** u = C z + Dr r. */
  C: number[];
  Dr: number;
  L: number[];
};

export function designAdrc(config: AdrcConfig, Ts: number): AdrcDesign {
  const n = config.order, m = n + 1;
  const b0 = Math.abs(config.b0) > 1e-12 ? config.b0 : 1e-12;
  const L = Array.from({ length: m }, (_, i) => binom(m, i + 1) * config.wo ** (i + 1));
  const A: Mat = Array.from({ length: m }, (_, i) => Array.from({ length: m }, (__, j) => (j === i + 1 ? 1 : 0)));
  const Ao = A.map((r, i) => r.map((v, j) => v - (j === 0 ? L[i] : 0)));
  const Bo = Array.from({ length: m }, (_, i) => [i === n - 1 ? b0 : 0, L[i]]);
  const kp = n === 1 ? config.wc : config.wc * config.wc, kd = n === 1 ? 0 : 2 * config.wc;
  const C = [-kp / b0, ...(n === 2 ? [-kd / b0] : []), -1 / b0];
  const { Phi, Gamma } = c2d(Ao, Bo, Ts);
  return { n, Ts, Ao, Bo, Phi, Gamma, C, Dr: kp / b0, L };
}

/** The whole ADRC as one linear system from the measurement and setpoint to the output (for the analysis tools). */
export function adrcLinear(des: AdrcDesign) {
  const m = des.n + 1;
  const A = des.Ao.map((r, i) => r.map((v, j) => v + des.Bo[i][0] * des.C[j]));
  return { A, By: des.Bo.map((r) => [r[1]]), Br: Array.from({ length: m }, (_, i) => des.Bo[i][0] * des.Dr), C: des.C, Dr: des.Dr };
}
