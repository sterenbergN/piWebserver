// Why does a loop cycle? From the trend alone (PV and controller output over a stretch with a
// steady setpoint), the way a control engineer would look at it:
//   - Is it cycling at all? The autocorrelation of the PV: a regular cycle keeps crossing zero at
//     even intervals, noise doesn't (Thornhill's regularity, r = mean / (3 σ) of the intervals).
//   - The shapes. A sticky valve on a self-regulating loop gives a squarish PV (the stem jumps,
//     the flow jumps with it) and a triangular output (the integral ramps until the stem breaks
//     free). A tuning cycle or an outside one gives two sine-like waves.
//   - How the output and PV line up (Horch): the cross-correlation is odd for stiction (the PV a
//     quarter-cycle off the output), even for a linear cycle (in step or opposite).
// Neither test is proof, and both are known to mislead on integrating loops (a level's PV is the
// integral of a square flow, so it's triangular itself). So the verdict says how sure it is, and
// what to try on the plant: halve the controller gain. A tuning cycle dies away, a stiction cycle
// slows down at about the same size, and an outside cycle keeps its period.

export type OscillationVerdict = 'none' | 'stuck' | 'stiction' | 'linear' | 'unclear';

export type Oscillation = {
  verdict: OscillationVerdict;
  /** How many of the stiction signs are there: 0, 1 or 2 (shape, phase). */
  stictionSigns: number;
  /** Period of the cycle, s (NaN when not cycling). */
  period: number;
  /** Regularity: above 1 is a regular cycle. */
  regularity: number;
  /** Peak-to-peak size of the cycle, in the PV's and the output's units. */
  pvSwing: number;
  opSwing: number;
  /** Squareness of each wave: about 0.64 for a sine, 1 for a square wave, 0.5 for a triangle. */
  pvShape: number;
  opShape: number;
  /** How far the output and PV are from in step or opposite, as a fraction of a quarter-cycle (0 even, 1 odd). */
  phase: number;
  /** The noise on the PV (standard deviation), for scale. */
  noise: number;
  /** The reasons, in words. */
  evidence: string[];
  /** What to try on the plant to be sure. */
  next: string;
};

const mean = (a: ArrayLike<number>) => {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i];
  return s / a.length;
};

/**
 * How far the straight-line trend through a series moves from its start to its end, and how
 * much of the series' variation that line explains (R², 1 for a steady ramp).
 */
function drift(a: ArrayLike<number>) {
  const n = a.length, mx = (n - 1) / 2, my = mean(a);
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) { sxy += (i - mx) * (a[i] - my); sxx += (i - mx) ** 2; syy += (a[i] - my) ** 2; }
  return { total: sxx > 0 ? (sxy / sxx) * (n - 1) : 0, r2: sxx > 0 && syy > 0 ? (sxy * sxy) / (sxx * syy) : 0 };
}

/** Mean and straight-line trend removed. */
function detrend(a: ArrayLike<number>) {
  const n = a.length, mx = (n - 1) / 2, my = mean(a);
  let sxy = 0, sxx = 0;
  for (let i = 0; i < n; i++) { sxy += (i - mx) * (a[i] - my); sxx += (i - mx) ** 2; }
  const b = sxx > 0 ? sxy / sxx : 0;
  return Array.from({ length: n }, (_, i) => a[i] - my - b * (i - mx));
}

/** Centred moving average over `w` samples. */
function smooth(a: number[], w: number) {
  if (w <= 1) return a.slice();
  const h = Math.floor(w / 2), out = new Array(a.length);
  let s = 0, lo = 0, hi = -1;
  for (let i = 0; i < a.length; i++) {
    const L = Math.max(0, i - h), R = Math.min(a.length - 1, i + h);
    while (hi < R) s += a[++hi];
    while (lo < L) s -= a[lo++];
    out[i] = s / (R - L + 1);
  }
  return out;
}

/** Normalised cross-correlation of x and y at lags −max…max (x leads at positive lags). */
function xcorr(x: number[], y: number[], max: number) {
  const n = x.length;
  let sx = 0, sy = 0;
  for (let i = 0; i < n; i++) { sx += x[i] * x[i]; sy += y[i] * y[i]; }
  const norm = Math.sqrt(sx * sy) || 1;
  const out: number[] = [];
  for (let k = -max; k <= max; k++) {
    let s = 0;
    for (let i = Math.max(0, -k); i < Math.min(n, n - k); i++) s += x[i] * y[i + k];
    out.push(s / norm);
  }
  return out;
}

/**
 * Zero crossings of a sequence, at fractional indices. With a band, a crossing counts only once
 * the sequence has gone past ±band on the other side (wiggles through zero count once).
 */
function crossings(a: number[], band = 0) {
  const z: number[] = [];
  let side = 0, last = NaN;
  for (let i = 0; i < a.length; i++) {
    if (i > 0 && a[i - 1] !== 0 && Math.sign(a[i]) !== Math.sign(a[i - 1])) last = i - 1 + a[i - 1] / (a[i - 1] - a[i]);
    const now = a[i] > band ? 1 : a[i] < -band ? -1 : 0;
    if (now !== 0 && now !== side) {
      if (side !== 0) z.push(Number.isFinite(last) ? last : i);
      side = now;
    }
  }
  return z;
}

/**
 * How long the wave stays near its peak, half-cycle by half-cycle (so uneven half-cycles don't
 * matter): the share of each half-cycle spent above 80 % of its own (90th-percentile) height.
 * A sine spends 42 % there, a square wave nearly all, a triangle 28 %. The median half-cycle.
 */
function plateau(x: number[]) {
  const sd = Math.sqrt(mean(x.map((v) => v * v)));
  const z = crossings(x, 0.3 * sd);
  const each: number[] = [];
  for (let i = 0; i + 1 < z.length; i++) {
    const a = Math.ceil(z[i]), b = Math.floor(z[i + 1]);
    if (b - a < 6) continue;
    const abs = x.slice(a, b + 1).map(Math.abs);
    const sorted = [...abs].sort((p, q) => p - q);
    const top = sorted[Math.floor(0.9 * (sorted.length - 1))];
    if (top > 0) each.push(abs.filter((v) => v >= 0.8 * top).length / abs.length);
  }
  if (!each.length) return NaN;
  each.sort((p, q) => p - q);
  return each[Math.floor(each.length / 2)];
}

/** A flat-topped PV: more of each half-cycle near its peak than this (a sine: 0.42). */
const SQUARE_PV = 0.5;
/** A ramping output: less of each half-cycle near its peak than this (a sine: 0.42, a triangle 0.28). */
const TRIANGLE_OP = 0.36;
/** Output and PV this far towards a quarter-cycle apart (1 is a quarter-cycle). */
const ODD_PHASE = 0.6;

const fmt = (v: number, d = 2) => (Math.abs(v) >= 100 ? v.toFixed(0) : Number(v.toPrecision(d)).toString());

/**
 * Look at a stretch of trend with a steady setpoint: the PV and the controller output, sampled
 * every `dt` seconds. `integrating` turns the shape test off (a level's own shape misleads it).
 */
export function diagnoseOscillation(pvRaw: ArrayLike<number>, opRaw: ArrayLike<number>, dt: number, opts: { integrating?: boolean; unit?: string } = {}): Oscillation {
  const unit = opts.unit ? ` ${opts.unit}` : '';
  // Long records: averaged down to at most 3000 points (the correlations grow with the square).
  const len = Math.min(pvRaw.length, opRaw.length);
  const k = Math.ceil(len / 3000);
  if (k > 1) {
    const down = (a: ArrayLike<number>) => Array.from({ length: Math.floor(len / k) }, (_, i) => {
      let s = 0;
      for (let j = 0; j < k; j++) s += a[i * k + j];
      return s / k;
    });
    return diagnoseOscillation(down(pvRaw), down(opRaw), dt * k, opts);
  }
  const n = len;
  const blank: Oscillation = {
    verdict: 'none', stictionSigns: 0, period: NaN, regularity: 0, pvSwing: 0, opSwing: 0, pvShape: NaN, opShape: NaN, phase: NaN, noise: 0,
    evidence: [], next: '',
  };
  if (n < 40) return { ...blank, verdict: 'unclear', evidence: ['Too short a stretch to judge: it takes several cycles.'] };
  const pv = detrend(Array.from({ length: n }, (_, i) => pvRaw[i]));
  const op = detrend(Array.from({ length: n }, (_, i) => opRaw[i]));

  // Noise: what's left after a short smoothing.
  const sm3 = smooth(pv, 5);
  const noise = Math.sqrt(mean(pv.map((v, i) => (v - sm3[i]) ** 2)) * 5 / 4);
  const sd = Math.sqrt(mean(pv.map((v) => v * v)));

  // The cycle: zero crossings of the autocorrelation of the PV, smoothed to see through the noise
  // (lightly first, then over a tenth of the cycle found), up to five cycles out.
  const cycle = (w: number) => {
    const maxLag = Math.floor(n / 2);
    const acf = xcorr(smooth(pv, w), smooth(pv, w), maxLag).slice(maxLag);
    const z = crossings(acf, Math.max(0.05, 3 / Math.sqrt(n))).slice(0, 11);
    const periods: number[] = [];
    // The first crossing is a quarter-period in.
    if (z.length >= 2) periods.push(2 * (z[1] - z[0]));
    for (let i = 0; i + 2 < z.length; i++) periods.push(z[i + 2] - z[i]);
    const pm = periods.length ? mean(periods) : NaN;
    const ps = periods.length > 1 ? Math.sqrt(mean(periods.map((p) => (p - pm) ** 2))) : NaN;
    // How strong: the autocorrelation one cycle out.
    const strength = Number.isFinite(pm) && Math.round(pm) < acf.length ? acf[Math.round(pm)] : 0;
    return { pm, regularity: periods.length >= 3 ? pm / (3 * Math.max(ps, 1e-9 * pm)) : 0, strength, count: periods.length };
  };
  let c = cycle(5);
  if (Number.isFinite(c.pm) && c.pm / 10 > 5) c = cycle(Math.round(c.pm / 10));
  const { pm, regularity } = c;
  const period = pm * dt;
  const base = { ...blank, noise, regularity };
  const swing = (a: number[]) => {
    const s = [...a].sort((x, y) => x - y);
    return s[Math.floor(0.98 * (s.length - 1))] - s[Math.floor(0.02 * (s.length - 1))];
  };
  // Shapes and sizes on the signals smoothed over a tenth of a cycle (to see through the noise),
  // over whole cycles only.
  const w = Number.isFinite(pm) ? Math.max(1, Math.round(pm / 10)) : 1;
  const whole = Number.isFinite(pm) ? Math.min(n, Math.max(1, Math.floor(n / pm)) * Math.round(pm)) : n;
  const cut = (a: number[]) => smooth(a, w).slice(n - whole);
  const pvS = cut(pv), opS = cut(op);
  // A cycle no bigger than the noise is the loop ringing on its noise, not a cycle to chase.
  const bigEnough = swing(pvS) > 3 * noise;
  if (!(c.count >= 3 && regularity > 1 && c.strength > 0.15 && pm * 2.5 < n && bigEnough)) {
    // Not cycling, but is the output creeping while the PV sits still? Something holds the PV
    // against the controller: a stuck valve building up to its next slip.
    const opRaw2 = Array.from({ length: n }, (_, i) => opRaw[i]);
    const opSm = smooth(op, 5);
    const opNoise = Math.sqrt(mean(op.map((v, i) => (v - opSm[i]) ** 2)) * 5 / 4);
    const od = drift(opRaw2), opDrift = od.total, pvDrift = drift(Array.from({ length: n }, (_, i) => pvRaw[i])).total;
    if (Math.abs(opDrift) > Math.max(0.5, 8 * opNoise) && od.r2 > 0.9 && sd < 2 * noise && Math.abs(pvDrift) < Math.max(3 * noise, 0.1 * Math.abs(opDrift))) {
      return {
        ...base,
        verdict: 'stuck',
        evidence: [
          `The PV sits still (it moves ${fmt(Math.abs(pvDrift))}${unit} over this stretch) while the output creeps ${fmt(Math.abs(opDrift))} % ${opDrift > 0 ? 'up' : 'down'}, steadily: the controller is pushing and nothing answers.`,
          'That is a valve stuck where it stopped, building up to its next slip (or a valve at a limit, or a hand valve shut downstream).',
        ],
        next: 'Watch the next slip: if the PV jumps when the output has moved far enough and then the creep starts again the other way, it’s stiction. A step test in manual (0.5 %, then 1 %, then 2 %) shows how far the output has to move.',
      };
    }
    return {
      ...base,
      verdict: 'none',
      evidence: [
        (sd <= 2 * noise && !(c.strength > 0.15)) || (c.count >= 3 && !bigEnough)
          ? `The PV wanders no more than its noise (${fmt(c.count >= 3 && !bigEnough ? swing(pvS) : sd)} against ${fmt(noise)}${unit}).`
          : c.count < 3 || pm * 2.5 >= n
            ? 'No repeating cycle in this stretch (or too few cycles in it to tell).'
            : `Any cycle here is weak or irregular (regularity ${fmt(regularity)}, strength ${fmt(c.strength)}).`,
      ],
      next: 'Nothing to chase: the loop isn’t cycling.',
    };
  }

  const pvShape = plateau(pvS), opShape = plateau(opS);

  // Phase: where the output–PV cross-correlation crosses zero either side of zero lag.
  const span = Math.round(pm);
  const cc = xcorr(op, pv, span);
  const left = crossings(cc.slice(0, span + 1).reverse()).map((v) => -v)[0];
  const right = crossings(cc.slice(span))[0];
  const phase = left !== undefined && right !== undefined && right - left > 0 ? Math.abs(right + left) / (right - left) : NaN;

  const evidence: string[] = [`A regular cycle: every ${fmt(period, 3)} s (regularity ${fmt(regularity)}), ${fmt(swing(pvS))}${unit} peak to peak on the PV and ${fmt(swing(opS))} % on the output.`];
  const squarePv = pvShape > SQUARE_PV, triOp = opShape < TRIANGLE_OP;
  const shapeSign = !opts.integrating && squarePv && triOp;
  const oddSign = phase > ODD_PHASE;
  const pc = (v: number) => `${Math.round(v * 100)} %`;
  const shapes = `the PV spends ${pc(pvShape)} of each half-cycle near its peak and the output ${pc(opShape)} (a sine spends 42 %, a square wave nearly all, a triangle 28 %)`;
  if (opts.integrating) evidence.push('An integrating process: its PV is the integral of the flow, so its shape says little. Only the phase is used.');
  else if (shapeSign) evidence.push(`A flat-topped PV and a ramping output: ${shapes}. The output ramps while the PV sits still, then the PV jumps: a valve that sticks and slips.`);
  else evidence.push(`${squarePv || triOp ? 'Only half the stick-slip pattern' : 'Not the stick-slip pattern'}: ${shapes}.${!squarePv && pvShape > 0.45 && noise > 0.25 * swing(pvS) ? ' Noise this size can round off a flat-topped PV.' : ''}`);
  if (Number.isFinite(phase)) {
    evidence.push(oddSign
      ? `The output and PV are about a quarter-cycle apart (${fmt(phase * 90, 2)}° from in step): the output keeps moving while the PV doesn't answer, which is what sticking looks like.`
      : `The output and PV move ${fmt(phase * 90, 2)}° from in step or opposite: one follows the other, as in a linear cycle.`);
  }
  const signs = Number(shapeSign) + Number(oddSign);
  if (!opts.integrating && oddSign && !shapeSign && !squarePv && !triOp) evidence.push('A quarter-cycle apart with sine-like waves is also what too much integral action gives (a short integral time): check that before the valve.');
  const verdict: OscillationVerdict = signs === 2 || (opts.integrating && oddSign) ? 'stiction' : signs === 0 ? 'linear' : 'unclear';
  if (opts.integrating && verdict === 'stiction') evidence.push('On an integrating loop a long integral time gives the same quarter-cycle: treat this as a lead, not a finding.');
  const next = verdict === 'stiction'
    ? 'To be sure: put the loop in manual and step the output by 0.5 %, then 1 %, then 2 %, each way. A sticky valve doesn’t move the PV until the steps add up to its stiction, then jumps. The fix is the valve (packing, positioner), not the tuning.'
    : verdict === 'linear'
      ? 'To tell tuning from an outside cycle: halve the controller gain. A tuning cycle dies away; one that keeps its period at about the same size comes from outside the loop (another loop, a pump, a compressor), so find where it starts.'
      : 'Half the signs point to a sticky valve. Halve the controller gain: a tuning cycle dies away, a stiction cycle slows down and stays about as big, an outside cycle keeps its period.';
  return { verdict, stictionSigns: signs, period, regularity, pvSwing: swing(pvS), opSwing: swing(opS), pvShape, opShape, phase, noise, evidence, next };
}

/** The longest stretch of a trace with one setpoint, less its first fifth (the response to the change). */
export function steadyStretch(sp: ArrayLike<number>) {
  let best = { from: 0, to: 0 };
  let start = 0;
  for (let i = 1; i <= sp.length; i++) {
    if (i === sp.length || Math.abs(sp[i] - sp[i - 1]) > 1e-9) {
      if (i - start > best.to - best.from) best = { from: start, to: i };
      start = i;
    }
  }
  return { from: best.from + Math.floor((best.to - best.from) / 5), to: best.to };
}
