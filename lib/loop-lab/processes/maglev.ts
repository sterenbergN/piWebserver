import { instrumentParams, type ProcessDef } from '../model';

// A steel mass held under an electromagnet: one axis of a magnetic bearing.
// The magnet's pull grows as the gap closes, so the mass is open-loop unstable:
// let it drop a little and the pull weakens, so it drops further.
//   i = u·I_max                                         (current amplifier, 0–1)
//   F = F₁·i²·(10 mm / x)²                              F₁: pull at 1 A, 10 mm
//   M·d²x/dt² = M·g − F  (+ end stops at 2 and 28 mm)   x: gap, mm; M = m + added mass
// Linearized at a gap x₀, the unstable pole is at √(2g/x₀): 36 rad/s at 15 mm.

const G = 9.81;
const X_MIN = 2, X_MAX = 28;

const pull = (x: number, flow: number, p: Record<string, number>) => {
  const i = flow * p.Imax;
  return p.F1 * i * i * (10 / Math.max(x, 0.5)) ** 2;
};

export const MAGLEV: ProcessDef = {
  id: 'maglev',
  name: 'Magnetic levitation',
  icon: '🧲',
  summary: 'A 2 kg steel mass hanging under an electromagnet with nothing touching it: one axis of a magnetic bearing. It is unstable without control, so the loop can\'t be slow, and the magnet\'s pull changes with the gap, so the gain moves with the setpoint.',
  // Unstable, but a PID designed from the model does the job: an honest "PID wins".
  family: 'pid-wins',
  pv: { label: 'Air gap', symbol: 'x', unit: 'mm', lo: 0, hi: 30, decimals: 3 },
  tags: { loop: 'ZIC-801', transmitter: 'ZT-801', valve: 'ZY-801' },
  states: [
    { key: 'x', label: 'Air gap', unit: 'mm' },
    { key: 'v', label: 'Falling speed', unit: 'mm/s' },
  ],
  params: [
    { key: 'm', label: 'Levitated mass', symbol: 'm', unit: 'kg', default: 2, min: 0.2, max: 20, step: 0.1, group: 'process',
      note: 'The steel armature and whatever it carries.' },
    { key: 'F1', label: 'Magnet strength', symbol: 'F₁', unit: 'N', default: 5, min: 0.5, max: 50, step: 0.1, group: 'process',
      note: 'Pull at 1 A across a 10 mm gap. It goes with current squared and gap to the minus two. A hot coil or a worn pole face lowers it.' },
    { key: 'Imax', label: 'Amplifier current limit', symbol: 'I_{max}', unit: 'A', default: 6, min: 1, max: 30, step: 0.5, group: 'process',
      note: 'Current at 100 % output. Holding 2 kg at 15 mm takes about 3 A.' },
    ...instrumentParams({ valveTau: 0.003, valveRate: 3000, valveChar: 0, txTau: 0.0005, txNoise: 0.05, txDelay: 0, Ts: 0.001, fast: true }),
  ],
  disturbances: [
    { key: 'dm', label: 'Added mass', unit: 'kg', nominal: 0, min: 0, max: 3, note: 'A load put on the levitated part (or a force pulling it down).' },
  ],
  derivatives: ([x, v], flow, d, p) => {
    const M = p.m + d.dm;
    let a = (G - pull(x, flow, p) / M) * 1000;
    // End stops: the pole face cover and the landing pad.
    if (x < X_MIN) a += 9e4 * (X_MIN - x) - 420 * v;
    else if (x > X_MAX) a += -9e4 * (x - X_MAX) - 420 * v;
    return [v, a];
  },
  pvOf: ([x]) => x,
  steady: () => null,
  steadyAt: (pv, d, p) => {
    const i = Math.sqrt(((p.m + d.dm) * G) / (p.F1 * (10 / pv) ** 2));
    return { valve: Math.min(100, (i / p.Imax) * 100), x: [pv, 0] };
  },
  fastest: () => 1 / 300,
  opPoints: [8, 15, 22],
  nominalPv: 15,
  uncertain: [
    { key: 'm', spread: 0.2 },
    { key: 'F1', spread: 0.15 },
    { key: 'valveTau', spread: 0.3 },
  ],
  scenarios: [
    {
      id: 'gap-steps', name: 'Gap changes', duration: 1.6, initialSp: 15,
      purpose: 'Pull the mass up to a 12 mm gap, let it down to 18 mm, back to 15 mm. Closer to the magnet the pull is stronger and the plant is more unstable.',
      events: [{ t: 0.1, kind: 'sp', value: 12 }, { t: 0.6, kind: 'sp', value: 18 }, { t: 1.1, kind: 'sp', value: 15 }],
    },
    {
      id: 'added-mass', name: 'Load put on', duration: 1.5, initialSp: 15,
      purpose: 'Half a kilogram is put on the levitated part, then taken off: it must not drop onto the pad.',
      events: [{ t: 0.1, kind: 'dist', key: 'dm', value: 0.5 }, { t: 0.8, kind: 'dist', key: 'dm', value: 0 }],
    },
    {
      id: 'noisy', name: 'Noisy gap sensor', duration: 1, initialSp: 15,
      purpose: 'The gap sensor picks up 0.3 % noise (90 µm) from the magnet\'s own field: watch the coil current.',
      events: [{ t: 0, kind: 'param', key: 'txNoise', value: 0.3 }, { t: 0.1, kind: 'sp', value: 13 }],
    },
    {
      id: 'mismatch', name: 'Hot coil, heavier part (model mismatch)', duration: 1.6, initialSp: 15,
      purpose: 'The magnet has lost 15 % of its pull (a hot coil) and the part is 20 % heavier than the controller was set up for.',
      events: [
        { t: 0, kind: 'param', key: 'F1', factor: 0.85 }, { t: 0, kind: 'param', key: 'm', factor: 1.2 },
        { t: 0.1, kind: 'sp', value: 12 }, { t: 0.6, kind: 'sp', value: 18 }, { t: 1.1, kind: 'dist', key: 'dm', value: 0.3 },
      ],
    },
  ],
  characterizations: [],
};
