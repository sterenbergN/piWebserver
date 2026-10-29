// Small dense linear algebra for Loop Lab: complex numbers, matrices,
// eigenvalues and the matrix exponential. Systems here have a handful of
// states (valve, process, transmitter, delay approximation, controller), so
// plain O(n³) routines are plenty.

export type Complex = { re: number; im: number };
export type Mat = number[][];

export const cx = (re: number, im = 0): Complex => ({ re, im });
export const cadd = (a: Complex, b: Complex): Complex => ({ re: a.re + b.re, im: a.im + b.im });
export const csub = (a: Complex, b: Complex): Complex => ({ re: a.re - b.re, im: a.im - b.im });
export const cmul = (a: Complex, b: Complex): Complex => ({ re: a.re * b.re - a.im * b.im, im: a.re * b.im + a.im * b.re });
export const cscale = (a: Complex, k: number): Complex => ({ re: a.re * k, im: a.im * k });
export function cdiv(a: Complex, b: Complex): Complex {
  const d = b.re * b.re + b.im * b.im;
  return { re: (a.re * b.re + a.im * b.im) / d, im: (a.im * b.re - a.re * b.im) / d };
}
export const cabs = (a: Complex) => Math.hypot(a.re, a.im);
export const carg = (a: Complex) => Math.atan2(a.im, a.re);
/** e^{jφ} */
export const cexpj = (phi: number): Complex => ({ re: Math.cos(phi), im: Math.sin(phi) });

export const zeros = (n: number, m = n): Mat => Array.from({ length: n }, () => new Array(m).fill(0));
export function eye(n: number): Mat {
  const I = zeros(n);
  for (let i = 0; i < n; i++) I[i][i] = 1;
  return I;
}
export const copy = (A: Mat): Mat => A.map((r) => r.slice());

export function matMul(A: Mat, B: Mat): Mat {
  const n = A.length, m = B[0]?.length ?? 0, k = B.length;
  const C = zeros(n, m);
  for (let i = 0; i < n; i++) for (let p = 0; p < k; p++) {
    const a = A[i][p];
    if (a) for (let j = 0; j < m; j++) C[i][j] += a * B[p][j];
  }
  return C;
}
export function matAdd(A: Mat, B: Mat, kb = 1): Mat {
  return A.map((r, i) => r.map((v, j) => v + kb * B[i][j]));
}
export const matScale = (A: Mat, k: number): Mat => A.map((r) => r.map((v) => v * k));
export function matVec(A: Mat, x: ArrayLike<number>): number[] {
  return A.map((r) => r.reduce((s, v, j) => s + v * x[j], 0));
}
const norm1 = (A: Mat) => Math.max(0, ...A[0].map((_, j) => A.reduce((s, r) => s + Math.abs(r[j]), 0)));

/** Solve A x = b (real), partial pivoting. Returns null when A is singular. */
export function solve(A: Mat, b: number[]): number[] | null {
  const n = A.length;
  const M = A.map((r, i) => [...r, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    if (Math.abs(M[p][c]) < 1e-300) return null;
    [M[c], M[p]] = [M[p], M[c]];
    for (let r = c + 1; r < n; r++) {
      const f = M[r][c] / M[c][c];
      if (f) for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  const x = new Array(n).fill(0);
  for (let r = n - 1; r >= 0; r--) {
    let s = M[r][n];
    for (let k = r + 1; k < n; k++) s -= M[r][k] * x[k];
    x[r] = s / M[r][r];
  }
  return x;
}

export const transpose = (A: Mat): Mat => (A[0] ?? []).map((_, j) => A.map((r) => r[j]));

/** Inverse by Gauss–Jordan with partial pivoting, and log|det| (for scaling); null when singular. */
export function inverse(A: Mat): { inv: Mat; logDet: number } | null {
  const n = A.length;
  const M = A.map((r, i) => [...r, ...eye(n)[i]]);
  let logDet = 0;
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    if (Math.abs(M[p][c]) < 1e-300) return null;
    [M[c], M[p]] = [M[p], M[c]];
    const piv = M[c][c];
    logDet += Math.log(Math.abs(piv));
    for (let k = 0; k < 2 * n; k++) M[c][k] /= piv;
    for (let r = 0; r < n; r++) {
      const f = M[r][c];
      if (r !== c && f) for (let k = 0; k < 2 * n; k++) M[r][k] -= f * M[c][k];
    }
  }
  return { inv: M.map((r) => r.slice(n)), logDet };
}

/** Solve (jωI − A) x = b for complex x: the core of a state-space frequency response. */
export function solveShifted(A: Mat, w: number, b: number[]): Complex[] {
  const n = A.length;
  const M: Complex[][] = A.map((r, i) => [...r.map((v, j) => cx(-v, i === j ? w : 0)), cx(b[i])]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (cabs(M[r][c]) > cabs(M[p][c])) p = r;
    [M[c], M[p]] = [M[p], M[c]];
    const piv = M[c][c];
    if (cabs(piv) < 1e-300) continue;
    for (let r = c + 1; r < n; r++) {
      const f = cdiv(M[r][c], piv);
      if (f.re || f.im) for (let k = c; k <= n; k++) M[r][k] = csub(M[r][k], cmul(f, M[c][k]));
    }
  }
  const x: Complex[] = new Array(n).fill(cx(0));
  for (let r = n - 1; r >= 0; r--) {
    let s = M[r][n];
    for (let k = r + 1; k < n; k++) s = csub(s, cmul(M[r][k], x[k]));
    x[r] = cdiv(s, M[r][r]);
  }
  return x;
}

// ─── Eigenvalues ────────────────────────────────────────────────────────────
// Balance, reduce to upper Hessenberg form, then the shifted QR algorithm
// (the classic balanc / elmhes / hqr sequence). Indices are 1-based inside.

/** Eigenvalues of a real square matrix, sorted by real part (slowest first). */
export function eig(A0: Mat): Complex[] {
  const n = A0.length;
  if (n === 0) return [];
  const a: number[][] = zeros(n + 1);
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) a[i + 1][j + 1] = A0[i][j];
  balance(a, n);
  hessenberg(a, n);
  const wr = new Array(n + 1).fill(0), wi = new Array(n + 1).fill(0);
  if (!hqr(a, n, wr, wi)) return new Array(n).fill(cx(NaN, NaN));
  const out: Complex[] = [];
  for (let i = 1; i <= n; i++) out.push(cx(wr[i], wi[i]));
  return out.sort((p, q) => q.re - p.re || q.im - p.im);
}

function balance(a: number[][], n: number) {
  const RADIX = 2, SQRDX = 4;
  let done = false;
  while (!done) {
    done = true;
    for (let i = 1; i <= n; i++) {
      let r = 0, c = 0;
      for (let j = 1; j <= n; j++) if (j !== i) { c += Math.abs(a[j][i]); r += Math.abs(a[i][j]); }
      if (c && r) {
        let g = r / RADIX, f = 1;
        const s = c + r;
        while (c < g) { f *= RADIX; c *= SQRDX; }
        g = r * RADIX;
        while (c > g) { f /= RADIX; c /= SQRDX; }
        if ((c + r) / f < 0.95 * s) {
          done = false;
          g = 1 / f;
          for (let j = 1; j <= n; j++) a[i][j] *= g;
          for (let j = 1; j <= n; j++) a[j][i] *= f;
        }
      }
    }
  }
}

function hessenberg(a: number[][], n: number) {
  for (let m = 2; m < n; m++) {
    let x = 0, i = m;
    for (let j = m; j <= n; j++) if (Math.abs(a[j][m - 1]) > Math.abs(x)) { x = a[j][m - 1]; i = j; }
    if (i !== m) {
      for (let j = m - 1; j <= n; j++) [a[i][j], a[m][j]] = [a[m][j], a[i][j]];
      for (let j = 1; j <= n; j++) [a[j][i], a[j][m]] = [a[j][m], a[j][i]];
    }
    if (x) {
      for (i = m + 1; i <= n; i++) {
        let y = a[i][m - 1];
        if (y) {
          y /= x;
          a[i][m - 1] = y;
          for (let j = m; j <= n; j++) a[i][j] -= y * a[m][j];
          for (let j = 1; j <= n; j++) a[j][m] += y * a[j][i];
        }
      }
    }
  }
  // The multipliers left below the subdiagonal aren't part of the Hessenberg matrix.
  for (let i = 3; i <= n; i++) for (let j = 1; j < i - 1; j++) a[i][j] = 0;
}

const sign = (a: number, b: number) => (b >= 0 ? Math.abs(a) : -Math.abs(a));

function hqr(a: number[][], n: number, wr: number[], wi: number[]): boolean {
  let nn: number, m: number, l: number, k: number, its: number, mmin: number;
  let z = 0, y: number, x: number, w: number, v: number, u: number, t: number, s: number, r = 0, q = 0, p = 0;
  let anorm = 0;
  for (let i = 1; i <= n; i++) for (let j = Math.max(i - 1, 1); j <= n; j++) anorm += Math.abs(a[i][j]);
  nn = n;
  t = 0;
  while (nn >= 1) {
    its = 0;
    do {
      for (l = nn; l >= 2; l--) {
        s = Math.abs(a[l - 1][l - 1]) + Math.abs(a[l][l]);
        if (s === 0) s = anorm;
        if (Math.abs(a[l][l - 1]) + s === s) { a[l][l - 1] = 0; break; }
      }
      x = a[nn][nn];
      if (l === nn) {
        wr[nn] = x + t;
        wi[nn--] = 0;
      } else {
        y = a[nn - 1][nn - 1];
        w = a[nn][nn - 1] * a[nn - 1][nn];
        if (l === nn - 1) {
          p = 0.5 * (y - x);
          q = p * p + w;
          z = Math.sqrt(Math.abs(q));
          x += t;
          if (q >= 0) {
            z = p + sign(z, p);
            wr[nn - 1] = wr[nn] = x + z;
            if (z) wr[nn] = x - w / z;
            wi[nn - 1] = wi[nn] = 0;
          } else {
            wr[nn - 1] = wr[nn] = x + p;
            wi[nn] = z;
            wi[nn - 1] = -z;
          }
          nn -= 2;
        } else {
          if (its === 60) return false;
          if (its === 10 || its === 20) {
            t += x;
            for (let i = 1; i <= nn; i++) a[i][i] -= x;
            s = Math.abs(a[nn][nn - 1]) + Math.abs(a[nn - 1][nn - 2]);
            y = x = 0.75 * s;
            w = -0.4375 * s * s;
          }
          ++its;
          for (m = nn - 2; m >= l; m--) {
            z = a[m][m];
            r = x - z;
            s = y - z;
            p = (r * s - w) / a[m + 1][m] + a[m][m + 1];
            q = a[m + 1][m + 1] - z - r - s;
            r = a[m + 2][m + 1];
            s = Math.abs(p) + Math.abs(q) + Math.abs(r);
            p /= s; q /= s; r /= s;
            if (m === l) break;
            u = Math.abs(a[m][m - 1]) * (Math.abs(q) + Math.abs(r));
            v = Math.abs(p) * (Math.abs(a[m - 1][m - 1]) + Math.abs(z) + Math.abs(a[m + 1][m + 1]));
            if (u + v === v) break;
          }
          for (let i = m + 2; i <= nn; i++) {
            a[i][i - 2] = 0;
            if (i !== m + 2) a[i][i - 3] = 0;
          }
          for (k = m; k <= nn - 1; k++) {
            if (k !== m) {
              p = a[k][k - 1];
              q = a[k + 1][k - 1];
              r = 0;
              if (k !== nn - 1) r = a[k + 2][k - 1];
              if ((x = Math.abs(p) + Math.abs(q) + Math.abs(r)) !== 0) { p /= x; q /= x; r /= x; }
            }
            if ((s = sign(Math.sqrt(p * p + q * q + r * r), p)) !== 0) {
              if (k === m) {
                if (l !== m) a[k][k - 1] = -a[k][k - 1];
              } else a[k][k - 1] = -s * x;
              p += s;
              x = p / s; y = q / s; z = r / s;
              q /= p; r /= p;
              for (let j = k; j <= nn; j++) {
                p = a[k][j] + q * a[k + 1][j];
                if (k !== nn - 1) {
                  p += r * a[k + 2][j];
                  a[k + 2][j] -= p * z;
                }
                a[k + 1][j] -= p * y;
                a[k][j] -= p * x;
              }
              mmin = nn < k + 3 ? nn : k + 3;
              for (let i = l; i <= mmin; i++) {
                p = x * a[i][k] + y * a[i][k + 1];
                if (k !== nn - 1) {
                  p += z * a[i][k + 2];
                  a[i][k + 2] -= p * r;
                }
                a[i][k + 1] -= p * q;
                a[i][k] -= p;
              }
            }
          }
        }
      }
    } while (l < nn - 1);
  }
  return true;
}

// ─── Matrix exponential ─────────────────────────────────────────────────────

/** e^A by scaling and squaring with a Taylor series. */
export function expm(A: Mat): Mat {
  const n = A.length;
  const nrm = norm1(A);
  const sq = nrm > 0.5 ? Math.ceil(Math.log2(nrm / 0.5)) : 0;
  const As = matScale(A, 2 ** -sq);
  let term = eye(n);
  let sum = eye(n);
  for (let k = 1; k <= 14; k++) {
    term = matScale(matMul(term, As), 1 / k);
    sum = matAdd(sum, term);
  }
  for (let i = 0; i < sq; i++) sum = matMul(sum, sum);
  return sum;
}

/**
 * Exact zero-order-hold discretization of ẋ = Ax + Bu over a step h:
 * x[k+1] = Φ x[k] + Γ u[k]. (Uses the block matrix exponential.)
 */
export function c2d(A: Mat, B: Mat, h: number): { Phi: Mat; Gamma: Mat } {
  const n = A.length, m = B[0]?.length ?? 0;
  const M = zeros(n + m);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) M[i][j] = A[i][j] * h;
    for (let j = 0; j < m; j++) M[i][n + j] = B[i][j] * h;
  }
  const E = expm(M);
  return {
    Phi: E.slice(0, n).map((r) => r.slice(0, n)),
    Gamma: E.slice(0, n).map((r) => r.slice(n)),
  };
}

/** Polynomial with the given roots (real coefficients, highest power first). */
export function polyFromRoots(roots: Complex[]): number[] {
  let p: Complex[] = [cx(1)];
  for (const r of roots) {
    const next: Complex[] = new Array(p.length + 1).fill(cx(0));
    for (let i = 0; i < p.length; i++) {
      next[i] = cadd(next[i], p[i]);
      next[i + 1] = csub(next[i + 1], cmul(p[i], r));
    }
    p = next;
  }
  return p.map((c) => c.re);
}

/** Seeded pseudo-random numbers (mulberry32), so runs with noise are repeatable. */
export function rng(seed: number) {
  let s = seed >>> 0 || 1;
  const next = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  /** Standard normal (Box–Muller). */
  const gauss = () => {
    const u = Math.max(next(), 1e-12), v = next();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };
  return { next, gauss };
}
