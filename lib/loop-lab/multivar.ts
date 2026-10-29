import type { ControllerConfig } from './controllers';
import { linearizePlant, type PlantModel } from './linear';
import { c2d, cabs, eig, inverse, matMul, solve, transpose, zeros, type Mat } from './linalg';
import { toPct, toPct2, type Params, type ProcessDef } from './model';
import { care } from './statespace';
import { findSteady } from './sim';

// Two inputs, two outputs: the steady-state gain matrix and the relative gain
// array (which valve should control what), the static decoupler, and a linear
// model predictive controller with input limits. Signals in %: the two valves,
// and the two measurements in % of their spans.

/** The plant at a design point, with the second valve as a second input. */
export function mimoModel(proc: ProcessDef, p: Params, pv: number = proc.nominalPv) {
  const m = linearizePlant(proc, p, pv);
  const B2 = m.Bd[proc.mimo!.input];
  return { m, B2 };
}

/**
 * Steady-state gains, % of span per % of valve: G[i][j] from valve j (0: main,
 * 1: second) to output i (0: PV, 1: second variable).
 */
export function steadyGains(m: PlantModel, B2: number[]): number[][] {
  const g = (b: number[], row: number[]) => {
    const x = solve(m.A, b);
    return x ? -row.reduce((acc, c, i) => acc + c * x[i], 0) : NaN;
  };
  return [[g(m.B, m.C), g(B2, m.C)], [g(m.B, m.C2!), g(B2, m.C2!)]];
}

/** Relative gain λ₁₁ = 1/(1 − g₁₂g₂₁/(g₁₁g₂₂)): near 1, pair main valve → PV; below 0.5, cross the pairing. */
export const rga11 = (G: number[][]) => 1 / (1 - (G[0][1] * G[1][0]) / (G[0][0] * G[1][1]));

/**
 * Static decoupler for a pairing: loop 1 (the PV) drives valve a, loop 2 valve b.
 * u_a = w₁ + c_a·w₂, u_b = w₂ + c_b·w₁ cancels each loop's steady effect on the other.
 */
export function decoupler(G: number[][], pairing: 'direct' | 'crossed') {
  const a = pairing === 'direct' ? 0 : 1, b = 1 - a;
  return { a, b, ca: -G[0][b] / G[0][a], cb: -G[1][a] / G[1][b] };
}

export type MpcConfig = Extract<ControllerConfig, { kind: 'mpc' }>;

export type MpcDesign = {
  ok: boolean;
  error?: string;
  /** Design point: valves %, outputs % of span. */
  u0: [number, number];
  y0: [number, number];
  n: number;
  /** Observer, discretized: xo ← Φo·xo + Γo·[u₁, u₂, y₁, y₂] (deviations), xo = [x̂, d̂₁, d̂₂] with d̂ a load at each valve. */
  Phio: Mat;
  Gamo: Mat;
  /** QP: minimize zᵀHz + 2fᵀz, f = Fx·x̂ + Fd·d̂ + Fr·r + Fu·u_prev, lo ≤ z ≤ hi; z = both valves over the next M cycles. */
  H: Mat;
  Fx: Mat;
  Fd: Mat;
  Fr: Mat;
  Fu: Mat;
  lo: number[];
  hi: number[];
  /** Steady state for a valve change (for bumpless starts): x = Xu·(Δu + d). */
  Xu: Mat;
  Cy: Mat;
  /** Steady-state gains and λ₁₁ at the design point. */
  G: number[][];
  lambda: number;
};

const cache = new Map<string, MpcDesign>();

export function designMpc(proc: ProcessDef, config: MpcConfig, model: Params): MpcDesign {
  const key = `${proc.id}|${JSON.stringify(config)}|${JSON.stringify(model)}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const d = computeMpc(proc, config, model);
  if (cache.size > 100) cache.clear();
  cache.set(key, d);
  return d;
}

function computeMpc(proc: ProcessDef, config: MpcConfig, model: Params): MpcDesign {
  const { m, B2 } = mimoModel(proc, model);
  const sec = proc.secondary!;
  const s = findSteady(proc, model, Object.fromEntries(proc.disturbances.map((x) => [x.key, x.nominal])), proc.nominalPv);
  const u0: [number, number] = [s.valve, 'u2' in s && s.u2 !== undefined ? s.u2 : 50];
  const y0: [number, number] = [toPct(proc, s.pv), toPct2(sec, s.pv2)];
  const n = m.A.length, Ts = model.Ts;
  const Bu = m.B.map((b, i) => [b, B2[i]]);
  const Cy = [m.C, m.C2!];
  const G = steadyGains(m, B2);
  const fail = (error: string): MpcDesign => ({ ok: false, error, u0, y0, n, Phio: [], Gamo: [], H: [], Fx: [], Fd: [], Fr: [], Fu: [], lo: [], hi: [], Xu: [], Cy, G, lambda: rga11(G) });
  const P = Math.round(config.P), M = Math.min(Math.round(config.M), P);

  // Observer: the plant plus a constant load at each valve (offset-free: two disturbances for two outputs). Loads
  // act through the plant's own dynamics, so they are caught faster than with the older offset-on-each-output model.
  const no = n + 2;
  const Ao = zeros(no), Bo = zeros(no, 2), Co = zeros(2, no);
  for (let i = 0; i < n; i++) { for (let j = 0; j < n; j++) Ao[i][j] = m.A[i][j]; Bo[i][0] = Ao[i][n] = m.B[i]; Bo[i][1] = Ao[i][n + 1] = B2[i]; }
  for (let k = 0; k < 2; k++) for (let j = 0; j < n; j++) Co[k][j] = Cy[k][j];
  // Process noise scaled to the horizon's speed (as for state feedback): white upsets where each valve acts, and the
  // loads drifting qw % per √s.
  const w = 8 / (P * Ts);
  const dirs = [0, 1].map((k) => {
    const j = Bo.findIndex((r) => r[k] !== 0);
    return Ao.map((r, i) => (i === j || j < 0 ? 0 : r[j]));
  });
  const Qw = zeros(no).map((r, i) => r.map((_, j) => (config.qw * config.qw * dirs.reduce((acc, g) => acc + g[i] * g[j], 0)) / (w * w) + (i === j ? 1e-9 : 0)));
  Qw[n][n] += config.qw * config.qw;
  Qw[n + 1][n + 1] += config.qw * config.qw;
  const noise = Math.max(model.txNoise ?? 0, 0.02);
  const Rv = [[noise * noise * Ts, 0], [0, noise * noise * Ts]];
  const X = care(transpose(Ao), transpose(Co), Qw, Rv);
  const Rvi = inverse(Rv);
  if (!X || !Rvi) return fail('The observer can\'t be designed for this plant.');
  const L = matMul(matMul(X, transpose(Co)), Rvi.inv);
  const Aimp = Ao.map((r, i) => r.map((v, j) => v - L[i][0] * Co[0][j] - L[i][1] * Co[1][j]));
  const Bimp = Ao.map((_, i) => [Bo[i][0], Bo[i][1], L[i][0], L[i][1]]);
  const obs = c2d(Aimp, Bimp, Ts);

  // Prediction: y(i) = Cy·Φ^i·x + Σ_k Cy·Φ^(i−1−k)·Γ·u(min(k, M−1)) + d, for i = 1..P.
  const { Phi, Gamma } = c2d(m.A, Bu, Ts);
  const Sx = zeros(2 * P, n), Su = zeros(2 * P, 2 * M);
  let Pk = Phi.map((r) => r.slice());
  const impulse: Mat[] = []; // Cy·Φ^j·Γ for j = 0..P−1
  let PjG = Gamma.map((r) => r.slice());
  for (let j = 0; j < P; j++) {
    impulse.push(matMul(Cy, PjG));
    PjG = matMul(Phi, PjG);
  }
  for (let i = 1; i <= P; i++) {
    const CP = matMul(Cy, Pk);
    for (let o = 0; o < 2; o++) for (let j = 0; j < n; j++) Sx[2 * (i - 1) + o][j] = CP[o][j];
    Pk = matMul(Phi, Pk);
    for (let k = 0; k < i; k++) {
      const blk = impulse[i - 1 - k], col = Math.min(k, M - 1);
      for (let o = 0; o < 2; o++) for (let q = 0; q < 2; q++) Su[2 * (i - 1) + o][2 * col + q] += blk[o][q];
    }
  }
  const qy = [config.q1, config.q2];
  const QSu = Su.map((r, i) => r.map((v) => v * qy[i % 2]));
  const SuT = transpose(Su);
  // Moves: (z_j − z_{j−1}), with z_{−1} the output applied last.
  const D = zeros(2 * M);
  for (let j = 0; j < 2 * M; j++) { D[j][j] = 1; if (j >= 2) D[j][j - 2] = -1; }
  const DtD = matMul(transpose(D), D);
  const H = matMul(SuT, QSu).map((r, i) => r.map((v, j) => v + config.r * DtD[i][j]));
  const QSx = Sx.map((r, i) => r.map((v) => v * qy[i % 2]));
  const Fx = matMul(SuT, QSx);
  // A load d adds to every planned move: y = Sx·x + Su·(z + R·d).
  const R = Array.from({ length: 2 * M }, (_, i) => [i % 2 === 0 ? 1 : 0, i % 2 === 1 ? 1 : 0]);
  const Fd = matMul(SuT, matMul(QSu, R));
  const E = Array.from({ length: 2 * P }, (_, i) => [i % 2 === 0 ? -qy[0] : 0, i % 2 === 1 ? -qy[1] : 0]);
  const Fr = matMul(SuT, E);
  const Fu = Array.from({ length: 2 * M }, (_, i) => [i === 0 ? -config.r : 0, i === 1 ? -config.r : 0]);
  const lo = Array.from({ length: 2 * M }, (_, i) => -u0[i % 2]);
  const hi = Array.from({ length: 2 * M }, (_, i) => 100 - u0[i % 2]);
  const Ai = inverse(m.A);
  const Xu = Ai ? matMul(Ai.inv, Bu).map((r) => r.map((v) => -v)) : zeros(n, 2);
  if (!eig(H).every((p) => p.re > 0 && cabs(p) < 1e15)) return fail('The prediction problem is singular: give the moves some weight.');
  return { ok: true, u0, y0, n, Phio: obs.Phi, Gamo: obs.Gamma, H, Fx, Fd, Fr, Fu, lo, hi, Xu, Cy, G, lambda: rga11(G) };
}

/**
 * min zᵀHz + 2fᵀz over a box, by projected Gauss–Seidel: each sweep minimizes
 * over one variable at a time and clips it to its limits. Converges for any
 * positive definite H; a few dozen sweeps are plenty at this size.
 */
export function boxQp(H: Mat, f: number[], lo: number[], hi: number[], z0: number[], sweeps = 200) {
  const z = z0.map((v, i) => Math.min(hi[i], Math.max(lo[i], v)));
  for (let s = 0; s < sweeps; s++) {
    let change = 0;
    for (let i = 0; i < z.length; i++) {
      let g = f[i];
      for (let j = 0; j < z.length; j++) g += H[i][j] * z[j];
      const next = Math.min(hi[i], Math.max(lo[i], z[i] - g / H[i][i]));
      change = Math.max(change, Math.abs(next - z[i]));
      z[i] = next;
    }
    if (change < 1e-7) break;
  }
  return z;
}
