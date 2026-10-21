// Setpoint: you are the controller. The process value (PV) falls under its
// own weight; holding the button drives it up. Keep it inside the setpoint
// band as the band wanders, narrows and speeds up, and ride out disturbances.
// Time out of band adds to the accumulated error; when that fills, the
// process trips. Positions are 0 (bottom) to 1 (top).

export const MAX_SETPOINT_SCORE = 1_000_000;
const GRAVITY = 1.15;
const THRUST = 2.4;
const DAMPING = 0.7;
/** Strip-chart samples kept: 6 s at 30 a second. */
export const HISTORY = 180;
const SAMPLE = 1 / 30;

export type Sample = { pv: number; sp: number; band: number };
export type SetpointState = {
  t: number;
  pv: number;
  vel: number;
  /** Phase offsets so every run's setpoint path is different. */
  phase: [number, number, number];
  score: number;
  /** Fractional points not yet counted. */
  carry: number;
  /** Accumulated error, 0–1; the process trips at 1. */
  error: number;
  /** The next disturbance: when it hits and which way (shown as a warning first). */
  gust: { at: number; dir: 1 | -1 };
  history: Sample[];
  sampleIn: number;
  status: 'ready' | 'playing' | 'over';
};

export function createGame(rng: () => number = Math.random): SetpointState {
  return {
    t: 0, pv: 0.5, vel: 0, phase: [rng() * 6.28, rng() * 6.28, rng() * 6.28], score: 0, carry: 0, error: 0,
    gust: { at: 9 + rng() * 4, dir: rng() < 0.5 ? 1 : -1 }, history: [], sampleIn: 0, status: 'ready',
  };
}

/** The setpoint at time t: a smooth wander that grows bolder and quicker. */
export function setpointAt(s: Pick<SetpointState, 'phase'>, t: number) {
  const f = 1 + t / 80;
  const reach = Math.min(1, 0.35 + t / 40);
  const [a, b, c] = s.phase;
  const wave = 0.26 * Math.sin(0.33 * t * f + a) + 0.12 * Math.sin(0.87 * t * f + b) + 0.06 * Math.sin(2.1 * t * f + c);
  return Math.max(0.14, Math.min(0.86, 0.5 + reach * wave));
}

/** Half the band's height at time t: it narrows as you go. */
export const bandAt = (t: number) => Math.max(0.035, 0.11 - t * 0.0011);

/** How far outside the band (0 when inside). */
export const outside = (pv: number, sp: number, band: number) => Math.max(0, Math.abs(pv - sp) - band);

/** Seconds until the next disturbance, if one is coming soon enough to warn about. */
export const gustWarning = (s: SetpointState) => (s.gust.at - s.t <= 1 ? Math.max(0, s.gust.at - s.t) : null);

export function step(prev: SetpointState, dt: number, thrust: boolean, rng: () => number = Math.random): SetpointState {
  if (prev.status === 'over') return prev;
  if (prev.status === 'ready' && !thrust) return prev;
  const s: SetpointState = { ...prev, status: 'playing' };
  s.t += dt;
  s.vel += ((thrust ? THRUST : 0) - GRAVITY) * dt;
  s.vel *= 1 - DAMPING * dt;
  if (s.t >= s.gust.at) {
    s.vel += s.gust.dir * (0.45 + Math.min(0.35, s.t / 300));
    s.gust = { at: s.t + Math.max(4, 9 - s.t / 40) + rng() * 4, dir: rng() < 0.5 ? 1 : -1 };
  }
  s.pv += s.vel * dt;
  if (s.pv < 0) { s.pv = 0; s.vel = 0; }
  if (s.pv > 1) { s.pv = 1; s.vel = 0; }

  const sp = setpointAt(s, s.t);
  const band = bandAt(s.t);
  const off = outside(s.pv, sp, band);
  if (off === 0) {
    // Points come faster the longer you've lasted.
    s.carry += dt * 10 * (1 + s.t / 60);
    const whole = Math.floor(s.carry);
    s.score += whole;
    s.carry -= whole;
    s.error = Math.max(0, s.error - dt * 0.05);
  } else {
    s.error += (off * 1.4 + 0.05) * dt;
  }
  if (s.error >= 1) { s.error = 1; s.status = 'over'; }

  s.sampleIn += dt;
  if (s.sampleIn >= SAMPLE) {
    s.sampleIn -= SAMPLE;
    s.history = [...prev.history.slice(-(HISTORY - 1)), { pv: s.pv, sp, band }];
  }
  return s;
}
