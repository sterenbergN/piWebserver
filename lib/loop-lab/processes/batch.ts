import { instrumentParams, type Params, type ProcessDef } from '../model';

// An exothermic batch reactor, A → B, on a temperature control unit (TCU): the
// PLC writes the jacket temperature setpoint, the TCU's own loop makes it.
//   dc/dt   = −r,  r = a·k₈₀·e^{E/R·(1/353 − 1/(T+273))}·c        (kmol/m³·s)
//   C·dT/dt = Q_r − UA·(T − T_j) − UA_l·(T − 20),  Q_r = −ΔH·r·V    (kW)
//   τ_j·dT_j/dt = T_j,set − T_j                                     T_j,set = 10 + 1.2·u
// The reaction heat grows with temperature (Arrhenius), so it is positive
// feedback: early in the batch, with plenty of A left, it eats most of the
// jacket's cooling margin and the reactor becomes slow and very sensitive;
// as A runs out, it calms down. Lose the margin altogether and it runs away.

const T_AMB = 20;

/** Reaction rate constant, 1/s. */
export const rateConstant = (T: number, p: Params, d: Params) => d.activity * p.k80 * Math.exp(p.EoverR * (1 / 353.15 - 1 / (T + 273.15)));

/** Reaction heat, kW, at a temperature and a concentration. */
export const reactionHeat = (T: number, c: number, p: Params, d: Params) => p.dH * 1000 * rateConstant(T, p, d) * Math.max(c, 0) * p.V;

export const jacketSetpoint = (u: number) => 10 + 1.2 * u;

export const BATCH: ProcessDef = {
  id: 'batch',
  name: 'Exothermic batch reactor',
  icon: '⚗️',
  summary: 'A batch reaction that gives off heat, faster the hotter it gets. At the start of the batch that positive feedback eats most of the jacket’s cooling margin: the reactor is four times slower and more sensitive than at the end, and a stronger batch can outrun the jacket altogether. One fixed tuning sees different plants.',
  family: 'escalation',
  pv: { label: 'Reactor temperature', symbol: 'T', unit: '°C', lo: 0, hi: 150, decimals: 2 },
  tags: { loop: 'TIC-1001', transmitter: 'TT-1001', valve: 'TY-1001' },
  states: [
    { key: 'c', label: 'Reactant left', unit: 'kmol/m³' },
    { key: 'T', label: 'Reactor temperature', unit: '°C' },
    { key: 'Tj', label: 'Jacket temperature', unit: '°C' },
  ],
  params: [
    { key: 'V', label: 'Batch volume', symbol: 'V', unit: 'm³', default: 2, min: 0.2, max: 20, step: 0.1, group: 'process',
      note: 'Liquid in the reactor; with ρc_p ≈ 4 MJ/m³K, that is the heat capacity below.' },
    { key: 'UA', label: 'Jacket heat transfer', symbol: 'UA', unit: 'kW/K', default: 60, min: 2, max: 200, step: 1, group: 'process',
      note: 'From jacket to batch. Fouling and a low liquid level (less wetted wall) lower it.' },
    { key: 'dH', label: 'Heat of reaction', symbol: '−ΔH', unit: 'MJ/kmol', default: 150, min: 0, max: 400, step: 5, group: 'process',
      note: 'Heat released per kmol of A reacted. With 2 kmol/m³ charged it could heat the batch by 75 K on its own (the adiabatic temperature rise).' },
    { key: 'k80', label: 'Rate constant at 80 °C', symbol: 'k_{80}', unit: '1/s', default: 1 / 1200, min: 1e-5, max: 0.01, step: 1e-5, group: 'process',
      note: 'Half of A gone in about 14 min at 80 °C.' },
    { key: 'EoverR', label: 'Activation temperature', symbol: 'E/R', unit: 'K', default: 12000, min: 1000, max: 20000, step: 100, group: 'process',
      note: 'How strongly the rate grows with temperature: about doubling every 7 K here.' },
    { key: 'tauJ', label: 'TCU and jacket lag', symbol: 'τ_j', unit: 's', default: 180, min: 5, max: 900, step: 5, group: 'process',
      note: 'How quickly the jacket follows the setpoint written to the temperature control unit: the TCU, the jacket’s volume and the glass-lined wall.' },
    ...instrumentParams({ valveTau: 5, valveRate: 5, valveChar: 0, txTau: 5, txNoise: 0.05, txDelay: 0, Ts: 2 }),
  ],
  disturbances: [
    { key: 'charge', label: 'Reactant charged', unit: 'kmol/m³', nominal: 2, min: 0, max: 3, note: 'Concentration of A at the start of the batch (also where the model is linearized).' },
    { key: 'activity', label: 'Catalyst activity', unit: '×', nominal: 1, min: 0.3, max: 2, note: 'A fresh or a tired catalyst lot: multiplies the reaction rate.' },
  ],
  derivatives: ([c, T, Tj], flow, d, p) => {
    const r = rateConstant(T, p, d) * Math.max(c, 0);
    const Cp = 4000 * p.V;
    return [
      -r,
      (p.dH * 1000 * r * p.V - p.UA * (T - Tj) - 0.5 * (T - T_AMB)) / Cp,
      (jacketSetpoint(flow * 100) - Tj) / p.tauJ,
    ];
  },
  pvOf: ([, T]) => T,
  steady: () => null,
  steadyAt: (T, d, p) => {
    // Quasi-steady: the reactant frozen at its charge, the jacket where it balances the heat.
    const c = d.charge;
    const Tj = T - (reactionHeat(T, c, p, d) - 0.5 * (T - T_AMB)) / p.UA;
    const valve = (Tj - 10) / 1.2;
    return { valve: Math.min(100, Math.max(0, valve)), x: [c, T, Tj] };
  },
  // The reactant runs down over an hour; the loop works in minutes. The linear model holds it at its charge.
  frozen: [0],
  opPoints: [60, 80, 95],
  nominalPv: 80,
  uncertain: [
    { key: 'UA', spread: 0.2 },
    { key: 'dH', spread: 0.2 },
    { key: 'tauJ', spread: 0.3 },
  ],
  scenarios: [
    {
      id: 'batch', name: 'A whole batch', duration: 7200, initialSp: 40,
      purpose: 'Charge at 40 °C, ramp to 80 °C at 2 °C/min, hold while it reacts, cool to 50 °C at the end. The reaction takes off just as the ramp ends: the controller has to stop the heat-up and start cooling at once. ',
      events: [{ t: 60, kind: 'sp', value: 80, ramp: 1 / 30 }, { t: 5400, kind: 'sp', value: 50, ramp: 1 / 30 }],
    },
    {
      id: 'hot-batch', name: 'A strong batch (model mismatch)', duration: 7200, initialSp: 40,
      purpose: 'More reactant charged (2.4 kmol/m³) and a fresh catalyst lot 50 % more active: at 80 °C the reaction heat now grows faster with temperature than the jacket can take it away. On its own the reactor would run away.',
      initialDist: { charge: 2.4, activity: 1.5 },
      events: [{ t: 60, kind: 'sp', value: 80, ramp: 1 / 30 }, { t: 5400, kind: 'sp', value: 50, ramp: 1 / 30 }],
    },
    {
      id: 'early-hold', name: 'Upsets early in the batch', duration: 3000, initialSp: 80,
      purpose: 'At 80 °C with the reactor full of reactant: setpoint up 3 °C and back. This is where the reaction heat makes the reactor slowest and most sensitive.',
      events: [{ t: 60, kind: 'sp', value: 83 }, { t: 1500, kind: 'sp', value: 80 }],
    },
    {
      id: 'late-hold', name: 'Upsets late in the batch', duration: 3000, initialSp: 80,
      purpose: 'The same steps with most of the reactant gone (0.2 kmol/m³ left): the reactor is fast and easy, if the controller doesn\'t overdo it.',
      initialDist: { charge: 0.2 },
      events: [{ t: 60, kind: 'sp', value: 83 }, { t: 1500, kind: 'sp', value: 80 }],
    },
  ],
  characterizations: [],
};
