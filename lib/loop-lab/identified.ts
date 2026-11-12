import type { IdentResult } from './ident';
import { defaultParams } from './model';
import { getProcess } from './processes';
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
