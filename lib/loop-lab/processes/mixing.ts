import { instrumentParams, type Params, type ProcessDef } from '../model';

// Hot and cold water into a tank, draining by gravity: two valves, two things
// to control, and each valve moves both.
//   A·dh/dt   = F_h + F_c − F_out             F_out = K_out·(demand/100)·√h
//   A·h·dT/dt = F_h·(T_h − T) + F_c·(T_c − T)   (well mixed)
// The hot valve (FV-901) is the main valve, the cold one (FV-902) the second;
// temperature (TT-901) is the main PV, level (LT-902) the second.

/** Fraction of the inflow that has to be hot for a temperature T. */
export const hotFraction = (T: number, d: Params) => Math.min(1, Math.max(0, (T - d.Tc) / (d.Th - d.Tc)));

export const MIXING: ProcessDef = {
  id: 'mixing',
  name: 'Mixing tank: level and temperature',
  icon: '🚰',
  summary: 'Hot and cold water into one tank. More of either raises the level, and each pulls the temperature its own way: neither valve controls just one thing. Which valve should control what, and does it pay to decouple them or hand both to an MPC?',
  family: 'escalation',
  pv: { label: 'Temperature', symbol: 'T', unit: '°C', lo: 0, hi: 100, decimals: 2 },
  secondary: {
    label: 'Level', symbol: 'h', unit: 'm', lo: 0, hi: 2, decimals: 3, tag: 'LT-902', loopTag: 'LIC-902',
    of: ([h]) => h,
  },
  tags: { loop: 'TIC-901', transmitter: 'TT-901', valve: 'FV-901' },
  mimo: {
    input: 'u2', valve: 'FV-902', valveLabel: 'Cold water valve', loop2: 'LIC-902', nominal2: 1,
    stem: ([, , v2]) => v2,
    steady: (T, h, d, p) => {
      const F = p.Kout * (d.dOut / 100) * Math.sqrt(Math.max(h, 0));
      const x = hotFraction(T, d);
      const valve = (100 * x * F) / p.Fhmax, u2 = (100 * (1 - x) * F) / p.Fcmax;
      if (valve > 100 || u2 > 100) return null;
      return { valve, u2, x: [h, d.Tc + x * (d.Th - d.Tc), u2] };
    },
  },
  states: [
    { key: 'h', label: 'Level', unit: 'm' },
    { key: 'T', label: 'Temperature', unit: '°C' },
    { key: 'v2', label: 'Cold valve stem', unit: '%' },
  ],
  params: [
    { key: 'A', label: 'Tank cross-section', symbol: 'A', unit: 'm²', default: 0.8, min: 0.1, max: 5, step: 0.05, group: 'process',
      note: 'A bigger tank answers both valves more slowly.' },
    { key: 'Kout', label: 'Outlet capacity', symbol: 'K_{out}', unit: 'm³/h per √m', default: 28.6, min: 5, max: 100, step: 0.1, group: 'process',
      note: 'Outflow by gravity at full demand: F = K_out·√h. 20 m³/h at 1 m with the outlet at 70 %.' },
    { key: 'Fhmax', label: 'Hot valve capacity', symbol: 'F_{h,max}', unit: 'm³/h', default: 20, min: 2, max: 100, step: 0.5, group: 'process',
      note: 'Hot water flow with FV-901 wide open.' },
    { key: 'Fcmax', label: 'Cold valve capacity', symbol: 'F_{c,max}', unit: 'm³/h', default: 30, min: 2, max: 100, step: 0.5, group: 'process',
      note: 'Cold water flow with FV-902 wide open.' },
    { key: 'tau2', label: 'Cold valve actuator', symbol: 'τ_{v2}', unit: 's', default: 2, min: 0.1, max: 30, step: 0.1, group: 'valve',
      note: 'How quickly FV-902 follows its signal.' },
    ...instrumentParams({ valveTau: 2, valveRate: 10, valveChar: 0, txTau: 4, txNoise: 0.1, txDelay: 0, Ts: 2, tx2Tau: 2 }),
  ],
  disturbances: [
    { key: 'dOut', label: 'Outlet demand', unit: '%', nominal: 70, min: 20, max: 130, note: 'How far the users downstream open the outlet: the flow the tank has to supply.' },
    { key: 'Th', label: 'Hot water temperature', unit: '°C', nominal: 70, min: 40, max: 90, note: 'Hot water supply from the boiler or a heat exchanger.' },
    { key: 'Tc', label: 'Cold water temperature', unit: '°C', nominal: 15, min: 5, max: 30, note: 'Mains water: colder in winter.' },
    { key: 'u2', label: 'Cold valve signal', unit: '%', nominal: 42.4, min: 0, max: 100, manipulated: true, note: 'FV-902\'s signal: set by the controller, not a disturbance.' },
  ],
  derivatives: ([h, T, v2], flow, d, p) => {
    const Fh = p.Fhmax * flow, Fc = p.Fcmax * Math.min(1, Math.max(0, v2 / 100));
    const Fout = p.Kout * (d.dOut / 100) * Math.sqrt(Math.max(h, 0));
    return [
      (Fh + Fc - Fout) / 3600 / p.A,
      (Fh * (d.Th - T) + Fc * (d.Tc - T)) / 3600 / (p.A * Math.max(h, 0.05)),
      (d.u2 - v2) / p.tau2,
    ];
  },
  pvOf: ([, T]) => T,
  steady: (flow, d, p) => {
    const Fh = p.Fhmax * flow, Fc = p.Fcmax * (d.u2 / 100), F = Fh + Fc;
    if (F <= 0) return null;
    const h = (F / (p.Kout * (d.dOut / 100))) ** 2;
    return [h, (Fh * d.Th + Fc * d.Tc) / F, d.u2];
  },
  opPoints: [25, 35, 50],
  nominalPv: 35,
  uncertain: [
    { key: 'A', spread: 0.15 },
    { key: 'Kout', spread: 0.2 },
    { key: 'tau2', spread: 0.3 },
    { key: 'txTau', spread: 0.3 },
  ],
  scenarios: [
    {
      id: 'temp-steps', name: 'Temperature changes', duration: 1800, initialSp: 35,
      purpose: 'Up to 45 °C, then down to 30 °C. The level setpoint stays at 1 m: how much does the level notice?',
      events: [{ t: 30, kind: 'sp', value: 45 }, { t: 900, kind: 'sp', value: 30 }],
    },
    {
      id: 'level-steps', name: 'Level changes', duration: 1800, initialSp: 35,
      purpose: 'Up to 1.3 m, then down to 0.8 m, temperature setpoint unchanged. More water in means more of both: does the temperature hold?',
      events: [{ t: 30, kind: 'sp2', value: 1.3 }, { t: 900, kind: 'sp2', value: 0.8 }],
    },
    {
      id: 'demand', name: 'Demand changes', duration: 1800, initialSp: 35,
      purpose: 'The users downstream draw 30 % more, then much less. Both valves have to follow, in proportion.',
      events: [{ t: 30, kind: 'dist', key: 'dOut', value: 91 }, { t: 900, kind: 'dist', key: 'dOut', value: 50 }],
    },
    {
      id: 'hot-supply', name: 'Hot water cools', duration: 1500, initialSp: 35,
      purpose: 'The hot supply drops from 70 to 58 °C (the boiler is struggling), then recovers.',
      events: [{ t: 30, kind: 'dist', key: 'Th', value: 58 }, { t: 750, kind: 'dist', key: 'Th', value: 70 }],
    },
    {
      id: 'hot-recipe', name: 'A hot recipe', duration: 1800, initialSp: 55,
      purpose: 'Working at 55 °C, where most of the water is hot: the level moves to 1.3 m and back. Is the same pairing still right?',
      events: [{ t: 30, kind: 'sp2', value: 1.3 }, { t: 900, kind: 'sp2', value: 1 }],
    },
    {
      id: 'peak', name: 'Peak demand at 50 °C', duration: 1800, initialSp: 50,
      purpose: 'Demand rises past what the hot valve can supply at 50 °C and 1 m. Something has to give: which, and how gracefully?',
      events: [{ t: 30, kind: 'dist', key: 'dOut', value: 120 }, { t: 900, kind: 'dist', key: 'dOut', value: 70 }],
    },
  ],
  characterizations: [],
};
