import { instrumentParams, type ProcessDef } from '../model';

// A jacketed stirred vessel heated through its jacket. Two energy balances:
//   C_j·dT_j/dt = Q_h − UA·(T_j − T)                     (jacket)
//   C_v·dT/dt   = ρc_p·F·(T_in − T) + UA·(T_j − T)       (vessel contents)
// with Q_h = Q_max·f from the heating valve. Two lags in series (jacket, vessel)
// plus a thermowell: lag-dominant, the textbook process where derivative earns its keep.

/** ρ·c_p of water per m³/h of flow, kW/K. */
export const RHO_CP_PER_M3H = (1000 * 4.18) / 3600;

export const STIRRED: ProcessDef = {
  id: 'stirred',
  name: 'Stirred tank temperature',
  icon: '🌡️',
  summary: 'A jacketed vessel with an agitator, heated through its jacket. Slow, lag-dominant and almost free of dead time: the textbook loop where a well-tuned PID, derivative included, is the answer.',
  family: 'pid-wins',
  pv: { label: 'Temperature', symbol: 'T', unit: '°C', lo: 0, hi: 100, decimals: 2 },
  tags: { loop: 'TIC-401', transmitter: 'TT-401', valve: 'TV-401' },
  states: [{ key: 'Tj', label: 'Jacket temperature', unit: '°C' }, { key: 'T', label: 'Vessel temperature', unit: '°C' }],
  params: [
    { key: 'V', label: 'Vessel volume', symbol: 'V', unit: 'm³', default: 0.2, min: 0.02, max: 5, step: 0.01, group: 'process',
      note: 'Liquid in the vessel; its heat capacity is ρ·c_p·V.' },
    { key: 'Cj', label: 'Jacket heat capacity', symbol: 'C_j', unit: 'kJ/K', default: 120, min: 5, max: 2000, step: 5, group: 'process',
      note: 'Jacket water plus the steel between it and the contents.' },
    { key: 'UA', label: 'Jacket heat transfer', symbol: 'UA', unit: 'kW/K', default: 3, min: 0.2, max: 30, step: 0.1, group: 'process',
      note: 'Overall coefficient times area. Fouling lowers it.' },
    { key: 'Qmax', label: 'Heating capacity', symbol: 'Q_{max}', unit: 'kW', default: 100, min: 5, max: 1000, step: 5, group: 'process',
      note: 'Heat into the jacket with the valve fully open.' },
    ...instrumentParams({ valveTau: 3, valveRate: 10, valveChar: 0, txTau: 15, txNoise: 0.1, txDelay: 0, Ts: 1 }),
  ],
  disturbances: [
    { key: 'F', label: 'Feed flow', unit: 'm³/h', nominal: 1, min: 0.3, max: 1.8, note: 'Through-flow of cold feed.' },
    { key: 'Tin', label: 'Feed temperature', unit: '°C', nominal: 20, min: 5, max: 35 },
  ],
  derivatives: ([Tj, T], flow, d, p) => {
    const Cv = 4180 * p.V; // kJ/K
    const q = p.Qmax * flow;
    return [
      (q - p.UA * (Tj - T)) / p.Cj,
      (RHO_CP_PER_M3H * d.F * (d.Tin - T) + p.UA * (Tj - T)) / Cv,
    ];
  },
  pvOf: ([, T]) => T,
  steady: (flow, d, p) => {
    const a = RHO_CP_PER_M3H * d.F;
    if (a <= 0) return null;
    const q = p.Qmax * flow;
    const T = d.Tin + q / a;
    return [T + q / p.UA, T];
  },
  opPoints: [40, 60, 80],
  nominalPv: 60,
  uncertain: [
    { key: 'UA', spread: 0.3 },
    { key: 'Cj', spread: 0.2 },
    { key: 'Qmax', spread: 0.1 },
    { key: 'txTau', spread: 0.3 },
  ],
  scenarios: [
    {
      id: 'sp-steps', name: 'Setpoint steps', duration: 2700, initialSp: 60,
      purpose: 'Recipe changes: heat up, cool down, settle in between. Lag-dominant processes punish slow integral action and reward derivative.',
      events: [{ t: 60, kind: 'sp', value: 70 }, { t: 900, kind: 'sp', value: 50 }, { t: 1800, kind: 'sp', value: 65 }],
    },
    {
      id: 'feed-temp', name: 'Feed temperature upsets', duration: 2400, initialSp: 60,
      purpose: 'The feed arrives 10 °C colder, then 10 °C warmer. Rejecting it means pushing heat through two lags.',
      events: [{ t: 60, kind: 'dist', key: 'Tin', value: 10 }, { t: 1260, kind: 'dist', key: 'Tin', value: 30 }],
    },
    {
      id: 'feed-flow', name: 'Throughput changes', duration: 2400, initialSp: 60,
      purpose: 'Production pushes 40 % more feed through, then drops to 70 %. More flow takes more heat away and speeds the vessel up.',
      events: [{ t: 60, kind: 'dist', key: 'F', value: 1.4 }, { t: 1260, kind: 'dist', key: 'F', value: 0.7 }],
    },
    {
      id: 'noisy', name: 'Noisy thermocouple', duration: 1500, initialSp: 60,
      purpose: 'A thermocouple instead of an RTD: five times the noise. Derivative has to be filtered, or it drives the valve with it.',
      events: [{ t: 0, kind: 'param', key: 'txNoise', value: 0.5 }, { t: 60, kind: 'sp', value: 66 }],
    },
    {
      id: 'mismatch', name: 'Fouled jacket (model mismatch)', duration: 2400, initialSp: 60,
      purpose: 'Scale has cut the jacket heat transfer by 40 % and the thermowell has slowed down since commissioning.',
      events: [
        { t: 0, kind: 'param', key: 'UA', factor: 0.6 }, { t: 0, kind: 'param', key: 'txTau', factor: 1.5 },
        { t: 60, kind: 'sp', value: 70 }, { t: 1260, kind: 'sp', value: 55 },
      ],
    },
  ],
  characterizations: [],
};
