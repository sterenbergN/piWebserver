import type { ControllerConfig } from './controllers';
import { linearizePlant, type PlantModel } from './linear';
import { c2d, cabs, eig, inverse, matMul, polyFromRoots, solve, transpose, zeros, type Complex, type Mat } from './linalg';
import { toPct, toPct2, type Params, type ProcessDef } from './model';
import { findSteady } from './sim';

// State feedback with an observer: the design numerics. The controller's model
// is the plant linearized at its design point (valve, process, transmitter
// states, in % in and % of span out). The regulator gain comes from pole
// placement (Ackermann) or LQR (Riccati), the observer gain from pole placement
// on the dual system or a Kalman filter; both are designed in continuous time
// and the resulting controller is discretized for the PLC cycle.

export type StateFbConfig = Extract<ControllerConfig, { kind: 'statefb' }>;

/**
 * Stabilizing solution X of A'X + XA − XBR⁻¹B'X + Q = 0 (the LQR Riccati
 * equation), from the matrix sign function of the Hamiltonian: X spans its
 * stable invariant subspace. Null if there is none.
 */
export function care(A: Mat, B: Mat, Q: Mat, R: Mat): Mat | null {
  const n = A.length;
  const Ri = inverse(R);
  if (!Ri) return null;
  const S = matMul(matMul(B, Ri.inv), transpose(B));
  const At = transpose(A);
  let Z: Mat = [
    ...A.map((r, i) => [...r, ...S[i].map((v) => -v)]),
    ...Q.map((r, i) => [...r.map((v) => -v), ...At[i].map((v) => -v)]),
  ];
  const norm = (M: Mat) => Math.max(...M.map((r) => r.reduce((s, v) => s + Math.abs(v), 0)));
  for (let k = 0; k < 200; k++) {
    const zi = inverse(Z);
    if (!zi) return null;
    // Determinant scaling speeds up the first iterations a lot.
    const c = Math.exp(zi.logDet / (2 * n));
    const next = Z.map((r, i) => r.map((v, j) => 0.5 * (v / c + c * zi.inv[i][j])));
    const diff = norm(next.map((r, i) => r.map((v, j) => v - Z[i][j])));
    Z = next;
    if (diff < 1e-12 * norm(Z)) break;
  }
  // W·[I; X] = −[I; X]  →  [W12; W22 + I]·X = −[W11 + I; W21], solved by least squares.
  const M = [...Z.slice(0, n).map((r) => r.slice(n)), ...Z.slice(n).map((r, i) => r.slice(n).map((v, j) => v + (i === j ? 1 : 0)))];
  const N = [...Z.slice(0, n).map((r, i) => r.slice(0, n).map((v, j) => -(v + (i === j ? 1 : 0)))), ...Z.slice(n).map((r) => r.slice(0, n).map((v) => -v))];
  const Mt = transpose(M);
  const MtM = inverse(matMul(Mt, M));
  if (!MtM) return null;
  const X = matMul(MtM.inv, matMul(Mt, N));
  const Xs = X.map((r, i) => r.map((v, j) => (v + X[j][i]) / 2));
  if (Xs.some((r) => r.some((v) => !Number.isFinite(v)))) return null;
  const SX = matMul(S, Xs);
  const closed = A.map((r, i) => r.map((v, j) => v - SX[i][j]));
  return eig(closed).every((p) => p.re < 0) ? Xs : null;
}

/** Diagonal scaling d so that D⁻¹AD has rows and columns of similar size (Osborne). */
function balance(A: Mat) {
  const n = A.length;
  const d = new Array(n).fill(1);
  const M = A.map((r) => r.slice());
  for (let it = 0; it < 30; it++) {
    let done = true;
    for (let i = 0; i < n; i++) {
      let c = 0, r = 0;
      for (let j = 0; j < n; j++) if (j !== i) { c += Math.abs(M[j][i]); r += Math.abs(M[i][j]); }
      if (!c || !r) continue;
      const f = Math.sqrt(r / c);
      if (Math.abs(Math.log(f)) < 0.05) continue;
      done = false;
      d[i] *= f;
      for (let j = 0; j < n; j++) { M[j][i] *= f; M[i][j] /= f; }
    }
    if (done) break;
  }
  return d;
}

/**
 * Single-input pole placement (Ackermann): K such that A − bK has the given
 * poles. Balanced and time-scaled first, because the controllability matrix
 * of a plant with fast and slow states is badly conditioned. Null when the
 * plant isn't controllable (or numerically close to it).
 */
export function place(A: Mat, b: number[], poles: Complex[]): number[] | null {
  const n = A.length;
  const d = balance(A);
  const mags = poles.map(cabs).filter((v) => v > 1e-9);
  const ws = mags.length ? Math.exp(mags.reduce((s, v) => s + Math.log(v), 0) / mags.length) : 1;
  const An = A.map((r, i) => r.map((v, j) => (v * d[j]) / d[i] / ws));
  const bn = b.map((v, i) => v / d[i] / ws);
  const cols: number[][] = [bn];
  for (let k = 1; k < n; k++) cols.push(An.map((r) => r.reduce((s, v, j) => s + v * cols[k - 1][j], 0)));
  const ctrbT = cols; // rows of Cᵀ are the columns of C
  const inv = inverse(ctrbT);
  if (!inv) return null;
  // q = last row of C⁻¹, i.e. qᵀ solves Cᵀ q = e_n... from (Cᵀ)⁻¹ e_n.
  const q = inv.inv.map((r) => r[n - 1]);
  const coef = polyFromRoots(poles.map((p) => ({ re: p.re / ws, im: p.im / ws })));
  // K = qᵀ·φ(A) with φ(A) = Σ coef[k]·A^{n−k}: accumulate qᵀA^j.
  let row = q.slice();
  const K = new Array(n).fill(0);
  for (let j = 0; j <= n; j++) {
    const c = coef[n - j];
    for (let i = 0; i < n; i++) K[i] += c * row[i];
    row = row.map((_, i) => row.reduce((s, v, k) => s + v * An[k][i], 0));
  }
  const out = K.map((v, i) => v / d[i]);
  if (!out.every(Number.isFinite)) return null;
  // Ackermann loses accuracy as the plant gets close to uncontrollable: check the poles really are where asked.
  const got = eig(A.map((r, i) => r.map((v, j) => v - b[i] * out[j]))).sort((p, q) => p.re - q.re || p.im - q.im);
  const want = [...poles].sort((p, q) => p.re - q.re || p.im - q.im);
  const scale = Math.max(1, ...want.map(cabs));
  return got.every((p, i) => cabs({ re: p.re - want[i].re, im: p.im - want[i].im }) < 1e-3 * scale) ? out : null;
}

/**
 * Pole placement for one or more inputs by the Sylvester-equation method:
 * pick F with the wanted poles and any G, solve A·X − X·F = B·G, then
 * K = G·X⁻¹ gives A − B·K the poles of F. Better conditioned than
 * Ackermann's formula, and it takes several inputs (so the dual problem, an
 * observer with several measurements, works too). Balanced and time-scaled
 * first; repeated poles become Jordan blocks so X stays invertible. Null when
 * it can't be done (uncontrollable, or numerically too close to it).
 */
export function placeMulti(A: Mat, B: Mat, poles: Complex[]): Mat | null {
  const n = A.length, m = B[0]?.length ?? 0;
  if (!m || poles.length !== n) return null;
  const d = balance(A);
  const mags = poles.map(cabs).filter((v) => v > 1e-9);
  const ws = mags.length ? Math.exp(mags.reduce((s, v) => s + Math.log(v), 0) / mags.length) : 1;
  const An = A.map((r, i) => r.map((v, j) => (v * d[j]) / d[i] / ws));
  const Bn = B.map((r, i) => r.map((v) => v / d[i] / ws));
  // F in real block form: real poles on the diagonal (repeats chained into Jordan blocks), pairs as [σ ω; −ω σ].
  const F = zeros(n);
  const sorted = [...poles].map((p) => ({ re: p.re / ws, im: p.im / ws })).sort((p, q) => p.re - q.re || q.im - p.im);
  let k = 0;
  let prevReal: number | null = null;
  for (const p of sorted) {
    if (k >= n) break;
    if (Math.abs(p.im) < 1e-9) {
      F[k][k] = p.re;
      if (prevReal !== null && Math.abs(prevReal - p.re) < 1e-9 * Math.max(1, Math.abs(p.re))) F[k - 1][k] = 1;
      prevReal = p.re;
      k++;
    } else if (p.im > 0 && k + 1 < n) {
      F[k][k] = p.re; F[k][k + 1] = p.im; F[k + 1][k] = -p.im; F[k + 1][k + 1] = p.re;
      prevReal = null;
      k += 2;
    }
  }
  if (k !== n) return null;
  // G: every input touches every mode, with a different mix per input.
  const G = Array.from({ length: m }, (_, r) => Array.from({ length: n }, (_, j) => (r === 0 ? 1 : Math.cos((r * (j + 1) * Math.PI) / (n + 1)))));
  const BG = matMul(Bn, G);
  // vec(A·X − X·F) = (I⊗A − Fᵀ⊗I)·vec(X), columns stacked.
  const N = n * n;
  const M = zeros(N);
  const rhs = new Array(N).fill(0);
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
    const row = j * n + i;
    rhs[row] = BG[i][j];
    for (let q = 0; q < n; q++) {
      M[row][j * n + q] += An[i][q];
      M[row][q * n + i] -= F[q][j];
    }
  }
  const x = solve(M, rhs);
  if (!x) return null;
  const X = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => x[j * n + i]));
  const Xi = inverse(X);
  if (!Xi) return null;
  const Kn = matMul(G, Xi.inv);
  const K = Kn.map((r) => r.map((v, j) => v / d[j]));
  if (!K.every((r) => r.every(Number.isFinite))) return null;
  const BK = matMul(B, K);
  const got = eig(A.map((r, i) => r.map((v, j) => v - BK[i][j]))).sort((p, q) => p.re - q.re || p.im - q.im);
  const want = [...poles].sort((p, q) => p.re - q.re || p.im - q.im);
  const scale = Math.max(1, ...want.map(cabs));
  return got.every((p, i) => cabs({ re: p.re - want[i].re, im: p.im - want[i].im }) < 1e-3 * scale) ? K : null;
}

/**
 * Where the regulator's poles go for pole placement with a dominant pair
 * (ω_n, ζ): the two slowest open-loop poles (or the slowest pair) become the
 * dominant pair; every other pole stays where it is if it is at least as fast
 * and damped, unstable ones are mirrored, slow ones are moved out to ω_n,
 * and lightly damped pairs (resonances) keep their frequency but get damping ζ.
 */
export function regulatorPoles(open: Complex[], wn: number, zeta: number): Complex[] {
  const scale = Math.max(1, ...open.map(cabs));
  const real = (p: Complex) => Math.abs(p.im) < 1e-7 * scale;
  type Item = { kind: 'real'; p: number } | { kind: 'pair'; w0: number; z0: number };
  const items: Item[] = [];
  for (const p of open) {
    if (real(p)) items.push({ kind: 'real', p: p.re });
    else if (p.im > 0) items.push({ kind: 'pair', w0: cabs(p), z0: -p.re / cabs(p) });
  }
  const size = (it: Item) => (it.kind === 'real' ? Math.abs(it.p) : it.w0);
  items.sort((a, b) => size(a) - size(b));
  const pair = (w: number, z: number): Complex[] => (z < 1
    ? [{ re: -z * w, im: w * Math.sqrt(1 - z * z) }, { re: -z * w, im: -w * Math.sqrt(1 - z * z) }]
    : [{ re: -w * (z - Math.sqrt(z * z - 1)), im: 0 }, { re: -w * (z + Math.sqrt(z * z - 1)), im: 0 }]);
  const out: Complex[] = [];
  let rest = items;
  if (items[0]?.kind === 'pair' || (items[0]?.kind === 'real' && items[1]?.kind === 'real')) {
    out.push(...pair(wn, zeta));
    rest = items.slice(items[0].kind === 'pair' ? 1 : 2);
  }
  for (const it of rest) {
    if (it.kind === 'real') out.push({ re: -Math.max(Math.abs(it.p), wn), im: 0 });
    else out.push(...pair(Math.max(it.w0, wn), Math.max(it.z0, zeta)));
  }
  return out;
}

const STATE_LABELS = (proc: ProcessDef) => [
  `${proc.tags.valve} (actuator)`,
  ...proc.states.map((s) => s.label),
  `${proc.tags.transmitter} reading`,
  ...(proc.secondary ? [`${proc.secondary.tag} reading`] : []),
];

export type StateFbDesign = {
  ok: boolean;
  /** Why the design failed, in words. */
  error?: string;
  /** State names of the controller's model, and the integral state if there is one. */
  states: string[];
  units: string[];
  n: number;
  /** How it gets rid of offset: not at all, with an integral of the error, or by estimating a disturbance. */
  mode: 'none' | 'error' | 'dist';
  /** Disturbance estimate: engineering units per % of the disturbance's range. */
  dScale: number;
  /** An integral of the error (the state anti-windup applies to). */
  integral: boolean;
  inputs: ('pv' | 'pv2')[];
  /** Regulator: u = u₀ − K·x̂ − K_z·z + N_r·r, or + N_d·d̂ with an estimated disturbance (deviations, %). */
  K: number[];
  Kz: number;
  Nx: number[];
  Nr: number;
  /** Observer gain, one column per measurement (a row more with a disturbance state). */
  L: Mat;
  open: Complex[];
  poles: Complex[];
  obsPoles: Complex[];
  /** The design point: valve %, PV %, secondary %. */
  u0: number;
  y0: number;
  y20: number;
  /** Plant model rows (for the estimate of the PV). */
  Cpv: number[];
  /**
   * The whole controller as one continuous linear system from the
   * measurements (deviations, %) and the setpoint to the output, for the
   * analysis tools: ẋc = A·xc + By·y + Br·r, u = C·xc + Dr·r.
   */
  ctrl: { A: Mat; By: Mat; Br: number[]; C: number[]; Dr: number };
  /** The same, discretized for the PLC with the applied output fed back: xc ← Φ·xc + Γ·[u, y…, r]. */
  disc: { Phi: Mat; Gamma: Mat };
};

const cache = new Map<string, StateFbDesign>();

/** The design at the controller's design point, from the setup's parameters (cached). */
export function designStateFb(proc: ProcessDef, config: StateFbConfig, model: Params): StateFbDesign {
  const key = `${proc.id}|${JSON.stringify(config)}|${JSON.stringify(model)}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const d = computeDesign(proc, config, model);
  if (cache.size > 200) cache.clear();
  cache.set(key, d);
  return d;
}

/**
 * The model without the secondary transmitter's filter, when that reading isn't used: nothing
 * else depends on it, so the observer could never see it. The secondary row then points at
 * the true value the transmitter would read, so an LQR weight on it still means something.
 */
function withoutSecondaryReading(m: PlantModel): PlantModel {
  const j = m.C2 ? m.C2.findIndex((v) => v !== 0) : -1;
  if (j < 0 || m.A.some((r, i) => i !== j && r[j] !== 0) || !(m.A[j][j] < 0)) return m;
  const tau = -1 / m.A[j][j], k = m.C2![j];
  const idx = m.A.map((_, i) => i).filter((i) => i !== j);
  return {
    ...m,
    A: idx.map((i) => idx.map((c) => m.A[i][c])), B: idx.map((i) => m.B[i]), C: idx.map((i) => m.C[i]), Ctrue: idx.map((i) => m.Ctrue[i]),
    C2: idx.map((i) => m.A[j][i] * tau * k), Bd: Object.fromEntries(Object.entries(m.Bd).map(([key, col]) => [key, idx.map((i) => col[i])])),
    keep: idx.map((i) => m.keep[i]),
  };
}

function computeDesign(proc: ProcessDef, config: StateFbConfig, model: Params): StateFbDesign {
  const full = linearizePlant(proc, model, proc.nominalPv);
  const inputs: ('pv' | 'pv2')[] = config.measure === 'both' && full.C2 ? ['pv', 'pv2'] : config.measure === 'pv2' && full.C2 ? ['pv2'] : ['pv'];
  const m = inputs.includes('pv2') ? full : withoutSecondaryReading(full);
  const s = findSteady(proc, model, Object.fromEntries(proc.disturbances.map((x) => [x.key, x.nominal])), proc.nominalPv);
  const n = m.A.length;
  const labels = STATE_LABELS(proc);
  const units = ['%', ...proc.states.map((x) => x.unit), proc.pv.unit, ...(proc.secondary ? [proc.secondary.unit] : [])];
  const Cm = inputs.map((k) => (k === 'pv' ? m.C : m.C2!));
  const mode = config.integral;
  const integral = mode === 'error', dist = mode === 'dist';
  // Offset-free by estimating a constant disturbance: the process's first unmeasured one, where it really
  // acts; a load at the valve if every disturbance is measured.
  const upset = proc.disturbances.find((x) => !x.measured);
  // The estimate is kept in % of the disturbance's range, so the observer's numbers stay of similar size.
  const dScale = upset ? (upset.max - upset.min) / 100 : 1;
  const bd = dist ? (upset ? m.Bd[upset.key].map((v) => v * dScale) : m.B) : null;
  const extraLabel = integral ? 'Integral of the error' : dist ? `Estimated ${upset ? upset.label.toLowerCase() : 'load at the valve'}` : null;
  const base: StateFbDesign = {
    ok: false, states: [...m.keep.map((i) => labels[i]), ...(extraLabel ? [extraLabel] : [])],
    units: [...m.keep.map((i) => units[i]), ...(integral ? ['%·s'] : dist ? ['%'] : [])], n, mode, integral, inputs, dScale,
    K: new Array(n).fill(0), Kz: 0, Nx: new Array(n).fill(0), Nr: 0, L: zeros(n, inputs.length),
    open: [], poles: [], obsPoles: [], u0: s.valve, y0: toPct(proc, s.pv), y20: proc.secondary ? toPct2(proc.secondary, s.pv2) : NaN, Cpv: m.C,
    ctrl: { A: [], By: [], Br: [], C: [], Dr: 0 }, disc: { Phi: [], Gamma: [] },
  };

  // Regulator on the physical states. The transmitters' filters only delay what is read: they get no gain
  // and keep their poles, and the PV and secondary rows point at what the transmitters would read.
  const filters = m.A.map((_, j) => j).filter((j) => (m.C[j] || m.C2?.[j]) && m.A[j][j] < 0 && m.A.every((r, i) => i === j || r[j] === 0));
  const phys = m.A.map((_, j) => j).filter((j) => !filters.includes(j));
  const settle = (row: number[]) => phys.map((k) => row[k] + filters.reduce((acc, j) => acc + (row[j] * m.A[j][k]) / -m.A[j][j], 0));
  const Cr = settle(m.C), C2r = m.C2 ? settle(m.C2) : null;
  const nr = phys.length, nra = nr + (integral ? 1 : 0);
  const Ar = phys.map((i) => phys.map((j) => m.A[i][j])), Brr = phys.map((i) => m.B[i]);
  const Aa: Mat = integral ? [...Ar.map((r) => [...r, 0]), [...Cr.map((v) => -v), 0]] : Ar;
  const Ba = integral ? [...Brr, 0] : Brr;
  const open = eig(Aa);
  let Kr: number[] | null;
  if (config.design === 'lqr') {
    const Q = zeros(nra);
    for (let i = 0; i < nr; i++) for (let j = 0; j < nr; j++) {
      Q[i][j] = config.qy * Cr[i] * Cr[j] + (C2r ? config.q2 * C2r[i] * C2r[j] : 0) + (i === j ? 1e-9 : 0);
    }
    if (integral) Q[nr][nr] = config.qi;
    const X = care(Aa, Ba.map((v) => [v]), Q, [[1]]);
    Kr = X ? Ba.reduce((acc, b, i) => acc.map((v, j) => v + b * X[i][j]), new Array(nra).fill(0)) : null;
  } else Kr = placeMulti(Aa, Ba.map((v) => [v]), regulatorPoles(open, config.wn, config.zeta))?.[0] ?? place(Aa, Ba, regulatorPoles(open, config.wn, config.zeta));
  if (!Kr) return { ...base, open, error: config.design === 'lqr' ? 'The Riccati equation has no stabilizing solution for these weights.' : 'The plant isn\'t controllable from the valve with these poles (the pole placement is singular).' };
  const K = new Array(n).fill(0);
  phys.forEach((j, i) => { K[j] = Kr![i]; });
  const Kz = integral ? Kr[nr] : 0;
  // Closed-loop poles of the whole model, filters included.
  const Afull: Mat = integral ? [...m.A.map((r) => [...r, 0]), [...m.C.map((v) => -v), 0]] : m.A;
  const Bfull = integral ? [...m.B, 0] : m.B;
  const Kfull = integral ? [...K, Kz] : K;
  const poles = eig(Afull.map((r, i) => r.map((v, j) => v - Bfull[i] * Kfull[j])));

  // Observer, on the plant model plus the disturbance state if it estimates one.
  const no = n + (dist ? 1 : 0);
  const Ao: Mat = dist ? [...m.A.map((r, i) => [...r, bd![i]]), new Array(no).fill(0)] : m.A;
  const Bo = dist ? [...m.B, 0] : m.B;
  const Co = Cm.map((c) => (dist ? [...c, 0] : c));
  let L: Mat | null = null;
  if (config.observer === 'poles') {
    const sorted = [...poles].sort((a, b) => cabs(a) - cabs(b));
    let target = (integral ? sorted.slice(1) : sorted).map((p) => ({ re: p.re * config.obsSpeed, im: p.im * config.obsSpeed }));
    if (dist) target = [{ re: -cabs(sorted[0] ?? { re: 1, im: 0 }) * config.obsSpeed, im: 0 }, ...target];
    // The dual problem: poles of A − L·C are those of Aᵀ − Cᵀ·Lᵀ.
    const Kd = placeMulti(transpose(Ao), transpose(Co), fixPairs(target));
    if (Kd) L = transpose(Kd);
  } else {
    const noise = Math.max(model.txNoise ?? 0, 0.02);
    const Rv = inputs.map((_, i) => inputs.map((__, j) => (i === j ? noise * noise * model.Ts : 0)));
    // Process noise, scaled to the regulator's speed ω (its slowest pole) so qw means the same on any plant:
    // white upsets at the valve's output (and where the estimated disturbance acts), qw/ω % each, and the
    // disturbance drifting by qw % of its range per √s. The ratio sets how fast the estimate follows: about ω.
    const w = Math.max(1e-6, Math.min(...poles.filter((p) => p.re < 0).map(cabs)));
    const v = m.keep.indexOf(0);
    const atValve = v >= 0 ? m.A.map((r, i) => (i === v ? 0 : r[v])) : m.B;
    const dirs = [dist ? [...atValve, 0] : atValve, ...(dist ? [[...bd!, 0]] : [])];
    const Qw = Bo.map((_, i) => Bo.map((__, j) => config.qw * config.qw * dirs.reduce((acc, g) => acc + g[i] * g[j], 0) / (w * w) + (i === j ? 1e-9 : 0)));
    if (dist) Qw[n][n] += config.qw * config.qw;
    const X = care(transpose(Ao), transpose(Co), Qw, Rv);
    const Rvi = inverse(Rv);
    if (X && Rvi) L = matMul(matMul(X, transpose(Co)), Rvi.inv);
  }
  if (!L) return { ...base, open, poles, K, Kz, error: 'The observer can\'t be designed: the states aren\'t all visible from the chosen measurement.' };
  const obsPoles = eig(Ao.map((r, i) => r.map((v, j) => v - Co.reduce((acc, c, k) => acc + L![i][k] * c[j], 0))));

  // Reference (and disturbance) feedforward: the steady state and valve signal that hold the PV at r against
  // d̂, so a setpoint change doesn't wait for the integral and an estimated upset is cancelled.
  const big = [...m.A.map((r, i) => [...r, m.B[i]]), [...m.C, 0]];
  const sol = inverse(big);
  const Nx = sol ? sol.inv.slice(0, n).map((r) => r[n]) : new Array(n).fill(0);
  const Nu = sol ? sol.inv[n][n] : 0;
  const Nr = Nu + K.reduce((acc, k, i) => acc + k * Nx[i], 0);
  let Nd = 0;
  if (dist && sol) {
    // x_ss and u_ss with −B_d·d̂ on the right-hand side.
    const col = sol.inv.map((r) => -r.slice(0, n).reduce((acc, v, j) => acc + v * bd![j], 0));
    Nd = col[n] + K.reduce((acc, k, i) => acc + k * col[i], 0);
  }

  // The controller as one linear system. States [x̂, (z or d̂)], inputs [applied output, measurements, setpoint].
  const nc = n + (mode === 'none' ? 0 : 1), my = inputs.length;
  const pvIdx = inputs.indexOf('pv');
  const Aimp = zeros(nc), Bimp = zeros(nc, 1 + my + 1);
  for (let i = 0; i < no; i++) {
    for (let j = 0; j < no; j++) Aimp[i][j] = Ao[i][j] - Co.reduce((acc, c, k) => acc + L![i][k] * c[j], 0);
    for (let k = 0; k < my; k++) Bimp[i][1 + k] = L[i][k];
    Bimp[i][0] = Bo[i];
  }
  if (integral) {
    if (pvIdx >= 0) Bimp[n][1 + pvIdx] = -1;
    else for (let j = 0; j < n; j++) Aimp[n][j] = -m.C[j];
    Bimp[n][1 + my] = 1;
  }
  const C = [...K.map((v) => -v), ...(integral ? [-Kz] : dist ? [Nd] : [])];
  // Closing u = C·xc + N_r·r round the observer's input gives the analysis form.
  const A = Aimp.map((r, i) => r.map((v, j) => v + Bimp[i][0] * C[j]));
  const By = Bimp.map((r) => r.slice(1, 1 + my));
  const Br = Bimp.map((r) => r[1 + my] + r[0] * Nr);
  const disc = c2d(Aimp, Bimp, model.Ts);
  return { ...base, ok: true, open, poles, obsPoles, K, Kz, Nx, Nr, L, ctrl: { A, By, Br, C, Dr: Nr }, disc };
}

/** A pole list scaled from a conjugate-symmetric one stays symmetric; tidy rounding so polyFromRoots stays real. */
const fixPairs = (p: Complex[]) => p.map((v) => (Math.abs(v.im) < 1e-12 ? { re: v.re, im: 0 } : v));
