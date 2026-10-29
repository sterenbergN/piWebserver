import { instrumentParams, type Characterization, type Params, type ProcessDef } from '../model';

// A reactor that sometimes needs heating and sometimes cooling, with one
// temperature controller and two valves on its jacket: cooling water on the
// low half of the output, steam on the high half (split-range).
//   C_j·dT_j/dt = Q_h − Q_c − UA·(T_j − T)             Q_h = Q_h,max·f_h
//   C_v·dT/dt   = UA·(T_j − T) + Q_r − UA_l·(T − T_amb)  Q_c = K_cw·f_c·(T_j − T_cw)
// The cooling valve takes far more heat per % than the steam valve adds, so the
// loop gain jumps when the output crosses the split point.

const T_AMB = 20;
/** Jacket-to-cooling-water difference the split is balanced for, K. */
const BALANCE_DT = 40;

/** Valve openings (0–1) for a split-range signal s (0–1): cooling below the split, steam above. */
export function splitValves(s: number, p: Params) {
  const lo = Math.max(1e-6, (p.split - p.gap / 2) / 100), hi = Math.min(1 - 1e-6, (p.split + p.gap / 2) / 100);
  const cool = s < lo ? (lo - s) / lo : 0;
  const heat = s > hi ? (s - hi) / (1 - hi) : 0;
  return { cool, heat };
}

/** Controller % at which the cooling and heating ranges deliver the same kW per % (for the balanced split). */
export const balancePoint = (p: Params) => ((p.Kcw * BALANCE_DT) / (p.Kcw * BALANCE_DT + p.Qhmax)) * 100;

const balanced: Characterization = {
  id: 'balanced-split', label: 'Balance the two ranges', on: 'cv',
  f: (u, p) => {
    const b = balancePoint(p), lo = p.split - p.gap / 2, hi = p.split + p.gap / 2;
    return u <= b ? (u / b) * lo : hi + ((u - b) / (100 - b)) * (100 - hi);
  },
  inv: (v, p) => {
    const b = balancePoint(p), lo = p.split - p.gap / 2, hi = p.split + p.gap / 2;
    if (v <= lo) return (v / Math.max(lo, 1e-6)) * b;
    if (v >= hi) return b + ((v - hi) / Math.max(100 - hi, 1e-6)) * (100 - b);
    return b;
  },
  note: 'The PLC maps its output onto the two valves so that each % of output moves about the same number of kW on either side (cooling gets the larger share of the range), and jumps straight across any gap. Same idea as moving the split point, done in software.',
};

export const JACKET: ProcessDef = {
  id: 'jacket',
  name: 'Reactor temperature (split-range)',
  icon: '🧪',
  summary: 'A reactor that needs steam when the reaction is quiet and cooling water when it runs hot, from one controller and two valves. Where the output crosses from one valve to the other, the process gain changes threefold.',
  family: 'escalation',
  pv: { label: 'Temperature', symbol: 'T', unit: '°C', lo: 0, hi: 100, decimals: 2 },
  tags: { loop: 'TIC-501', transmitter: 'TT-501', valve: 'TY-501' },
  split: { low: 'TV-501A', high: 'TV-501B' },
  states: [{ key: 'Tj', label: 'Jacket temperature', unit: '°C' }, { key: 'T', label: 'Reactor temperature', unit: '°C' }],
  params: [
    { key: 'V', label: 'Reactor contents', symbol: 'V', unit: 'm³', default: 0.5, min: 0.1, max: 10, step: 0.1, group: 'process',
      note: 'Liquid in the reactor; its heat capacity is about 4.18 MJ/K per m³.' },
    { key: 'Cj', label: 'Jacket heat capacity', symbol: 'C_j', unit: 'kJ/K', default: 400, min: 20, max: 5000, step: 10, group: 'process',
      note: 'Jacket fluid plus the steel wall.' },
    { key: 'UA', label: 'Jacket heat transfer', symbol: 'UA', unit: 'kW/K', default: 20, min: 0.5, max: 50, step: 0.1, group: 'process',
      note: 'From jacket to contents. Fouling lowers it.' },
    { key: 'UAl', label: 'Heat loss', symbol: 'UA_l', unit: 'kW/K', default: 0.5, min: 0, max: 5, step: 0.05, group: 'process',
      note: 'To the surroundings at 20 °C, through the insulation.' },
    { key: 'Qhmax', label: 'Steam heating capacity', symbol: 'Q_h,max', unit: 'kW', default: 250, min: 10, max: 2000, step: 5, group: 'process',
      note: 'Heat from the steam valve, fully open.' },
    { key: 'Kcw', label: 'Cooling water capacity', symbol: 'K_cw', unit: 'kW/K', default: 20, min: 0.5, max: 100, step: 0.5, group: 'process',
      note: 'Heat the cooling water takes per K between the jacket and the water, valve fully open. About 800 kW at 40 K: three times the steam.' },
    { key: 'split', label: 'Split point', unit: '% output', default: 50, min: 5, max: 95, step: 1, group: 'valve',
      note: 'Controller output where the cooling valve has just closed and the steam valve starts to open (set in the positioners or the PLC output scaling).' },
    { key: 'gap', label: 'Gap between ranges', unit: '% output', default: 0, min: 0, max: 20, step: 0.5, group: 'valve',
      note: 'A band around the split where both valves are shut, so they never fight. It is also a dead zone the controller has to cross.' },
    ...instrumentParams({ valveTau: 3, valveRate: 10, valveChar: 0, txTau: 10, txNoise: 0.1, txDelay: 0, Ts: 1 }),
  ],
  disturbances: [
    { key: 'Qr', label: 'Reaction heat', unit: 'kW', nominal: 25, min: 0, max: 400, note: 'Heat released by the reaction: low when it is starting or finishing, high at full rate.' },
    { key: 'Tcw', label: 'Cooling water temperature', unit: '°C', nominal: 15, min: 5, max: 30, note: 'Cooling tower supply: warmer in summer.' },
  ],
  derivatives: ([Tj, T], flow, d, p) => {
    const { cool, heat } = splitValves(flow, p);
    const Qh = p.Qhmax * heat;
    const Qc = p.Kcw * cool * Math.max(0, Tj - d.Tcw);
    return [
      (Qh - Qc - p.UA * (Tj - T)) / p.Cj,
      (p.UA * (Tj - T) + d.Qr - p.UAl * (T - T_AMB)) / (4180 * p.V),
    ];
  },
  pvOf: ([, T]) => T,
  steady: (flow, d, p) => {
    // Both balances are linear in (T_j, T) for a fixed signal: solve them directly.
    const { cool, heat } = splitValves(flow, p);
    const a = p.Kcw * cool, Qh = p.Qhmax * heat;
    const T = (Qh + (a * (p.UAl * T_AMB + d.Qr)) / p.UA + a * d.Tcw + p.UAl * T_AMB + d.Qr) / (p.UAl + a * (1 + p.UAl / p.UA));
    const Tj = T + (p.UAl * (T - T_AMB) - d.Qr) / p.UA;
    return Tj < d.Tcw && a > 0 ? null : [Tj, T];
  },
  opPoints: [40, 60, 80],
  nominalPv: 60,
  uncertain: [
    { key: 'UA', spread: 0.2 },
    { key: 'Kcw', spread: 0.3 },
    { key: 'Cj', spread: 0.2 },
    { key: 'txTau', spread: 0.3 },
  ],
  scenarios: [
    {
      id: 'load-swing', name: 'Reaction runs hot, then stops', duration: 3600, initialSp: 60,
      purpose: 'The reaction speeds up to 150 kW (needs hard cooling), then stops (needs steam), then settles. The output has to cross the split both ways.',
      events: [{ t: 60, kind: 'dist', key: 'Qr', value: 150 }, { t: 1260, kind: 'dist', key: 'Qr', value: 0 }, { t: 2460, kind: 'dist', key: 'Qr', value: 25 }],
    },
    {
      id: 'sp-steps', name: 'Recipe temperatures', duration: 3600, initialSp: 60,
      purpose: 'Up to 80 °C (on steam), down to 40 °C (on cooling water), back to 60 °C. Each move uses the other valve.',
      events: [{ t: 60, kind: 'sp', value: 80 }, { t: 1260, kind: 'sp', value: 40 }, { t: 2460, kind: 'sp', value: 60 }],
    },
    {
      id: 'near-split', name: 'Working right at the split', duration: 2400, initialSp: 60,
      purpose: 'The reaction gives off just about what the reactor loses, so the output sits near the split. Small upsets make it hop from one valve to the other.',
      events: [{ t: 0, kind: 'param', key: 'txNoise', value: 0.3 }, { t: 60, kind: 'dist', key: 'Qr', value: 15 }, { t: 1200, kind: 'dist', key: 'Qr', value: 25 }],
    },
    {
      id: 'mismatch', name: 'Fouled jacket, warm water (model mismatch)', duration: 2400, initialSp: 60,
      purpose: 'Summer: the cooling water is 10 °C warmer, the jacket has fouled (20 % less heat transfer) and the cooling side has lost a third of its capacity.',
      events: [
        { t: 0, kind: 'param', key: 'UA', factor: 0.8 }, { t: 0, kind: 'param', key: 'Kcw', factor: 0.67 },
        { t: 30, kind: 'dist', key: 'Tcw', value: 25 }, { t: 60, kind: 'dist', key: 'Qr', value: 150 }, { t: 1260, kind: 'dist', key: 'Qr', value: 0 },
      ],
    },
  ],
  characterizations: [balanced],
};
