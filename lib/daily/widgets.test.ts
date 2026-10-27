import test from 'node:test';
import { strict as assert } from 'node:assert';
import { bode2At, bode2Metrics, niceStep, step1Metrics, step1Response, step2Metrics, step2Response, widgetParams, widgetSliders } from './widgets';

const near = (actual: number, expected: number, tol = 1e-3) =>
  assert.ok(Math.abs(actual - expected) <= tol * Math.max(1, Math.abs(expected)), `${actual} ≉ ${expected}`);

test('step2Metrics: the textbook numbers for ζ = 0.4, ωn = 5', () => {
  const m = step2Metrics(0.4, 5);
  near(m.overshoot, 0.2538);
  near(m.peakTime!, 0.6855);
  near(m.rise0100!, 0.4326);
  near(m.wd!, 4.583);
  assert.equal(m.settlingApprox, 2);
  assert.deepEqual(m.poles.re, [-2, -2]);
  // The exact 2 % settling time is a little under the 4/(ζωn) estimate, and the response really is in the band after it.
  assert.ok(m.settling > 1.4 && m.settling < 2, String(m.settling));
  const y = step2Response(0.4, 5);
  near(y(m.peakTime!), 1.2538);
  for (let t = m.settling + 0.01; t < 6; t += 0.01) assert.ok(Math.abs(y(t) - 1) <= 0.02 + 1e-9);
  assert.ok(Math.abs(y(m.settling - 1e-3) - 1) > 0.02, 'just before ts it is still outside the band');
  assert.ok(m.rise1090 > 0 && m.rise1090 < m.rise0100!);
});

test('step2Metrics: critically damped and overdamped loops never overshoot', () => {
  const crit = step2Metrics(1, 2);
  assert.equal(crit.overshoot, 0);
  assert.equal(crit.peakTime, null);
  assert.deepEqual(crit.poles.re, [-2, -2]);
  near(crit.settling, 5.834 / 2); // (1 + ωn t) e^(−ωn t) = 0.02
  const over = step2Metrics(2, 1);
  near(over.poles.re[0], -(2 - Math.sqrt(3)));
  near(over.poles.re[1], -(2 + Math.sqrt(3)));
  assert.ok(over.settling > crit.settling * 2);
});

test('step1: 63 % at θ + τ, exact settling θ + τ ln 50', () => {
  const y = step1Response(10, 2, 3);
  assert.equal(y(2.9), 0);
  near(y(13), 2 * (1 - Math.exp(-1)));
  const m = step1Metrics(10, 3);
  assert.equal(m.t63, 13);
  near(m.rise1090, 21.97);
  near(m.settling, 42.12);
  assert.equal(m.settlingRule, 43);
  assert.equal(m.ratio, 0.3);
});

test('bode2: resonant peak, bandwidth and −90° at ωn', () => {
  const m = bode2Metrics(0.4, 5, 1);
  near(m.peakDb!, -20 * Math.log10(2 * 0.4 * Math.sqrt(1 - 0.16)));
  near(m.wr!, 5 * Math.sqrt(1 - 0.32));
  near(bode2At(0.4, 5, 1, m.bandwidth).db, -3.0103);
  near(bode2At(0.4, 5, 1, 5).phase, -90);
  near(bode2At(0.4, 5, 1, m.wr!).db, m.peakDb!);
  assert.equal(bode2Metrics(0.8, 5).peakDb, null);
  near(bode2Metrics(0.4, 5, 10).dcDb, 20);
});

test('widget sliders: kind defaults around the starting value, or the widget’s own ranges', () => {
  const w = { id: 'w', kind: 'step2' as const, params: { zeta: 0.4, wn: 5 } };
  assert.deepEqual(widgetParams(w), { zeta: 0.4, wn: 5, K: 1 });
  const [zeta, wn] = widgetSliders(w);
  assert.deepEqual([zeta.key, zeta.min, zeta.max, zeta.step], ['zeta', 0.05, 2, 0.01]);
  assert.deepEqual([wn.key, wn.min, wn.max, wn.step], ['wn', 1.2, 20, 0.1]);
  const custom = widgetSliders({ ...w, ranges: { zeta: [0.1, 1] } });
  assert.deepEqual([custom[0].min, custom[0].max, custom[0].step], [0.1, 1, 0.005]);
  const fopdt = widgetSliders({ id: 'f', kind: 'step1', params: { tau: 8 } });
  assert.deepEqual(fopdt.map((x) => [x.key, x.min, x.max]), [['tau', 1.6, 40], ['theta', 0, 16]]);
  assert.equal(niceStep(18.75), 0.1);
});
