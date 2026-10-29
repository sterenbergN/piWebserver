import { instrumentParams, type ProcessDef } from '../model';

// In-line blending: a "wild" diluent stream A (set by the upstream unit, measured
// by FT-801) meets a concentrate stream B (controlled by FV-802, measured by
// FT-802) in a small mixing vessel. An analyzer downstream reads the product.
//   V·dc/dt = F_B·c_B − (F_A + F_B)·c          (well mixed, c in %)
// The product's response to F_B, F_A·(c_B − c)/(F_A + F_B)², shrinks as the
// throughput grows, and so does the mixing time V/(F_A + F_B). The ratio
// F_B/F_A alone fixes c at steady state, whatever the throughput.

export const BLEND: ProcessDef = {
  id: 'blend',
  name: 'In-line blending (ratio)',
  icon: '🧴',
  summary: 'A concentrate dosed into a diluent stream that the plant upstream sets. Production changes the diluent flow all the time; the concentration should not care. The textbook case for ratio control.',
  family: 'escalation',
  pv: { label: 'Concentration', symbol: 'c', unit: '%', lo: 0, hi: 20, decimals: 2 },
  secondary: {
    label: 'Concentrate flow', symbol: 'F_B', unit: 'm³/h', lo: 0, hi: 25, decimals: 2, tag: 'FT-802', loopTag: 'FIC-802', upset: 'Pb',
    of: (_x, flow, d, p) => p.FBmax * flow * (d.Pb / 100),
  },
  tags: { loop: 'AIC-803', transmitter: 'AT-803', valve: 'FV-802' },
  ratio: { from: 'FA', lo: 0, hi: 0.5, nominal: 0.25 },
  states: [{ key: 'c', label: 'Concentration in the mixer', unit: '%' }],
  params: [
    { key: 'V', label: 'Mixing volume', symbol: 'V', unit: 'm³', default: 0.5, min: 0.02, max: 10, step: 0.01, group: 'process',
      note: 'The static mixer and the pipe up to the analyzer take-off: the hold-up that smooths the blend.' },
    { key: 'FBmax', label: 'Concentrate valve capacity', symbol: 'F_B,max', unit: 'm³/h', default: 25, min: 1, max: 200, step: 0.5, group: 'process',
      note: 'Concentrate flow with FV-802 fully open, at normal supply pressure.' },
    ...instrumentParams({ valveTau: 1.5, valveRate: 20, valveChar: 0, txTau: 5, txNoise: 0.3, txDelay: 20, Ts: 0.5, tx2Tau: 0.5 }),
  ],
  disturbances: [
    { key: 'FA', label: 'Diluent (wild) flow', unit: 'm³/h', nominal: 40, min: 10, max: 70, note: 'Set by the unit upstream: production rate.', measured: 'FT-801' },
    { key: 'cB', label: 'Concentrate strength', unit: '%', nominal: 50, min: 35, max: 65, note: 'Varies from one delivery to the next.' },
    { key: 'Pb', label: 'Concentrate supply pressure', unit: '% of normal', nominal: 100, min: 70, max: 115, note: 'Pump and header pressure ahead of FV-802.' },
  ],
  derivatives: ([c], flow, d, p) => {
    const FB = p.FBmax * flow * (d.Pb / 100);
    return [(FB * d.cB - (d.FA + FB) * c) / (3600 * p.V)];
  },
  pvOf: ([c]) => c,
  steady: (flow, d, p) => {
    const FB = p.FBmax * flow * (d.Pb / 100);
    const F = d.FA + FB;
    return F > 0 ? [(FB * d.cB) / F] : null;
  },
  opPoints: [8, 10, 12],
  nominalPv: 10,
  uncertain: [
    { key: 'txDelay', spread: 0.2 },
    { key: 'V', spread: 0.2 },
    { key: 'FBmax', spread: 0.1 },
  ],
  scenarios: [
    {
      id: 'throughput', name: 'Production rate changes', duration: 1200, initialSp: 10,
      purpose: 'Upstream goes to 150 % rate, then down to 60 %, then back. At a fixed concentrate flow the product goes 3 % off spec at once.',
      events: [{ t: 10, kind: 'dist', key: 'FA', value: 60 }, { t: 410, kind: 'dist', key: 'FA', value: 25 }, { t: 810, kind: 'dist', key: 'FA', value: 40 }],
    },
    {
      id: 'strength', name: 'New concentrate delivery', duration: 800, initialSp: 10,
      purpose: 'The next tank of concentrate is 10 % weaker, then 10 % stronger. Nothing measures it but the analyzer.',
      events: [{ t: 10, kind: 'dist', key: 'cB', value: 45 }, { t: 410, kind: 'dist', key: 'cB', value: 55 }],
    },
    {
      id: 'low-rate', name: 'Grade changes at low rate', duration: 900, initialSp: 10, initialDist: { FA: 15 },
      purpose: 'The plant runs at 40 % rate. Concentration steps up and down: does the loop still respond like it does at full rate?',
      events: [{ t: 10, kind: 'sp', value: 12 }, { t: 450, kind: 'sp', value: 9 }],
    },
    {
      id: 'high-rate', name: 'Grade changes at high rate', duration: 900, initialSp: 10, initialDist: { FA: 65 },
      purpose: 'The plant runs at 160 % rate: the same concentration steps.',
      events: [{ t: 10, kind: 'sp', value: 12 }, { t: 450, kind: 'sp', value: 9 }],
    },
    {
      id: 'mismatch', name: 'Longer sample line (model mismatch)', duration: 1200, initialSp: 10,
      purpose: 'The analyzer was moved: 50 % more sample-line delay, and the concentrate pump has worn (15 % less capacity).',
      events: [
        { t: 0, kind: 'param', key: 'txDelay', factor: 1.5 }, { t: 0, kind: 'param', key: 'FBmax', factor: 0.85 },
        { t: 10, kind: 'dist', key: 'FA', value: 55 }, { t: 410, kind: 'dist', key: 'cB', value: 45 }, { t: 810, kind: 'dist', key: 'FA', value: 30 },
      ],
    },
  ],
  characterizations: [],
};
