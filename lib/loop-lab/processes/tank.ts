import { instrumentParams, type ProcessDef } from '../model';

// A conical (point-down) tank: filled through a control valve, drained by
// gravity through a hand valve. Mass balance A(h)·dh/dt = Q_in − Q_out with
// A(h) = π·r(h)², r(h) = r0 + (R − r0)·h/H and Q_out = K_out·d·√h.
// The cross-section grows with level, so the same inflow change moves the
// level much faster near the bottom than near the top.

export const tankRadius = (h: number, p: Record<string, number>) => p.r0 + ((p.R - p.r0) * h) / p.H;
export const tankArea = (h: number, p: Record<string, number>) => Math.PI * tankRadius(h, p) ** 2;

/** Liquid volume (m³) at level h: ∫ π r(z)² dz. */
export function tankVolume(h: number, p: Record<string, number>) {
  const alpha = (p.R - p.r0) / p.H;
  const hh = Math.max(0, Math.min(p.H, h));
  if (Math.abs(alpha) < 1e-9) return Math.PI * p.r0 * p.r0 * hh;
  return (Math.PI * ((p.r0 + alpha * hh) ** 3 - p.r0 ** 3)) / (3 * alpha);
}

const inflow = (flow: number, d: Record<string, number>, p: Record<string, number>) => p.Qmax * flow * (d.supply / 100);
const outflow = (h: number, d: Record<string, number>, p: Record<string, number>) => p.Kout * (d.dOut / 100) * Math.sqrt(Math.max(0, h));

export const TANK: ProcessDef = {
  id: 'tank',
  name: 'Conical tank level',
  icon: '🔻',
  summary: 'A point-down conical tank. The cross-section grows several times from bottom to top, so the process gain and speed change across the range: one PI tuning cannot be right everywhere.',
  family: 'escalation',
  pv: { label: 'Level', symbol: 'h', unit: 'm', lo: 0, hi: 2, decimals: 3 },
  tags: { loop: 'LIC-201', transmitter: 'LT-201', valve: 'LV-201' },
  states: [{ key: 'h', label: 'Level', unit: 'm' }],
  params: [
    { key: 'H', label: 'Tank height', symbol: 'H', unit: 'm', default: 2, min: 0.5, max: 10, step: 0.1, group: 'process' },
    { key: 'R', label: 'Top radius', symbol: 'R', unit: 'm', default: 1, min: 0.1, max: 5, step: 0.05, group: 'process' },
    { key: 'r0', label: 'Bottom radius', symbol: 'r_0', unit: 'm', default: 0.15, min: 0.02, max: 5, step: 0.01, group: 'process',
      note: 'Equal to the top radius makes it a straight cylinder: a good comparison.' },
    { key: 'Qmax', label: 'Inlet valve capacity', symbol: 'Q_max', unit: 'm³/h', default: 12, min: 1, max: 100, step: 0.5, group: 'process',
      note: 'Inflow with the valve fully open at normal supply pressure.' },
    { key: 'Kout', label: 'Outlet coefficient', symbol: 'K_out', unit: 'm³/h·m^-½', default: 12, min: 1, max: 100, step: 0.5, group: 'process',
      note: 'Gravity drain through the outlet hand valve fully open: Q_out = K_out·d·√h.' },
    ...instrumentParams({ valveTau: 3, valveRate: 10, valveChar: 0, txTau: 2, txNoise: 0.3, txDelay: 0, Ts: 0.5 }),
  ],
  disturbances: [
    { key: 'dOut', label: 'Outlet valve opening', unit: '%', nominal: 50, min: 5, max: 100, note: 'Downstream demand: the hand valve on the drain.' },
    { key: 'supply', label: 'Inlet supply', unit: '% of normal', nominal: 100, min: 20, max: 120, note: 'Supply pressure to the inlet valve, as a share of normal flow capacity.' },
  ],
  derivatives: ([h], flow, d, p) => {
    const dV = (inflow(flow, d, p) - outflow(h, d, p)) / 3600; // m³/s
    const dh = dV / tankArea(Math.max(0, h), p);
    // Empty can't drain further; full overflows.
    if ((h <= 0 && dh < 0) || (h >= p.H && dh > 0)) return [0];
    return [dh];
  },
  pvOf: ([h], _f, _d, p) => Math.max(0, Math.min(p.H, h)),
  steady: (flow, d, p) => {
    const k = p.Kout * (d.dOut / 100);
    if (k <= 0) return null;
    const h = (inflow(flow, d, p) / k) ** 2;
    return h <= p.H ? [h] : null;
  },
  opPoints: [0.4, 1.0, 1.6],
  nominalPv: 1.0,
  uncertain: [
    { key: 'Kout', spread: 0.2 },
    { key: 'Qmax', spread: 0.1 },
    { key: 'valveTau', spread: 0.5 },
    { key: 'txTau', spread: 0.3 },
  ],
  scenarios: [
    {
      id: 'sp-range', name: 'Setpoint steps from bottom to top', duration: 4860, initialSp: 0.4,
      purpose: 'Move the level through the whole tank. With one PI tuning the response near the bottom and near the top look very different.',
      events: [{ t: 60, kind: 'sp', value: 0.7 }, { t: 1260, kind: 'sp', value: 1.2 }, { t: 2460, kind: 'sp', value: 1.6 }, { t: 3660, kind: 'sp', value: 0.5 }],
    },
    {
      id: 'dist-low', name: 'Outflow upset, low level', duration: 2400, initialSp: 0.4,
      purpose: 'Demand jumps from 50 % to 75 % with the tank nearly empty, where the narrow cone makes the level react fast.',
      events: [{ t: 60, kind: 'dist', key: 'dOut', value: 75 }, { t: 1260, kind: 'dist', key: 'dOut', value: 50 }],
    },
    {
      id: 'dist-high', name: 'Outflow upset, high level', duration: 2400, initialSp: 1.6,
      purpose: 'The same upset near the top, where the wide cone makes the level slow to move and slow to bring back.',
      events: [{ t: 60, kind: 'dist', key: 'dOut', value: 75 }, { t: 1260, kind: 'dist', key: 'dOut', value: 50 }],
    },
    {
      id: 'mismatch', name: 'Tank not as drawn (model mismatch)', duration: 2600, initialSp: 0.5,
      purpose: 'The tank is 15 % wider than the drawings and the outlet is partly blocked. Anything built on the geometry is now slightly wrong.',
      events: [
        { t: 0, kind: 'param', key: 'R', factor: 1.15 }, { t: 0, kind: 'param', key: 'Kout', factor: 0.7 },
        { t: 60, kind: 'sp', value: 1.1 }, { t: 1460, kind: 'sp', value: 0.6 },
      ],
    },
    {
      id: 'supply-fault', name: 'Supply failure (valve saturates)', duration: 2400, initialSp: 1.0,
      purpose: 'Inlet supply drops to 40 %: the valve goes fully open and still loses level. Checks windup when supply returns.',
      events: [{ t: 200, kind: 'dist', key: 'supply', value: 40 }, { t: 900, kind: 'dist', key: 'supply', value: 100 }],
    },
  ],
  characterizations: [
    {
      id: 'volume', label: 'Control volume, not level', on: 'pv', unit: 'm³',
      f: (h, p) => tankVolume(h, p),
      note: 'Converts level to liquid volume using the tank geometry. Inflow changes volume at the same rate whatever the level, so the controller sees nearly the same process everywhere.',
    },
  ],
};
