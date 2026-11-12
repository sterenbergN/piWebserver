import type { IdentResult } from './ident';
import { defaultParams } from './model';
import { getProcess } from './processes';
import { CURVE_POINTS, curveSlopes, type CurvePoint } from './processes/custom';
import { getRule } from './tuning';

// A model identified from a trend, as the bench's identified plant (in % of the transmitter
// span) and the SIMC PI for it.

/**
 * A fit as the bench's identified plant, in % of the transmitter span, and the SIMC PI for it.
 * (One linear model: the plant as it is around where the trend was taken.)
 */
export function identifiedSetup(fit: IdentResult, span: number, lo: number) {
  const proc = getProcess('custom');
  const pct = (v: number) => (v / span) * 100;
  const Kpct = pct(fit.type === 'integrating' ? fit.kPrime : fit.K);
  const integ = fit.type === 'integrating';
  // Integrating: the custom plant ramps at K/τ1, so fix τ1 and put the slope in K.
  const tau1 = integ ? 100 : Math.max(fit.tau1, 0.1);
  const K = integ ? Kpct * tau1 : Kpct;
  const y0 = ((fit.y0 - lo) / span) * 100;
  const params = {
    ...defaultParams(proc),
    integrating: integ ? 1 : 0,
    K: Number(K.toPrecision(4)),
    tau1: Number(tau1.toPrecision(4)),
    tau2: integ ? Number(fit.tau1.toPrecision(4)) : Number(fit.tau2.toPrecision(4)),
    txDelay: Number(fit.theta.toPrecision(3)),
    bias: Number((y0 - K * fit.u0).toPrecision(4)),
    u0: Number(fit.u0.toPrecision(4)),
    txNoise: Number(Math.min(5, pct(fit.noise)).toPrecision(2)),
    Ts: Math.min(10, Math.max(0.05, Number(fit.dt.toPrecision(2)))),
  };
  // SIMC PI on the identified model, τc = 2θ.
  const lagged = integ ? fit.tau1 : fit.tau2 / 2;
  const m = { K: Math.abs(integ ? Kpct * 1e4 : Kpct), tau: integ ? 1e4 : fit.tau1 + fit.tau2 / 2, theta: fit.theta + lagged + params.Ts / 2, tau1: fit.tau1, tau2: fit.tau2, theta2: fit.theta, kPrime: Kpct, integrating: integ };
  const pi = getRule('simc').tune(m, 'PI', 2 * m.theta);
  return { params, pi, invert: Kpct < 0, at: y0 };
}

export type KeptFit = { r: IdentResult; span: number; lo: number };

/**
 * Several fits as one plant: the bench's identified plant with a steady curve through each fit's
 * operating point, its gain the fit's there, and the time constant moving between the fits'.
 * The dead time and second lag are the middle fit's (by PV), and so are K and τ1, which scale
 * the curve. Null, with the reason, when the fits can't make one curve.
 */
export function identifiedCurve(fits: KeptFit[]): { params: Record<string, number>; mid: number; notes: string[] } | { reason: string } {
  if (fits.length < 2) return { reason: 'It takes fits at two or more operating points.' };
  if (fits.some((f) => f.r.type === 'integrating')) return { reason: 'An integrating fit has no steady curve to follow: the bench uses the middle fit alone.' };
  const set = fits.slice(0, CURVE_POINTS).map((f) => ({ f, s: identifiedSetup(f.r, f.span, f.lo) }));
  const pts: CurvePoint[] = set.map(({ f, s }) => ({ u: f.r.u0, y: s.at, k: s.params.K, tau: s.params.tau1 }));
  if (pts.some((q) => q.k === 0) || pts.some((q) => Math.sign(q.k) !== Math.sign(pts[0].k))) return { reason: 'The gain changes sign between these fits: no one curve fits them.' };
  const byU = [...pts].sort((a, b) => a.u - b.u);
  for (let i = 1; i < byU.length; i++) {
    if (byU[i].u - byU[i - 1].u < 0.5) return { reason: 'Two fits were taken at the same output: keep fits from different operating points.' };
    if (Math.sign(byU[i].y - byU[i - 1].y) !== Math.sign(pts[0].k)) {
      return { reason: 'The operating points don’t line up with the gains: a higher output gave a PV the gains say it shouldn’t (a disturbance moved the plant between the tests, or the range differs between fits).' };
    }
  }
  const order = set.map((_, i) => i).sort((a, b) => set[a].s.at - set[b].s.at);
  const mid = order[Math.floor((order.length - 1) / 2)];
  const params: Record<string, number> = { ...set[mid].s.params, curveN: set.length, curveMid: mid + 1 };
  pts.forEach((q, i) => Object.assign(params, { [`cU${i + 1}`]: q.u, [`cY${i + 1}`]: q.y, [`cK${i + 1}`]: q.k, [`cT${i + 1}`]: q.tau }));
  const notes: string[] = [];
  if (curveSlopes(byU).limited) notes.push('Some fits’ gains disagree with the step between their operating points, so the curve eases them where it would otherwise turn back.');
  if (fits.length > CURVE_POINTS) notes.push(`The curve uses the first ${CURVE_POINTS} fits.`);
  const thetas = set.map((x) => x.s.params.txDelay);
  if (Math.max(...thetas) > 1.3 * Math.min(...thetas)) notes.push(`The dead time is the middle fit’s (${set[mid].s.params.txDelay} s) everywhere; the fits’ range from ${Math.min(...thetas)} to ${Math.max(...thetas)} s.`);
  return { params, mid, notes };
}
