import { instrumentParams, type ProcessDef } from '../model';

// A plant described only by an identified model: first or second order plus
// dead time, or an integrator plus dead time, in % of span per % of output.
// Filled in from a trend (the Identify tab) to try strategies on a real loop.
// The dead time is the transmitter's transport delay; the valve and
// transmitter lags are kept tiny because the identified model already has them.
// Test scripts are written in units of the model's own time scale
// (τ1 + τ2 + θ), so they fit a 5-second loop and a 2-hour one alike.

export const CUSTOM: ProcessDef = {
  id: 'custom',
  name: 'Your plant (identified)',
  icon: '📥',
  summary: 'A model identified from a trend: first or second order plus dead time, or an integrator. No physics, just the input–output behaviour of a real loop, to try strategies on before commissioning.',
  family: 'escalation',
  pv: { label: 'Process value', symbol: 'y', unit: '%', lo: 0, hi: 100, decimals: 2 },
  tags: { loop: 'XIC-100', transmitter: 'XT-100', valve: 'XV-100' },
  states: [{ key: 'x1', label: 'First lag', unit: '%' }, { key: 'x2', label: 'Second lag', unit: '%' }],
  params: [
    { key: 'integrating', label: 'Model type', unit: '', default: 0, min: 0, max: 1, group: 'process',
      options: [{ value: 0, label: 'Self-regulating' }, { value: 1, label: 'Integrating' }] },
    { key: 'K', label: 'Process gain', symbol: 'K', unit: '%/%', default: 1, min: -50, max: 50, step: 0.01, group: 'process',
      note: 'Change in PV (% of span) per % of output at steady state. Integrating: K/τ1 is the ramp rate per % of output.' },
    { key: 'tau1', label: 'Time constant', symbol: 'τ_1', unit: 's', default: 20, min: 0.1, max: 1e5, step: 0.1, group: 'process' },
    { key: 'tau2', label: 'Second time constant', symbol: 'τ_2', unit: 's', default: 0, min: 0, max: 1e5, step: 0.1, group: 'process',
      note: '0 for a first-order model.' },
    { key: 'bias', label: 'PV at 0 % output', unit: '%', default: 0, min: -1000, max: 1000, step: 0.1, group: 'process',
      note: 'Self-regulating models: steady PV = bias + K × output.' },
    { key: 'u0', label: 'Balance output', unit: '%', default: 50, min: 0, max: 100, step: 0.1, group: 'process',
      note: 'Integrating models: the output that holds the PV still.' },
    ...instrumentParams({ valveTau: 0.1, valveRate: 1000, valveChar: 0, txTau: 0.1, txNoise: 0.3, txDelay: 5, Ts: 0.5 }),
  ],
  disturbances: [
    { key: 'load', label: 'Load (at the output)', unit: '% of output', nominal: 0, min: -70, max: 70, note: 'An unmeasured upset, expressed as the output change that would cancel it.' },
  ],
  derivatives: ([x1, x2], flow, d, p) => {
    const u = 100 * flow + d.load;
    const dx1 = p.integrating ? (p.K / p.tau1) * (u - p.u0) : (p.bias + p.K * u - x1) / p.tau1;
    return [dx1, p.tau2 > 0 ? (x1 - x2) / p.tau2 : 0];
  },
  pvOf: ([x1, x2], _f, _d, p) => (p.tau2 > 0 ? x2 : x1),
  steady: (flow, d, p) => {
    if (p.integrating) return null;
    const y = p.bias + p.K * (100 * flow + d.load);
    return [y, y];
  },
  steadyAt: (pv, d, p) => {
    const u = p.integrating ? p.u0 : p.K !== 0 ? (pv - p.bias) / p.K : 50;
    const valve = Math.min(100, Math.max(0, u - d.load));
    return { valve, x: [pv, pv] };
  },
  timeScale: (p) => Math.max(0.5, p.tau1 + p.tau2 + p.txDelay),
  fastest: (p) => Math.min(p.tau1, p.tau2 > 0 ? p.tau2 : Infinity),
  opPoints: [30, 50, 70],
  nominalPv: 50,
  uncertain: [
    { key: 'K', spread: 0.3 },
    { key: 'tau1', spread: 0.3 },
    { key: 'txDelay', spread: 0.3 },
  ],
  scenarios: [
    {
      id: 'sp-steps', name: 'Setpoint steps', duration: 40, initialSp: 50,
      purpose: 'Setpoint steps around the identified operating point (times in units of τ1 + τ2 + θ).',
      events: [{ t: 1, kind: 'sp', value: 60 }, { t: 11, kind: 'sp', value: 40 }, { t: 21, kind: 'sp', value: 55 }, { t: 31, kind: 'sp', value: 50 }],
    },
    {
      id: 'load', name: 'Load upsets', duration: 30, initialSp: 50,
      purpose: 'An unmeasured upset worth 10 % of output, one way and then the other.',
      events: [{ t: 1, kind: 'dist', key: 'load', value: 10 }, { t: 11, kind: 'dist', key: 'load', value: -10 }, { t: 21, kind: 'dist', key: 'load', value: 0 }],
    },
    {
      id: 'noisy', name: 'Noisy measurement', duration: 20, initialSp: 50,
      purpose: '1.5 % noise on the reading: how much of it reaches the valve?',
      events: [{ t: 0, kind: 'param', key: 'txNoise', value: 1.5 }, { t: 1, kind: 'sp', value: 55 }],
    },
    {
      id: 'mismatch', name: 'Model wrong by 40 %', duration: 22, initialSp: 50,
      purpose: 'The real gain is 40 % higher and the dead time 50 % longer than identified: how much margin did the tuning leave?',
      events: [
        { t: 0, kind: 'param', key: 'K', factor: 1.4 }, { t: 0, kind: 'param', key: 'txDelay', factor: 1.5 },
        { t: 1, kind: 'sp', value: 60 }, { t: 11, kind: 'sp', value: 45 },
      ],
    },
    {
      id: 'saturation', name: 'Upset beyond the valve', duration: 22, initialSp: 50,
      purpose: 'A load bigger than the valve can cancel, then gone again: integral windup.',
      events: [{ t: 1, kind: 'dist', key: 'load', value: -60 }, { t: 11, kind: 'dist', key: 'load', value: 0 }],
    },
  ],
  characterizations: [],
};
