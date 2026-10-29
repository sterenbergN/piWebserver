import { instrumentParams, valveCharacteristic, valveCharacteristicInverse, type ProcessDef } from '../model';

// Liquid flow through a control valve fed from a pressure header.
// The fluid's own inertia (≈0.1 s for 50 m of DN100 pipe) is far faster than
// the valve and transmitter, so flow is treated as following the valve
// instantly: Q = Kv·f·√Δp_valve with Δp_valve = P_header − P_back − k_line·Q².

/** Flow (m³/h) for a valve flow fraction `f` and header pressure `P0` (bar). */
export function flowAt(f: number, P0: number, p: Record<string, number>) {
  const drive = Math.max(0, P0 - p.Pback);
  const kvf = p.Kv * Math.max(0, f);
  return kvf * Math.sqrt(drive / (1 + kvf * kvf * p.kLine));
}

export const FLOW: ProcessDef = {
  id: 'flow',
  name: 'Liquid flow loop',
  icon: '💧',
  summary: 'Water from a pressure header through a control valve and a magnetic flowmeter. Fast, noisy and self-regulating: the classic loop where a well-tuned PI is all you need.',
  family: 'pid-wins',
  pv: { label: 'Flow', symbol: 'Q', unit: 'm³/h', lo: 0, hi: 60, decimals: 1 },
  tags: { loop: 'FIC-101', transmitter: 'FT-101', valve: 'FV-101' },
  states: [],
  params: [
    { key: 'Kv', label: 'Valve flow coefficient', symbol: 'K_v', unit: 'm³/h·bar^-½', default: 50, min: 5, max: 200, step: 1, group: 'process',
      note: 'Flow through the fully open valve with 1 bar across it. Sets the valve size.' },
    { key: 'kLine', label: 'Line loss coefficient', symbol: 'k_L', unit: 'bar/(m³/h)²', default: 0.001, min: 0, max: 0.01, step: 0.0001, group: 'process',
      note: 'Pipe, fittings and heat-exchanger losses: Δp_line = k_L·Q². 0.001 is 2.5 bar at 50 m³/h.' },
    { key: 'Pback', label: 'Downstream pressure', symbol: 'P_b', unit: 'bar', default: 1, min: 0, max: 4, step: 0.1, group: 'process',
      note: 'Static pressure the flow discharges into.' },
    ...instrumentParams({ valveTau: 1.5, valveRate: 25, valveChar: 1, txTau: 0.5, txNoise: 0.8, txDelay: 0, Ts: 0.1 }),
  ],
  disturbances: [
    { key: 'P0', label: 'Header pressure', unit: 'bar', nominal: 5, min: 1.5, max: 7, note: 'Supply pressure: drops when other users draw from the same header.' },
  ],
  derivatives: () => [],
  pvOf: (_x, f, d, p) => flowAt(f, d.P0, p),
  steady: () => [],
  opPoints: [15, 30, 45],
  nominalPv: 30,
  uncertain: [
    { key: 'Kv', spread: 0.25 },
    { key: 'kLine', spread: 0.3 },
    { key: 'valveTau', spread: 0.5 },
    { key: 'txTau', spread: 0.3 },
  ],
  scenarios: [
    {
      id: 'sp-steps', name: 'Setpoint steps across the range', duration: 125, initialSp: 30,
      purpose: 'Step the flow up and down across the operating range: speed, overshoot and whether the response is the same everywhere.',
      events: [{ t: 5, kind: 'sp', value: 40 }, { t: 35, kind: 'sp', value: 20 }, { t: 65, kind: 'sp', value: 45 }, { t: 95, kind: 'sp', value: 30 }],
    },
    {
      id: 'header-upset', name: 'Header pressure upsets', duration: 120, initialSp: 30,
      purpose: 'Other users pull the header pressure down and back up. How far does the flow move, and how fast does it come back?',
      events: [{ t: 5, kind: 'dist', key: 'P0', value: 3.8 }, { t: 45, kind: 'dist', key: 'P0', value: 5 }, { t: 85, kind: 'dist', key: 'P0', value: 6.2 }],
    },
    {
      id: 'noisy-sticky', name: 'Noisy meter and a sticky valve', duration: 120, initialSp: 30,
      purpose: 'Real instruments: 2 % noise and 1 % valve deadband. How much does the valve wear itself out, and does the loop cycle?',
      events: [
        { t: 0, kind: 'param', key: 'txNoise', value: 2 }, { t: 0, kind: 'param', key: 'valveDeadband', value: 1 },
        { t: 10, kind: 'sp', value: 35 }, { t: 60, kind: 'sp', value: 25 },
      ],
    },
    {
      id: 'mismatch', name: 'Worn valve (model mismatch)', duration: 125, initialSp: 30,
      purpose: 'The actuator has become 3× slower and the trim has lost a quarter of its capacity since the loop was tuned.',
      events: [
        { t: 0, kind: 'param', key: 'valveTau', factor: 3 }, { t: 0, kind: 'param', key: 'Kv', factor: 0.75 },
        { t: 5, kind: 'sp', value: 40 }, { t: 45, kind: 'sp', value: 20 }, { t: 85, kind: 'sp', value: 35 },
      ],
    },
    {
      id: 'saturation', name: 'Header collapse (valve saturates)', duration: 100, initialSp: 30,
      purpose: 'The header drops so far the valve cannot hold the flow even fully open. Checks integral windup on the way back.',
      events: [{ t: 10, kind: 'dist', key: 'P0', value: 2.2 }, { t: 50, kind: 'dist', key: 'P0', value: 5 }],
    },
  ],
  characterizations: [
    {
      id: 'valve-inverse', label: 'Inverse valve characteristic', on: 'cv',
      f: (u, p) => 100 * valveCharacteristicInverse(p.valveChar, u / 100),
      inv: (s, p) => 100 * valveCharacteristic(p.valveChar, s / 100),
      note: 'The controller asks for a flow fraction; this block turns it into the stem position the inherent characteristic needs. It cannot undo the installed distortion from line losses.',
    },
  ],
};
