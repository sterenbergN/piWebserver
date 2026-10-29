import { instrumentParams, type ProcessDef } from '../model';

// A drive turning a heavy roll through a long, flexible shaft: a two-mass
// system. The PLC writes a torque reference (the drive's current loop makes the
// torque); the motor and the roll are two inertias joined by a spring:
//   J_m·dω_m/dt = T − k·φ − d·(ω_m − ω_L) − b_m·ω_m        T = (2·u − 1)·T_max
//   J_L·dω_L/dt = k·φ + d·(ω_m − ω_L) − b_L·ω_L − T_L
//   dφ/dt = ω_m − ω_L                                        (shaft twist)
// Between the two there is a resonance at √(k(1/J_m + 1/J_L)) and, seen from the
// motor, an anti-resonance at √(k/J_L). The PV is the roll speed; the motor
// speed (the drive's own encoder) is the secondary measurement.

const RPM = 60 / (2 * Math.PI);

export const SERVO: ProcessDef = {
  id: 'servo',
  name: 'Drive with a flexible shaft',
  icon: '⚙️',
  summary: 'A motor turning a heavy roll through a long shaft that twists. The shaft and the two inertias ring at 12 Hz with almost no damping, and any speed loop fast enough to matter excites it. The classic place for state feedback (or a notch filter).',
  family: 'escalation',
  pv: { label: 'Roll speed', symbol: 'n_L', unit: 'rpm', lo: 0, hi: 1500, decimals: 1 },
  secondary: {
    label: 'Motor speed', symbol: 'n_m', unit: 'rpm', lo: 0, hi: 1500, decimals: 1, tag: 'ST-702', loopTag: 'SIC-702',
    of: ([wm]) => wm * RPM,
  },
  tags: { loop: 'SIC-701', transmitter: 'ST-701', valve: 'SY-701' },
  states: [
    { key: 'wm', label: 'Motor speed', unit: 'rad/s' },
    { key: 'wl', label: 'Roll speed', unit: 'rad/s' },
    { key: 'phi', label: 'Shaft twist', unit: 'rad' },
  ],
  params: [
    { key: 'Jm', label: 'Motor inertia', symbol: 'J_m', unit: 'kg·m²', default: 0.5, min: 0.05, max: 10, step: 0.05, group: 'process',
      note: 'Rotor plus coupling half and brake disc.' },
    { key: 'JL', label: 'Roll inertia', symbol: 'J_L', unit: 'kg·m²', default: 1.5, min: 0.05, max: 30, step: 0.05, group: 'process',
      note: 'The roll (and whatever wraps it), as seen at the motor shaft through the gearbox.' },
    { key: 'k', label: 'Shaft stiffness', symbol: 'k', unit: 'N·m/rad', default: 2000, min: 50, max: 100000, step: 50, group: 'process',
      note: 'Torsional stiffness of the shaft and couplings. With the inertias it sets the resonance: 73 rad/s (11.6 Hz) here.' },
    { key: 'd', label: 'Shaft damping', symbol: 'd', unit: 'N·m·s/rad', default: 0.5, min: 0, max: 50, step: 0.1, group: 'process',
      note: 'Internal damping in the shaft and couplings: very little in steel. Resonance damping ratio ≈ 0.005 here.' },
    { key: 'bm', label: 'Motor friction', symbol: 'b_m', unit: 'N·m·s/rad', default: 0.05, min: 0, max: 5, step: 0.01, group: 'process',
      note: 'Bearings and fan, proportional to speed.' },
    { key: 'bl', label: 'Roll friction', symbol: 'b_L', unit: 'N·m·s/rad', default: 0.2, min: 0, max: 5, step: 0.01, group: 'process',
      note: 'Roll bearings and the process the roll drives, proportional to speed.' },
    { key: 'Tmax', label: 'Drive torque limit', symbol: 'T_{max}', unit: 'N·m', default: 200, min: 10, max: 2000, step: 10, group: 'process',
      note: 'Torque at full reference (0 % = full braking, 50 % = none, 100 % = full driving).' },
    ...instrumentParams({ valveTau: 0.002, valveRate: 5000, valveChar: 0, txTau: 0.002, txNoise: 0.1, txDelay: 0, Ts: 0.002, tx2Tau: 0.002, fast: true }),
  ],
  disturbances: [
    { key: 'TL', label: 'Load torque', unit: 'N·m', nominal: 20, min: -100, max: 150, note: 'Torque the process takes from the roll: web tension, material in the nip.' },
  ],
  derivatives: ([wm, wl, phi], flow, d, p) => {
    const T = (2 * flow - 1) * p.Tmax;
    const shaft = p.k * phi + p.d * (wm - wl);
    return [(T - shaft - p.bm * wm) / p.Jm, (shaft - p.bl * wl - d.TL) / p.JL, wm - wl];
  },
  pvOf: ([, wl]) => wl * RPM,
  steady: (flow, d, p) => {
    const T = (2 * flow - 1) * p.Tmax;
    const w = (T - d.TL) / (p.bm + p.bl);
    return [w, w, (p.bl * w + d.TL) / p.k];
  },
  fastest: (p) => 1 / Math.sqrt(p.k * (1 / p.Jm + 1 / p.JL)),
  opPoints: [300, 750, 1200],
  nominalPv: 750,
  uncertain: [
    { key: 'JL', spread: 0.4 },
    { key: 'k', spread: 0.3 },
    { key: 'bl', spread: 0.3 },
  ],
  scenarios: [
    {
      id: 'speed-steps', name: 'Speed changes', duration: 3, initialSp: 750,
      purpose: 'Line speed up 250 rpm, then down 500: the roll should follow quickly without ringing.',
      events: [{ t: 0.1, kind: 'sp', value: 1000 }, { t: 1.5, kind: 'sp', value: 500 }],
    },
    {
      id: 'load-torque', name: 'Load torque steps', duration: 3, initialSp: 750,
      purpose: 'The process suddenly takes 60 N·m more (material enters the nip), then lets go.',
      events: [{ t: 0.1, kind: 'dist', key: 'TL', value: 80 }, { t: 1.5, kind: 'dist', key: 'TL', value: 20 }],
    },
    {
      id: 'heavy-roll', name: 'Full roll (model mismatch)', duration: 3, initialSp: 750,
      purpose: 'The roll has wound up material: twice the inertia the controller was set up for, so the resonance drops from 73 to 68 rad/s and the roll responds half as fast.',
      events: [{ t: 0, kind: 'param', key: 'JL', factor: 2 }, { t: 0.1, kind: 'sp', value: 1000 }, { t: 1.5, kind: 'dist', key: 'TL', value: 80 }],
    },
    {
      id: 'noisy', name: 'Coarse encoder', duration: 2, initialSp: 750,
      purpose: 'A low-resolution encoder gives a speed reading that jitters by 0.5 %: the drive passes it on as torque ripple.',
      events: [{ t: 0, kind: 'param', key: 'txNoise', value: 0.5 }, { t: 0.1, kind: 'sp', value: 900 }],
    },
  ],
  characterizations: [],
};
