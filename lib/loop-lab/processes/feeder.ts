import { instrumentParams, type ProcessDef } from '../model';

// A screw feeder drops bulk solids onto a conveyor; a weigh belt measures the
// feed rate about 30 s downstream. The screw (a VFD on the motor) answers in
// a few seconds, so almost all of the response time is transport delay:
//   τ_s·dF/dt = F_max·f·ρ_rel − F,   measured F(t − θ_belt) through a filter.
// Feedback can only be as fast as the belt; a Smith predictor tries to do
// better by predicting the delayed reading.

export const FEEDER: ProcessDef = {
  id: 'feeder',
  name: 'Belt feeder (dead time)',
  icon: '⚖️',
  summary: 'A screw feeder drops material onto a conveyor, and a weigh belt measures the rate 30 s later. The dead time dwarfs everything else: plain feedback can only be slow, unless the controller predicts what the scale is about to see.',
  family: 'escalation',
  pv: { label: 'Feed rate', symbol: 'F', unit: 't/h', lo: 0, hi: 20, decimals: 2 },
  tags: { loop: 'WIC-701', transmitter: 'WT-701', valve: 'SC-701' },
  states: [{ key: 'F', label: 'Rate leaving the screw', unit: 't/h' }],
  params: [
    { key: 'Fmax', label: 'Screw capacity', symbol: 'F_max', unit: 't/h', default: 16, min: 1, max: 200, step: 0.5, group: 'process',
      note: 'Feed rate at full speed with the material at its normal bulk density.' },
    { key: 'tauScrew', label: 'Screw response', symbol: 'τ_s', unit: 's', default: 4, min: 0.2, max: 60, step: 0.1, group: 'process',
      note: 'How quickly the discharge follows a speed change: hopper flow and screw fill.' },
    ...instrumentParams({ valveTau: 1, valveRate: 20, valveChar: 0, txTau: 3, txNoise: 1, txDelay: 30, Ts: 0.5 }),
  ],
  disturbances: [
    { key: 'density', label: 'Bulk density', unit: '% of normal', nominal: 100, min: 70, max: 120, note: 'How much each turn of the screw carries: moisture, particle size, how full the hopper is.' },
  ],
  derivatives: ([F], flow, d, p) => [(p.Fmax * flow * (d.density / 100) - F) / p.tauScrew],
  pvOf: ([F]) => Math.max(0, F),
  steady: (flow, d, p) => [p.Fmax * flow * (d.density / 100)],
  fastest: (p) => p.tauScrew,
  opPoints: [6, 10, 14],
  nominalPv: 10,
  uncertain: [
    { key: 'txDelay', spread: 0.15 },
    { key: 'Fmax', spread: 0.15 },
    { key: 'tauScrew', spread: 0.3 },
  ],
  scenarios: [
    {
      id: 'sp-steps', name: 'Rate changes', duration: 610, initialSp: 10,
      purpose: 'Production asks for more, then less, then in between. With 30 s of belt in the way, how quickly can the rate settle?',
      events: [{ t: 10, kind: 'sp', value: 12 }, { t: 210, kind: 'sp', value: 8 }, { t: 410, kind: 'sp', value: 11 }],
    },
    {
      id: 'density', name: 'Material changes', duration: 600, initialSp: 10,
      purpose: 'A wetter batch fills the screw less, then a denser one more. Nothing can see it until it reaches the scale.',
      events: [{ t: 10, kind: 'dist', key: 'density', value: 85 }, { t: 310, kind: 'dist', key: 'density', value: 110 }],
    },
    {
      id: 'noisy', name: 'Bouncing belt', duration: 300, initialSp: 10,
      purpose: 'Lumps and belt vibration make the weigh signal noisy (3 % of span).',
      events: [{ t: 0, kind: 'param', key: 'txNoise', value: 3 }, { t: 10, kind: 'sp', value: 12 }],
    },
    {
      id: 'mismatch', name: 'Belt slowed down (model mismatch)', duration: 600, initialSp: 10,
      purpose: 'Someone slowed the belt: the dead time is now 25 % longer, and the screw has worn (15 % less capacity). Anything that relies on knowing the dead time is now wrong.',
      events: [
        { t: 0, kind: 'param', key: 'txDelay', factor: 1.25 }, { t: 0, kind: 'param', key: 'Fmax', factor: 0.85 },
        { t: 10, kind: 'sp', value: 12 }, { t: 310, kind: 'sp', value: 9 },
      ],
    },
  ],
  characterizations: [],
};
