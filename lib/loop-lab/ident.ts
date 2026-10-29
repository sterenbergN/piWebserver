// Model identification from a trend: parse a CSV export (TIA Portal traces,
// historians, spreadsheets), then fit first- or second-order-plus-dead-time or
// integrator-plus-dead-time models by least squares on the simulated
// response to the recorded output. Fit % is the normalised root-mean-square
// fit used by most identification tools: 100·(1 − ‖y − ŷ‖ / ‖y − ȳ‖).

export type Table = { columns: string[]; rows: number[][] };

const DELIMS = [';', ',', '\t'] as const;

function splitLine(line: string, delim: string) {
  // Quotes are rare in trend exports; strip them rather than parse them.
  return line.split(delim).map((c) => c.trim().replace(/^"(.*)"$/, '$1').trim());
}

function parseCell(cell: string, decimalComma: boolean): number {
  if (!cell) return NaN;
  const plain = decimalComma ? cell.replace(/\s/g, '').replace(',', '.') : cell.replace(/\s/g, '');
  if (/^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/.test(plain)) return Number(plain);
  // Timestamps: seconds since the epoch, made relative later.
  if (/\d[:/-]\d/.test(cell)) {
    const t = Date.parse(cell.replace(/(\d)\.(\d{3})(?!\d)/, '$1.$2'));
    if (Number.isFinite(t)) return t / 1000;
  }
  return NaN;
}

/** Parse a delimited text table: finds the delimiter, decimal commas, the header row and the numbers. */
export function parseTable(text: string, maxRows = 200000): Table {
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== '');
  if (!lines.length) return { columns: [], rows: [] };
  const sample = lines.slice(0, 50);
  // The delimiter is the one that splits the most lines into the same number of fields.
  const agreement = (d: string) => {
    const freq = new Map<number, number>();
    for (const l of sample) {
      const c = l.split(d).length - 1;
      if (c > 0) freq.set(c, (freq.get(c) ?? 0) + 1);
    }
    return Math.max(0, ...freq.values());
  };
  const delim = DELIMS.reduce((best, d) => (agreement(d) > agreement(best) ? d : best), DELIMS[0] as string);
  // With ';' or tabs, a comma inside a number is a decimal comma.
  const decimalComma = delim !== ',' && sample.some((l) => /\d,\d/.test(l));
  let header: string[] | null = null;
  const rows: number[][] = [];
  for (const line of lines) {
    const cells = splitLine(line, delim);
    const nums = cells.map((c) => parseCell(c, decimalComma));
    const numeric = nums.filter(Number.isFinite).length;
    if (numeric >= Math.max(2, Math.ceil(cells.length / 2))) {
      rows.push(nums);
      if (rows.length >= maxRows) break;
    } else if (!rows.length && cells.length > 1) header = cells;
  }
  const width = Math.max(0, ...rows.map((r) => r.length));
  const columns = Array.from({ length: width }, (_, i) => header?.[i] || `Column ${i + 1}`);
  return { columns, rows: rows.map((r) => Array.from({ length: width }, (_, i) => r[i] ?? NaN)) };
}

// ─── Fitting ────────────────────────────────────────────────────────────────

export type ModelType = 'fopdt' | 'sopdt' | 'integrating';

export type IdentResult = {
  type: ModelType;
  /** Gain, PV units per output unit (self-regulating). */
  K: number;
  /** Integrating slope, PV units per second per output unit. */
  kPrime: number;
  tau1: number;
  tau2: number;
  theta: number;
  /** Normalised fit, %. */
  fit: number;
  /** Resampled time base and data, and the model's response, for plotting. */
  t: number[];
  u: number[];
  y: number[];
  yhat: number[];
  /** Where the record started (the operating point the deviations are taken from). */
  u0: number;
  y0: number;
  /** Standard deviation of the residual: measurement noise plus what the model misses. */
  noise: number;
  dt: number;
};

/** Uniform time base (median step), linear interpolation, at most `maxN` points. */
export function resample(t: number[], series: number[][], maxN = 3000) {
  const ok = t.map((v, i) => Number.isFinite(v) && series.every((s) => Number.isFinite(s[i])));
  const tt = t.filter((_, i) => ok[i]);
  const ss = series.map((s) => s.filter((_, i) => ok[i]));
  if (tt.length < 3) return null;
  const order = tt.map((_, i) => i).sort((a, b) => tt[a] - tt[b]);
  const ts = order.map((i) => tt[i]);
  const sv = ss.map((s) => order.map((i) => s[i]));
  const diffs = ts.slice(1).map((v, i) => v - ts[i]).filter((v) => v > 0).sort((a, b) => a - b);
  if (!diffs.length) return null;
  let dt = diffs[Math.floor(diffs.length / 2)];
  const span = ts[ts.length - 1] - ts[0];
  if (span / dt > maxN) dt = span / maxN;
  const n = Math.floor(span / dt) + 1;
  const out = sv.map(() => new Array<number>(n));
  let j = 0;
  for (let k = 0; k < n; k++) {
    const tk = ts[0] + k * dt;
    while (j < ts.length - 2 && ts[j + 1] < tk) j++;
    const w = ts[j + 1] > ts[j] ? Math.min(1, Math.max(0, (tk - ts[j]) / (ts[j + 1] - ts[j]))) : 0;
    sv.forEach((s, c) => { out[c][k] = s[j] + w * (s[j + 1] - s[j]); });
  }
  return { t: Array.from({ length: n }, (_, k) => k * dt), series: out, dt };
}

/** Response of the model's dynamic part (unit gain) to an input record, deviation form. */
function simulate(du: number[], dt: number, type: ModelType, tau1: number, tau2: number, theta: number) {
  const n = du.length;
  const shift = theta / dt;
  const i0 = Math.floor(shift), frac = shift - i0;
  const delayed = (k: number) => {
    const a = k - i0, b = a - 1;
    const va = a >= 0 ? du[Math.min(a, n - 1)] : 0, vb = b >= 0 ? du[Math.min(b, n - 1)] : 0;
    return (1 - frac) * va + frac * vb;
  };
  const out = new Array<number>(n);
  const a1 = tau1 > 0 ? Math.exp(-dt / tau1) : 0;
  const a2 = tau2 > 0 ? Math.exp(-dt / tau2) : 0;
  let x1 = 0, x2 = 0, xi = 0;
  for (let k = 0; k < n; k++) {
    const v = delayed(k);
    if (type === 'integrating') {
      // Integrator (unit slope per second) followed by one lag.
      out[k] = tau1 > 0 ? x1 : xi;
      xi += dt * v;
      x1 = a1 * x1 + (1 - a1) * xi;
    } else {
      out[k] = type === 'sopdt' ? x2 : x1;
      x1 = a1 * x1 + (1 - a1) * v;
      x2 = a2 * x2 + (1 - a2) * x1;
    }
  }
  return out;
}

/** Nelder–Mead minimisation (small problems, no derivatives). */
export function nelderMead(f: (x: number[]) => number, x0: number[], step: number[], iters = 400) {
  const n = x0.length;
  let simplex = [x0, ...x0.map((_, i) => x0.map((v, j) => (i === j ? v + step[i] : v)))].map((x) => ({ x, f: f(x) }));
  for (let it = 0; it < iters; it++) {
    simplex.sort((a, b) => a.f - b.f);
    const best = simplex[0], worst = simplex[n], second = simplex[n - 1];
    if (Math.abs(worst.f - best.f) <= 1e-12 * (Math.abs(best.f) + 1e-20)) break;
    const centroid = x0.map((_, j) => simplex.slice(0, n).reduce((s, p) => s + p.x[j], 0) / n);
    const along = (k: number) => centroid.map((c, j) => c + k * (worst.x[j] - c));
    const r = along(-1), fr = f(r);
    if (fr < best.f) {
      const e = along(-2), fe = f(e);
      simplex[n] = fe < fr ? { x: e, f: fe } : { x: r, f: fr };
    } else if (fr < second.f) {
      simplex[n] = { x: r, f: fr };
    } else {
      const c = along(fr < worst.f ? -0.5 : 0.5), fc = f(c);
      if (fc < Math.min(fr, worst.f)) simplex[n] = { x: c, f: fc };
      else simplex = simplex.map((p, i) => (i === 0 ? p : { x: p.x.map((v, j) => best.x[j] + 0.5 * (v - best.x[j])), f: 0 })).map((p, i) => (i === 0 ? p : { ...p, f: f(p.x) }));
    }
  }
  simplex.sort((a, b) => a.f - b.f);
  return simplex[0];
}

/**
 * Fit a model to a record of the controller output u and the PV y (any units).
 * The gain is solved exactly for each trial of the time constants and dead
 * time, so the search is only over the dynamics.
 */
export function fitModel(t: number[], u: number[], y: number[], type: ModelType, baseline?: { u0: number; y0: number }): IdentResult | null {
  const rs = resample(t, [u, y]);
  if (!rs) return null;
  const [ur, yr] = rs.series;
  const { dt } = rs;
  const n = ur.length;
  const k0 = Math.max(1, Math.min(10, Math.floor(n / 20)));
  // The record should start at steady state; its first few samples are the operating point.
  const u0 = baseline?.u0 ?? ur.slice(0, k0).reduce((s, v) => s + v, 0) / k0;
  const y0 = baseline?.y0 ?? yr.slice(0, k0).reduce((s, v) => s + v, 0) / k0;
  const du = ur.map((v) => v - u0), dy = yr.map((v) => v - y0);
  if (du.every((v) => Math.abs(v) < 1e-9)) return null;
  const T = rs.t[n - 1];

  const decode = (p: number[]) => ({
    tau1: type === 'integrating' && p[0] < Math.log(dt * 0.05) ? 0 : Math.exp(p[0]),
    tau2: type === 'sopdt' ? Math.exp(p[1]) : 0,
    theta: Math.min(Math.abs(p[type === 'sopdt' ? 2 : 1]), T * 0.8),
  });
  const evaluate = (p: number[]) => {
    const { tau1, tau2, theta } = decode(p);
    const h = simulate(du, dt, type, tau1, tau2, theta);
    const hh = h.reduce((s, v) => s + v * v, 0);
    const gain = hh > 0 ? h.reduce((s, v, i) => s + v * dy[i], 0) / hh : 0;
    const sse = dy.reduce((s, v, i) => s + (v - gain * h[i]) ** 2, 0);
    return { sse, gain, h };
  };
  let best: { x: number[]; f: number } | null = null;
  for (const tf of [0.03, 0.1, 0.3]) {
    for (const df of [0.01, 0.05, 0.15]) {
      const x0 = type === 'sopdt' ? [Math.log(tf * T), Math.log(tf * T * 0.3), df * T] : [Math.log(tf * T), df * T];
      const step = type === 'sopdt' ? [1, 1, 0.05 * T] : [1, 0.05 * T];
      const r = nelderMead((p) => evaluate(p).sse, x0, step, 300);
      if (!best || r.f < best.f) best = r;
    }
  }
  const { tau1, tau2, theta } = decode(best!.x);
  const { gain, h } = evaluate(best!.x);
  const yhat = h.map((v) => y0 + gain * v);
  const mean = dy.reduce((s, v) => s + v, 0) / n;
  const resid = dy.map((v, i) => v - gain * h[i]);
  const err = Math.sqrt(resid.reduce((s, v) => s + v * v, 0));
  const spread = Math.sqrt(dy.reduce((s, v) => s + (v - mean) ** 2, 0));
  const noise = Math.sqrt(resid.reduce((s, v) => s + v * v, 0) / n);
  return {
    type,
    K: type === 'integrating' ? NaN : gain,
    kPrime: type === 'integrating' ? gain : NaN,
    tau1, tau2, theta,
    fit: spread > 0 ? 100 * (1 - err / spread) : 0,
    t: rs.t, u: ur, y: yr, yhat, u0, y0, noise, dt,
  };
}
