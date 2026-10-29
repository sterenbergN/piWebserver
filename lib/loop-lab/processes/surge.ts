import { instrumentParams, type ProcessDef } from '../model';

// A surge (buffer) tank between two plant sections. Upstream sends whatever
// it sends; a pump draws the outflow through LV-601. With A·dh/dt = Q_in − Q_out
// and the outflow independent of level, the level is a pure integrator.
// The tank exists to absorb upstream swings, so the job is to keep the
// outflow smooth while the level stays between its limits: averaging level
// control, the opposite of holding the level tight.

export const SURGE: ProcessDef = {
  id: 'surge',
  name: 'Surge tank level',
  icon: '🛢️',
  summary: 'A buffer vessel between two plant sections. Its job is to keep the outflow smooth by using its own volume. Tight level control is the wrong answer here; a loosely tuned P or PI is the right one.',
  family: 'pid-wins',
  pv: { label: 'Level', symbol: 'h', unit: 'm', lo: 0, hi: 3, decimals: 3 },
  tags: { loop: 'LIC-601', transmitter: 'LT-601', valve: 'LV-601' },
  states: [{ key: 'h', label: 'Level', unit: 'm' }],
  params: [
    { key: 'A', label: 'Tank cross-section', symbol: 'A', unit: 'm²', default: 4, min: 0.2, max: 50, step: 0.1, group: 'process',
      note: 'A bigger tank holds more of an upset for the same change in level.' },
    { key: 'H', label: 'Tank height', symbol: 'H', unit: 'm', default: 3, min: 0.5, max: 20, step: 0.1, group: 'process',
      note: 'Overflows at the top. The transmitter covers 0–3 m.' },
    { key: 'Qmax', label: 'Outlet capacity', symbol: 'Q_max', unit: 'm³/h', default: 60, min: 5, max: 500, step: 1, group: 'process',
      note: 'Pumped outflow with LV-601 wide open. Independent of level: the pump does the work.' },
    ...instrumentParams({ valveTau: 3, valveRate: 10, valveChar: 0, txTau: 1, txNoise: 0.3, txDelay: 0, Ts: 1 }),
  ],
  disturbances: [
    { key: 'Qin', label: 'Inflow from upstream', unit: 'm³/h', nominal: 30, min: 5, max: 55, note: 'Whatever the upstream section sends: the swings the tank is there to absorb.' },
  ],
  derivatives: ([h], flow, d, p) => {
    const dh = (d.Qin - p.Qmax * flow) / 3600 / p.A;
    if ((h <= 0 && dh < 0) || (h >= p.H && dh > 0)) return [0];
    return [dh];
  },
  pvOf: ([h], _f, _d, p) => Math.max(0, Math.min(p.H, h)),
  steady: () => null,
  steadyAt: (pv, d, p) => ({ valve: Math.min(100, Math.max(0, (d.Qin / p.Qmax) * 100)), x: [pv] }),
  averaging: { swing: 25, upset: 25 },
  opPoints: [1, 1.5, 2],
  nominalPv: 1.5,
  uncertain: [
    { key: 'A', spread: 0.1 },
    { key: 'Qmax', spread: 0.15 },
    { key: 'valveTau', spread: 0.5 },
  ],
  scenarios: [
    {
      id: 'surges', name: 'Upstream surges', duration: 3600, initialSp: 1.5,
      purpose: 'Upstream throughput jumps up 50 %, then down to half, then back. How much of that does the downstream section see, and does the level stay inside the tank?',
      events: [{ t: 60, kind: 'dist', key: 'Qin', value: 45 }, { t: 1260, kind: 'dist', key: 'Qin', value: 15 }, { t: 2460, kind: 'dist', key: 'Qin', value: 30 }],
    },
    {
      id: 'batch-dumps', name: 'Batch dumps', duration: 3000, initialSp: 1.5,
      purpose: 'Upstream empties a batch vessel every so often: five minutes of high flow, then normal. A good surge tank turns those pulses into a gentle ripple downstream.',
      events: [
        { t: 60, kind: 'dist', key: 'Qin', value: 50 }, { t: 360, kind: 'dist', key: 'Qin', value: 30 },
        { t: 1500, kind: 'dist', key: 'Qin', value: 50 }, { t: 1800, kind: 'dist', key: 'Qin', value: 30 },
      ],
    },
    {
      id: 'sp-change', name: 'Level setpoint moves', duration: 3000, initialSp: 1.5,
      purpose: 'The operator raises and lowers the normal level (to make room before a known surge, say). Rare for a surge tank, but it shouldn\'t slam the outflow.',
      events: [{ t: 60, kind: 'sp', value: 2 }, { t: 1500, kind: 'sp', value: 1.2 }],
    },
    {
      id: 'noisy', name: 'Sloshing surface', duration: 1800, initialSp: 1.5,
      purpose: 'Agitation and inflow splashing make the level reading noisy. A tight controller passes that straight to the outflow.',
      events: [{ t: 0, kind: 'param', key: 'txNoise', value: 1 }, { t: 60, kind: 'dist', key: 'Qin', value: 40 }],
    },
    {
      id: 'mismatch', name: 'Pump worn, tank smaller (model mismatch)', duration: 2400, initialSp: 1.5,
      purpose: 'Internals take 30 % of the volume and the pump has lost 20 % of its capacity since the loop was tuned.',
      events: [
        { t: 0, kind: 'param', key: 'A', factor: 0.7 }, { t: 0, kind: 'param', key: 'Qmax', factor: 0.8 },
        { t: 60, kind: 'dist', key: 'Qin', value: 42 }, { t: 1260, kind: 'dist', key: 'Qin', value: 20 },
      ],
    },
  ],
  characterizations: [],
};
