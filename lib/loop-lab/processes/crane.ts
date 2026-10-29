import { instrumentParams, type ProcessDef } from '../model';

// An overhead crane trolley carrying a load on a rope: a pendulum on a cart.
// The PLC writes a speed reference to the trolley drive; the drive's speed
// loop follows it with a lag. The load swings whenever the trolley accelerates:
//   v_ref = (2·u − 1)·v_max                 u: drive reference, 0–1 (0.5 = stop)
//   dv/dt = (v_ref − v)/τ_d = a             trolley acceleration
//   dθ²/dt² = −(g/L)·sin θ − (a/L)·cos θ − 2ζ_s·ω₀·dθ/dt + F_w·cos θ/(m·L)
//   load position x_L = x + L·sin θ
// The PV is the load's position (trolley encoder plus rope length times the
// sway); the sway angle (a camera on the trolley looking down at the load) is
// the secondary measurement.

const G = 9.81;

export const CRANE: ProcessDef = {
  id: 'crane',
  name: 'Crane with a swinging load',
  icon: '🏗️',
  summary: 'An overhead crane trolley moving a load hanging on an 8 m rope. Every acceleration sets the load swinging with a 5.7 s period and almost no damping. Getting the load to where it should be, without sway, is a job for state feedback.',
  family: 'escalation',
  pv: { label: 'Load position', symbol: 'x_L', unit: 'm', lo: 0, hi: 40, decimals: 2 },
  secondary: {
    label: 'Sway angle', symbol: 'θ', unit: '°', lo: -10, hi: 10, decimals: 2, tag: 'ZT-602', loopTag: 'ZIC-602', measureOnly: true,
    of: ([, , th]) => (th * 180) / Math.PI,
  },
  tags: { loop: 'ZIC-601', transmitter: 'ZT-601', valve: 'SC-601' },
  states: [
    { key: 'x', label: 'Trolley position', unit: 'm' },
    { key: 'v', label: 'Trolley speed', unit: 'm/s' },
    { key: 'th', label: 'Sway angle', unit: 'rad' },
    { key: 'om', label: 'Sway rate', unit: 'rad/s' },
  ],
  params: [
    { key: 'L', label: 'Rope length', symbol: 'L', unit: 'm', default: 8, min: 2, max: 30, step: 0.5, group: 'process',
      note: 'From the trolley to the load\'s centre of mass. Sets the sway period, 2π√(L/g): 5.7 s at 8 m. The hoist encoder measures it.' },
    { key: 'm', label: 'Load mass', symbol: 'm', unit: 't', default: 10, min: 0.5, max: 60, step: 0.5, group: 'process',
      note: 'Only matters for wind: the speed-controlled drive moves the trolley the same way whatever hangs from it.' },
    { key: 'vmax', label: 'Top trolley speed', symbol: 'v_{max}', unit: 'm/s', default: 1, min: 0.2, max: 4, step: 0.1, group: 'process',
      note: 'Trolley speed at full reference (0 % = full speed one way, 50 % = stop, 100 % = full speed the other way).' },
    { key: 'tauD', label: 'Drive speed loop', symbol: 'τ_d', unit: 's', default: 0.3, min: 0.05, max: 3, step: 0.05, group: 'process',
      note: 'How quickly the drive\'s own speed controller follows the reference: motor, gearbox, wheels, trolley mass.' },
    { key: 'zs', label: 'Sway damping', symbol: 'ζ_s', unit: '', default: 0.005, min: 0, max: 0.2, step: 0.005, group: 'process',
      note: 'Air drag and rope bending: almost nothing, so a swing lasts for minutes.' },
    ...instrumentParams({ valveTau: 0.05, valveRate: 20, valveChar: 0, txTau: 0.1, txNoise: 0.05, txDelay: 0, Ts: 0.05, tx2Tau: 0.05 }),
  ],
  disturbances: [
    { key: 'Fw', label: 'Wind on the load', unit: 'N', nominal: 0, min: -8000, max: 8000, note: 'Side force from the wind on the load (a container catches a lot of it).' },
  ],
  derivatives: ([, v, th, om], flow, d, p) => {
    const vref = (2 * flow - 1) * p.vmax;
    const a = (vref - v) / p.tauD;
    const w0 = Math.sqrt(G / p.L);
    return [
      v,
      a,
      om,
      -(G / p.L) * Math.sin(th) - (a / p.L) * Math.cos(th) - 2 * p.zs * w0 * om + (d.Fw * Math.cos(th)) / (p.m * 1000 * p.L),
    ];
  },
  pvOf: ([x, , th], _flow, _d, p) => x + p.L * Math.sin(th),
  steady: () => null,
  steadyAt: (pv, d, p) => {
    const th = Math.atan(d.Fw / (p.m * 1000 * G));
    return { valve: 50, x: [pv - p.L * Math.sin(th), 0, th, 0] };
  },
  fastest: (p) => Math.min(p.tauD, 0.2 * Math.sqrt(p.L / G)),
  opPoints: [5, 20, 35],
  nominalPv: 20,
  uncertain: [
    { key: 'L', spread: 0.3 },
    { key: 'tauD', spread: 0.3 },
    { key: 'zs', spread: 0.5 },
  ],
  scenarios: [
    {
      id: 'moves', name: 'Move the load', duration: 120, initialSp: 5,
      purpose: 'Carry the load 20 m down the bay and put it down, then 15 m back. It should arrive quickly and not still be swinging when it gets there.',
      events: [{ t: 2, kind: 'sp', value: 25 }, { t: 62, kind: 'sp', value: 10 }],
    },
    {
      id: 'inching', name: 'Short positioning moves', duration: 60, initialSp: 20,
      purpose: 'Line the load up over a truck: 1 m, then half a metre back. Small moves are where sway is most annoying.',
      events: [{ t: 2, kind: 'sp', value: 21 }, { t: 32, kind: 'sp', value: 20.5 }],
    },
    {
      id: 'gust', name: 'Gust of wind', duration: 60, initialSp: 20,
      purpose: 'A 4 kN gust pushes the load sideways for 25 s, then drops: the load should stay put.',
      events: [{ t: 3, kind: 'dist', key: 'Fw', value: 4000 }, { t: 28, kind: 'dist', key: 'Fw', value: 0 }],
    },
    {
      id: 'long-rope', name: 'Load lowered further (model mismatch)', duration: 120, initialSp: 5,
      purpose: 'The same moves with the load hanging 13 m down instead of 8 m: the sway is 27 % slower than the controller was set up for.',
      events: [{ t: 0, kind: 'param', key: 'L', value: 13 }, { t: 2, kind: 'sp', value: 25 }, { t: 62, kind: 'sp', value: 10 }],
    },
    {
      id: 'noisy', name: 'Shaky sway camera', duration: 60, initialSp: 20,
      purpose: 'Dust and vibration: both readings jitter by 0.5 % (20 cm of position, 0.1° of sway). What does the controller pass on to the drive?',
      events: [{ t: 0, kind: 'param', key: 'txNoise', value: 0.5 }, { t: 2, kind: 'sp', value: 23 }],
    },
  ],
  characterizations: [],
};
