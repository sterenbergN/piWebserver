import { instrumentParams, type ProcessDef } from '../model';
import { RHO_CP_PER_M3H } from './stirred';

// A steam-heated shell-and-tube exchanger heating a process stream. Steam
// passes the control valve at (near) critical flow, so its flow is set by
// valve position *and* supply pressure: m_s = K_st·f·P_s. All of it
// condenses, heating the tube wall, which heats the fluid:
//   C_w·dT_w/dt = m_s·λ − UA·(T_w − T)
//   C_f·dT/dt   = ρc_p·F·(T_in − T) + UA·(T_w − T)
// The outlet temperature is read a few metres downstream (transport delay).
// Steam flow is measured (FT-301), so is process flow (FT-302) and inlet
// temperature (TT-302): everything cascade and feedforward need.

/** Steam flow through the valve, kg/h. */
export const steamFlow = (flow: number, Ps: number, p: Record<string, number>) => p.Kst * flow * Math.max(0, Ps);

export const HX: ProcessDef = {
  id: 'hx',
  name: 'Steam heat exchanger',
  icon: '♨️',
  summary: 'Steam heats a process stream through a shell-and-tube exchanger. Steam pressure swings reach the outlet before a temperature loop sees them, and the process flow and inlet temperature are measured: the classic home of cascade and feedforward.',
  family: 'escalation',
  pv: { label: 'Outlet temperature', symbol: 'T', unit: '°C', lo: 0, hi: 120, decimals: 2 },
  secondary: {
    label: 'Steam flow', symbol: 'm_s', unit: 'kg/h', lo: 0, hi: 2000, decimals: 0, tag: 'FT-301', loopTag: 'FIC-301', upset: 'Ps',
    of: (_x, flow, d, p) => steamFlow(flow, d.Ps, p),
  },
  tags: { loop: 'TIC-301', transmitter: 'TT-301', valve: 'FV-301' },
  states: [{ key: 'Tw', label: 'Tube wall temperature', unit: '°C' }, { key: 'T', label: 'Outlet temperature', unit: '°C' }],
  params: [
    { key: 'Kst', label: 'Steam valve capacity', symbol: 'K_st', unit: 'kg/h per bar', default: 400, min: 20, max: 5000, step: 10, group: 'process',
      note: 'Steam flow per bar of supply pressure with the valve wide open (critical flow: downstream pressure doesn\'t matter).' },
    { key: 'lambda', label: 'Latent heat of steam', symbol: 'λ', unit: 'kJ/kg', default: 2100, min: 1800, max: 2300, step: 10, group: 'process',
      note: 'Heat released per kg condensed; about 2100 kJ/kg at 4 bar.' },
    { key: 'UA', label: 'Heat transfer', symbol: 'UA', unit: 'kW/K', default: 25, min: 1, max: 200, step: 0.5, group: 'process',
      note: 'Wall to process fluid. Fouling lowers it over time.' },
    { key: 'Cw', label: 'Tube bundle heat capacity', symbol: 'C_w', unit: 'kJ/K', default: 60, min: 5, max: 1000, step: 5, group: 'process',
      note: 'Mass of the tubes times the specific heat of steel.' },
    { key: 'Cf', label: 'Fluid hold-up heat capacity', symbol: 'C_f', unit: 'kJ/K', default: 250, min: 10, max: 5000, step: 10, group: 'process',
      note: 'Process fluid inside the exchanger: about 60 L of water.' },
    ...instrumentParams({ valveTau: 2, valveRate: 20, valveChar: 0, txTau: 4, txNoise: 0.15, txDelay: 3, Ts: 0.5, tx2Tau: 0.5 }),
  ],
  disturbances: [
    { key: 'Ps', label: 'Steam supply pressure', unit: 'bar', nominal: 4, min: 2.5, max: 5.5, note: 'Boiler header pressure: drops when other users draw steam.' },
    { key: 'F', label: 'Process flow', unit: 'm³/h', nominal: 10, min: 5, max: 14, note: 'Throughput set by production.', measured: 'FT-302' },
    { key: 'Tin', label: 'Inlet temperature', unit: '°C', nominal: 20, min: 5, max: 40, note: 'Process fluid arriving at the exchanger.', measured: 'TT-302' },
  ],
  derivatives: ([Tw, T], flow, d, p) => {
    const q = (steamFlow(flow, d.Ps, p) * p.lambda) / 3600; // kW
    return [
      (q - p.UA * (Tw - T)) / p.Cw,
      (RHO_CP_PER_M3H * d.F * (d.Tin - T) + p.UA * (Tw - T)) / p.Cf,
    ];
  },
  pvOf: ([, T]) => T,
  steady: (flow, d, p) => {
    const a = RHO_CP_PER_M3H * d.F;
    if (a <= 0) return null;
    const q = (steamFlow(flow, d.Ps, p) * p.lambda) / 3600;
    const T = d.Tin + q / a;
    return [T + q / p.UA, T];
  },
  fastest: (p) => p.Cw / (p.UA * 2),
  opPoints: [45, 60, 75],
  nominalPv: 60,
  uncertain: [
    { key: 'UA', spread: 0.3 },
    { key: 'Kst', spread: 0.15 },
    { key: 'Cf', spread: 0.2 },
    { key: 'txTau', spread: 0.3 },
    { key: 'valveTau', spread: 0.5 },
  ],
  scenarios: [
    {
      id: 'sp-steps', name: 'Setpoint steps', duration: 560, initialSp: 60,
      purpose: 'Outlet temperature setpoint changes for different products.',
      events: [{ t: 20, kind: 'sp', value: 70 }, { t: 200, kind: 'sp', value: 50 }, { t: 380, kind: 'sp', value: 65 }],
    },
    {
      id: 'steam-pressure', name: 'Steam pressure swings', duration: 560, initialSp: 60,
      purpose: 'The boiler header drops 25 %, then overshoots. Steam flow changes instantly; the temperature only finds out through the tube wall and the transport delay.',
      events: [{ t: 20, kind: 'dist', key: 'Ps', value: 3 }, { t: 200, kind: 'dist', key: 'Ps', value: 4.8 }, { t: 380, kind: 'dist', key: 'Ps', value: 4 }],
    },
    {
      id: 'flow-upset', name: 'Process flow changes (measured)', duration: 560, initialSp: 60,
      purpose: 'Throughput steps up 30 % and down 30 %. FT-302 sees it the moment it happens; feedback waits for the temperature to move.',
      events: [{ t: 20, kind: 'dist', key: 'F', value: 13 }, { t: 200, kind: 'dist', key: 'F', value: 7 }, { t: 380, kind: 'dist', key: 'F', value: 10 }],
    },
    {
      id: 'steam-limit', name: 'More duty than the steam allowance', duration: 600, initialSp: 60,
      purpose: 'Production pushes the flow up 40 %: holding 60 °C would need about 1100 kg/h of steam, more than the 1000 kg/h the boiler can spare (if a limit is set). Then the flow drops back below normal.',
      events: [{ t: 20, kind: 'dist', key: 'F', value: 14 }, { t: 260, kind: 'dist', key: 'F', value: 8 }, { t: 440, kind: 'dist', key: 'F', value: 10 }],
    },
    {
      id: 'inlet-temp', name: 'Inlet temperature changes (measured)', duration: 400, initialSp: 60,
      purpose: 'The feed arrives 10 °C colder, then 10 °C warmer. TT-302 measures it before it reaches the exchanger.',
      events: [{ t: 20, kind: 'dist', key: 'Tin', value: 10 }, { t: 200, kind: 'dist', key: 'Tin', value: 30 }],
    },
    {
      id: 'mismatch', name: 'Fouled and sluggish (model mismatch)', duration: 400, initialSp: 60,
      purpose: 'Fouling has cut UA by 30 % and the steam valve actuator has become twice as slow.',
      events: [
        { t: 0, kind: 'param', key: 'UA', factor: 0.7 }, { t: 0, kind: 'param', key: 'valveTau', factor: 2 },
        { t: 20, kind: 'sp', value: 70 }, { t: 200, kind: 'sp', value: 55 },
      ],
    },
  ],
  characterizations: [],
};
