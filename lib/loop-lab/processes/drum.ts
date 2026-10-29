import { instrumentParams, type ProcessDef } from '../model';

// A boiler steam drum. The level the transmitter sees is water plus the steam
// bubbles in it, so it doesn't behave like a tank:
//   water inventory  dL_w/dt = (q_fw − q_s)/(3.6·ρ·A)·1000   [mm/s, flows in t/h]
//   swell            τ_sw·dL_s/dt = k_sw·q_s − L_s     (more steam → more bubbles → level up)
//   shrink           τ_sh·dL_c/dt = k_sh·q_fw − L_c    (cold feedwater collapses bubbles → level down)
//   level            L = L_w + L_s − L_c
// So more steam demand first raises the level (swell) before it falls, and more
// feedwater first lowers it (shrink) before it rises: inverse response on top
// of an integrator. Feedwater flow (FT-502) and steam flow (FT-503) are measured.

export const DRUM: ProcessDef = {
  id: 'drum',
  name: 'Boiler drum level',
  icon: '🫧',
  summary: 'The water level in a boiler drum. More steam demand makes the level rise before it falls (swell); more feedwater makes it dip before it rises (shrink). A level-only controller reacts the wrong way first: this is why boilers use three-element control.',
  family: 'escalation',
  pv: { label: 'Drum level', symbol: 'L', unit: 'mm', lo: -300, hi: 300, decimals: 0 },
  secondary: {
    label: 'Feedwater flow', symbol: 'q_fw', unit: 't/h', lo: 0, hi: 120, decimals: 1, tag: 'FT-502', loopTag: 'FIC-502',
    of: (_x, flow, d, p) => p.Qmax * flow * (d.Pfw / 100),
  },
  tags: { loop: 'LIC-501', transmitter: 'LT-501', valve: 'FV-502' },
  states: [
    { key: 'Lw', label: 'Water inventory', unit: 'mm' },
    { key: 'Ls', label: 'Swell (steam bubbles)', unit: 'mm' },
    { key: 'Lc', label: 'Shrink (feedwater quench)', unit: 'mm' },
  ],
  params: [
    { key: 'A', label: 'Drum water surface', symbol: 'A', unit: 'm²', default: 8, min: 1, max: 40, step: 0.5, group: 'process',
      note: 'Bigger drum, slower level for the same flow imbalance. Water at about 750 kg/m³ (saturated, at pressure).' },
    { key: 'Qmax', label: 'Feedwater valve capacity', symbol: 'Q_max', unit: 't/h', default: 100, min: 10, max: 500, step: 1, group: 'process',
      note: 'Feedwater flow with FV-502 wide open at normal header pressure.' },
    { key: 'kSwell', label: 'Swell size', symbol: 'k_sw', unit: 'mm per t/h', default: 3, min: 0, max: 20, step: 0.1, group: 'process',
      note: 'How much the level rises from the extra steam bubbles per t/h of steam flow. Bigger at lower drum pressure.' },
    { key: 'tauSwell', label: 'Swell speed', symbol: 'τ_sw', unit: 's', default: 5, min: 0.5, max: 60, step: 0.5, group: 'process',
      note: 'How quickly the bubbles form after a change in steam demand.' },
    { key: 'kShrink', label: 'Shrink size', symbol: 'k_sh', unit: 'mm per t/h', default: 2, min: 0, max: 20, step: 0.1, group: 'process',
      note: 'How much cold feedwater collapses bubbles, per t/h. More subcooling, more shrink.' },
    { key: 'tauShrink', label: 'Shrink speed', symbol: 'τ_sh', unit: 's', default: 8, min: 0.5, max: 60, step: 0.5, group: 'process',
      note: 'How quickly the quench takes effect.' },
    ...instrumentParams({ valveTau: 2, valveRate: 20, valveChar: 0, txTau: 1, txNoise: 1, txDelay: 0, Ts: 0.5, tx2Tau: 1 }),
  ],
  disturbances: [
    { key: 'qs', label: 'Steam demand', unit: 't/h', nominal: 50, min: 20, max: 85, note: 'Steam drawn by the turbine or the plant: the load.', measured: 'FT-503' },
    { key: 'Pfw', label: 'Feedwater header pressure', unit: '% of normal', nominal: 100, min: 70, max: 115, note: 'Pump discharge pressure: changes the feedwater flow at a given valve position.' },
  ],
  derivatives: ([Lw, Ls, Lc], flow, d, p) => {
    const qfw = p.Qmax * flow * (d.Pfw / 100);
    return [
      ((qfw - d.qs) / 3.6 / (750 * p.A)) * 1000,
      (p.kSwell * d.qs - Ls) / p.tauSwell,
      (p.kShrink * qfw - Lc) / p.tauShrink,
    ];
  },
  pvOf: ([Lw, Ls, Lc]) => Lw + Ls - Lc,
  steady: () => null,
  steadyAt: (pv, d, p) => {
    const valve = Math.min(100, Math.max(0, (d.qs / (p.Qmax * (d.Pfw / 100))) * 100));
    const qfw = p.Qmax * (valve / 100) * (d.Pfw / 100);
    const Ls = p.kSwell * d.qs, Lc = p.kShrink * qfw;
    return { valve, x: [pv - Ls + Lc, Ls, Lc] };
  },
  fastest: (p) => Math.min(p.tauSwell, p.tauShrink),
  opPoints: [-50, 0, 50],
  nominalPv: 0,
  uncertain: [
    { key: 'kSwell', spread: 0.3 },
    { key: 'kShrink', spread: 0.3 },
    { key: 'A', spread: 0.1 },
    { key: 'valveTau', spread: 0.5 },
  ],
  scenarios: [
    {
      id: 'load-steps', name: 'Steam demand steps', duration: 910, initialSp: 0,
      purpose: 'The turbine takes 30 % more steam, then less, then back. The level swells up first, then falls: a level-only controller cuts the feedwater just when it needs more.',
      events: [{ t: 10, kind: 'dist', key: 'qs', value: 65 }, { t: 310, kind: 'dist', key: 'qs', value: 40 }, { t: 610, kind: 'dist', key: 'qs', value: 50 }],
    },
    {
      id: 'fw-pressure', name: 'Feedwater pressure dips', duration: 600, initialSp: 0,
      purpose: 'A second boiler starts drawing from the same feedwater header: 15 % less flow through the same valve opening.',
      events: [{ t: 10, kind: 'dist', key: 'Pfw', value: 85 }, { t: 310, kind: 'dist', key: 'Pfw', value: 100 }],
    },
    {
      id: 'sp-steps', name: 'Level setpoint changes', duration: 610, initialSp: 0,
      purpose: 'The level setpoint is raised, then lowered. More feedwater makes the level shrink first.',
      events: [{ t: 10, kind: 'sp', value: 50 }, { t: 310, kind: 'sp', value: -30 }],
    },
    {
      id: 'noisy', name: 'Boiling surface', duration: 400, initialSp: 0,
      purpose: 'A drum level is never calm: 3 % noise from the boiling surface.',
      events: [{ t: 0, kind: 'param', key: 'txNoise', value: 3 }, { t: 10, kind: 'dist', key: 'qs', value: 60 }],
    },
    {
      id: 'mismatch', name: 'Lower pressure, more swell (model mismatch)', duration: 610, initialSp: 0,
      purpose: 'Running at lower drum pressure: swell and shrink are both 50 % bigger than when the loop was tuned.',
      events: [
        { t: 0, kind: 'param', key: 'kSwell', factor: 1.5 }, { t: 0, kind: 'param', key: 'kShrink', factor: 1.5 },
        { t: 10, kind: 'dist', key: 'qs', value: 65 }, { t: 310, kind: 'dist', key: 'qs', value: 45 },
      ],
    },
  ],
  characterizations: [],
};
