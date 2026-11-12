import { instrumentParams, valveCharacteristic, valveCharacteristicInverse, type Params, type ProcessDef } from '../model';

// A fixed-speed centrifugal compressor feeding a discharge header, with a recycle (spillback)
// valve from the discharge, through a cooler, back to suction. One valve, two jobs:
//  - performance: hold the discharge pressure by spilling back what the users don't take;
//  - anti-surge: keep enough flow through the machine that it never reaches its surge line.
// The compressor's curve at its speed: the flow it delivers falls as the pressure ratio rises,
// steeply near the top, and past the peak ratio there is no flow it can deliver at all. There
// the flow collapses and reverses (surge) until the header pressure has fallen far enough for
// the machine to pick up again, and if nothing changes it does it again, every few seconds.
//   Q_map(R) = Q_s + (Q_max − Q_s)·√((R_pk − R)/(R_pk − R_ch))   R ≤ R_pk  (choked below R_ch)
//   Q_map(R) = −Q_back                                          R > R_pk   (surge: flow reverses)
//   τ_c·dQ/dt = Q_map(P_d/P_s) − Q                (the gas in the machine and its piping)
//   C·dP_d/dt = Q − F_rec − Q_d                   (the discharge header)
//   F_rec = K_rec·f·√(P_d − P_s)                  (the recycle valve)
// Flows in thousands of normal m³/h (so they go with mass), pressures in bar absolute.
// The surge approach is what anti-surge controllers work on: the surge flow over the flow, %.
// 100 % is the surge line; controllers hold a control line some way short of it.

const ratioOf = (Pd: number, p: Params) => Pd / Math.max(0.1, p.Ps);

/** The flow the compressor would settle to at a pressure ratio. */
export function mapFlow(R: number, p: Params) {
  if (R > p.Rpk) return -p.Qback;
  const Rch = p.Rch;
  const s = Math.min(1, Math.max(0, (p.Rpk - R) / Math.max(1e-6, p.Rpk - Rch)));
  return p.Qs + (p.Qmax - p.Qs) * Math.sqrt(s);
}

/** Recycle flow through the valve (flow fraction f, 0–1). */
export const recycleFlow = (f: number, Pd: number, p: Params) => p.Krec * f * Math.sqrt(Math.max(0, Pd - p.Ps));

/** Surge approach: the surge flow over the flow through the machine, %, held to a readable range. */
export const surgeApproach = (Q: number, p: Params) => Math.min(250, Math.max(0, (100 * p.Qs) / Math.max(Q, 0.4 * p.Qs)));

/** The discharge pressure the header settles at for a recycle valve flow fraction, on the stable side of the curve. */
function steadyPd(f: number, Qd: number, p: Params): number | null {
  const g = (Pd: number) => mapFlow(ratioOf(Pd, p), p) - recycleFlow(f, Pd, p) - Qd;
  let lo = p.Ps * 1.0001, hi = p.Ps * p.Rpk;
  if (g(hi) > 0) return null; // more flow than the users and the valve take even at the peak: it surges
  if (g(lo) < 0) return null; // the users want more than the machine can give
  for (let i = 0; i < 80; i++) {
    const mid = (lo + hi) / 2;
    if (g(mid) > 0) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}

export const COMPRESSOR: ProcessDef = {
  id: 'compressor',
  name: 'Compressor near surge',
  icon: '🌀',
  summary: 'A fixed-speed gas compressor whose recycle valve holds the discharge pressure. When a user trips, the pressure climbs in seconds and the machine walks up its curve to the surge line: a hard limit the loop must never cross, guarded by a fast override.',
  family: 'escalation',
  pv: { label: 'Discharge pressure', symbol: 'P_d', unit: 'bar', lo: 0, hi: 10, decimals: 3 },
  secondary: {
    label: 'Surge approach', symbol: 'S', unit: '%', lo: 0, hi: 200, decimals: 1, tag: 'UY-1101', loopTag: 'UIC-1101', limitOnly: true,
    of: ([, Q], _f, _d, p) => surgeApproach(Q, p),
  },
  tags: { loop: 'PIC-1101', transmitter: 'PT-1101', valve: 'UV-1101' },
  states: [{ key: 'Pd', label: 'Discharge pressure', unit: 'bar' }, { key: 'Q', label: 'Flow through the compressor', unit: 'kNm³/h' }],
  params: [
    { key: 'Qmax', label: 'Choke flow', symbol: 'Q_{max}', unit: 'kNm³/h', default: 100, min: 20, max: 500, step: 1, group: 'process',
      note: 'The most the machine passes, at low pressure ratios (it chokes).' },
    { key: 'Qs', label: 'Surge flow', symbol: 'Q_s', unit: 'kNm³/h', default: 30, min: 5, max: 200, step: 1, group: 'process',
      note: 'The flow at the top of the curve: less than this and the machine surges.' },
    { key: 'Rpk', label: 'Peak pressure ratio', symbol: 'R_{pk}', unit: '', default: 6.6, min: 2, max: 20, step: 0.1, group: 'process',
      note: 'The highest discharge-to-suction ratio the machine can hold, at its surge flow.' },
    { key: 'Rch', label: 'Choke pressure ratio', symbol: 'R_{ch}', unit: '', default: 2, min: 1.05, max: 10, step: 0.1, group: 'process',
      note: 'Below this ratio the flow no longer rises: the machine is choked.' },
    { key: 'Qback', label: 'Reverse flow in surge', symbol: 'Q_{back}', unit: 'kNm³/h', default: 20, min: 0, max: 200, step: 1, group: 'process',
      note: 'How hard the flow reverses when the machine surges.' },
    { key: 'tauC', label: 'Compressor flow lag', symbol: 'τ_c', unit: 's', default: 0.5, min: 0.05, max: 10, step: 0.05, group: 'process',
      note: 'The gas in the machine and its piping: how quickly the flow follows the pressure.' },
    { key: 'C', label: 'Header capacity', symbol: 'C', unit: 'kNm³/h·s per bar', default: 60, min: 5, max: 2000, step: 1, group: 'process',
      note: 'Discharge header and piping volume: how much flow imbalance moves the pressure 1 bar in a second.' },
    { key: 'Ps', label: 'Suction pressure', symbol: 'P_s', unit: 'bar', default: 1, min: 0.5, max: 5, step: 0.05, group: 'process',
      note: 'Held by the suction header.' },
    { key: 'Krec', label: 'Recycle valve capacity', symbol: 'K_{rec}', unit: 'kNm³/h per √bar', default: 60, min: 5, max: 500, step: 1, group: 'process',
      note: 'Recycle flow with the valve wide open, per square root of the pressure drop: sized to pass the whole surge flow and then some.' },
    ...instrumentParams({ valveTau: 0.4, valveRate: 60, valveChar: 0, txTau: 0.2, txNoise: 0.2, txDelay: 0, Ts: 0.1, tx2Tau: 0.2 }),
  ],
  disturbances: [
    { key: 'Qd', label: 'Users’ demand', unit: 'kNm³/h', nominal: 45, min: 0, max: 95, note: 'Gas the downstream users take from the header.', measured: 'FT-1102' },
  ],
  derivatives: ([Pd, Q], flow, d, p) => [
    (Q - recycleFlow(flow, Pd, p) - d.Qd) / p.C,
    (mapFlow(ratioOf(Pd, p), p) - Q) / p.tauC,
  ],
  pvOf: ([Pd]) => Pd,
  steady: (flow, d, p) => {
    const Pd = steadyPd(flow, d.Qd, p);
    return Pd === null ? null : [Pd, mapFlow(ratioOf(Pd, p), p)];
  },
  steadyAt: (pv, d, p) => {
    const R = ratioOf(pv, p);
    if (R > p.Rpk || pv <= p.Ps) return null;
    const Q = mapFlow(R, p);
    const rec = Q - d.Qd;
    const full = recycleFlow(1, pv, p);
    if (rec < 0 || rec > full) return null;
    return { valve: 100 * valveCharacteristicInverse(p.valveChar, rec / full), x: [pv, Q] };
  },
  fastest: (p) => p.tauC,
  opPoints: [5, 5.6, 6.2],
  nominalPv: 6,
  uncertain: [
    { key: 'C', spread: 0.3 },
    { key: 'tauC', spread: 0.5 },
    { key: 'Krec', spread: 0.2 },
    { key: 'Qs', spread: 0.1 },
  ],
  scenarios: [
    {
      id: 'sp-steps', name: 'Pressure setpoint steps', duration: 180, initialSp: 6,
      purpose: 'Discharge pressure setpoint changes within the curve: the performance controller on its own.',
      events: [{ t: 5, kind: 'sp', value: 6.3 }, { t: 65, kind: 'sp', value: 5.4 }, { t: 125, kind: 'sp', value: 6 }],
    },
    {
      id: 'demand', name: 'Users’ demand changes', duration: 180, initialSp: 6,
      purpose: 'Users take 15 kNm³/h less, then 7 more than normal. The recycle valve takes up the difference.',
      events: [{ t: 5, kind: 'dist', key: 'Qd', value: 30 }, { t: 65, kind: 'dist', key: 'Qd', value: 52 }, { t: 125, kind: 'dist', key: 'Qd', value: 45 }],
    },
    {
      id: 'user-trip', name: 'A user trips', duration: 120, initialSp: 6, limit: { max: 100, label: 'the surge line' },
      purpose: 'The biggest user trips: demand falls from 45 to 5 kNm³/h in an instant. The pressure climbs about 0.7 bar a second, and the machine is at its surge line within a second or two unless the recycle valve opens fast.',
      events: [{ t: 5, kind: 'dist', key: 'Qd', value: 5 }, { t: 60, kind: 'dist', key: 'Qd', value: 45 }],
    },
    {
      id: 'sp-into-surge', name: 'A setpoint past the surge line', duration: 120, initialSp: 6, initialDist: { Qd: 25 }, limit: { max: 100, label: 'the surge line' },
      purpose: 'Demand is low (25 kNm³/h, the recycle valve well open) and the setpoint is ramped up to 6.8 bar at 0.05 bar/s: more than the machine can make at any flow. A pressure controller alone closes the recycle and walks it into surge; the limit has to hold it short.',
      events: [{ t: 5, kind: 'sp', value: 6.8, ramp: 0.05 }, { t: 65, kind: 'sp', value: 6, ramp: 0.05 }],
    },
  ],
  characterizations: [],
};

/** For drawings: the recycle valve's flow at a stem position (0–100 %). */
export const recycleAt = (stem: number, Pd: number, p: Params) => recycleFlow(valveCharacteristic(p.valveChar, stem / 100), Pd, p);
