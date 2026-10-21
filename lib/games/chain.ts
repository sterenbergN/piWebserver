// Chain Reaction: dots drift around the field. You get one tap a level: it
// sets off a blast, and any dot that touches a blast blows up too, catching
// others. Pop enough to pass the level. Dots further down the chain are worth
// more. Three misses and it's over. Pure logic on a 480 × 480 field.

export const SIZE = 480;
export const DOT_R = 7;
export const BLAST_R = 40;
const GROW = 0.3;
const HOLD = 1.0;
const SHRINK = 0.3;
export const MAX_CHAIN_SCORE = 10_000_000;

export type Dot = { x: number; y: number; vx: number; vy: number; hue: number; blast: number | null; gen: number };
export type ChainState = {
  level: number;
  lives: number;
  /** Points banked from passed levels. */
  score: number;
  /** Points so far this level (kept only if it's passed). */
  pending: number;
  popped: number;
  dots: Dot[];
  /** The tap's own blast. */
  tap: { x: number; y: number; age: number } | null;
  status: 'aim' | 'running' | 'cleared' | 'failed' | 'over';
};

export const dotCount = (level: number) => Math.min(60, 4 + 5 * level);
export const needed = (level: number) => Math.ceil(dotCount(level) * Math.min(0.85, 0.15 + 0.07 * level));
/** 10 points for a dot your tap caught, 20 for one that caught, and so on (up to 100). */
export const dotPoints = (gen: number) => 10 * Math.min(10, gen);

/** A blast's radius `age` seconds after it went off (0 once it's gone). */
export function blastRadius(age: number) {
  if (age < GROW) return BLAST_R * (age / GROW);
  if (age < GROW + HOLD) return BLAST_R;
  if (age < GROW + HOLD + SHRINK) return BLAST_R * (1 - (age - GROW - HOLD) / SHRINK);
  return 0;
}
const LIFE = GROW + HOLD + SHRINK;

function makeDots(level: number, rng: () => number): Dot[] {
  return Array.from({ length: dotCount(level) }, () => {
    const angle = rng() * Math.PI * 2;
    const speed = 40 + rng() * 40 + level * 2;
    return {
      x: DOT_R + rng() * (SIZE - 2 * DOT_R), y: DOT_R + rng() * (SIZE - 2 * DOT_R),
      vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, hue: Math.floor(rng() * 360), blast: null, gen: 0,
    };
  });
}

function startLevel(level: number, lives: number, score: number, rng: () => number): ChainState {
  return { level, lives, score, pending: 0, popped: 0, dots: makeDots(level, rng), tap: null, status: 'aim' };
}

export const createGame = (rng: () => number = Math.random) => startLevel(1, 3, 0, rng);

/** Place this level's one tap. */
export function tap(s: ChainState, x: number, y: number): ChainState {
  if (s.status !== 'aim') return s;
  return { ...s, tap: { x, y, age: 0 }, status: 'running' };
}

/** After a level ends: on to the next, or try this one again. */
export function proceed(s: ChainState, rng: () => number = Math.random): ChainState {
  if (s.status === 'cleared') return startLevel(s.level + 1, s.lives, s.score, rng);
  if (s.status === 'failed') return startLevel(s.level, s.lives, s.score, rng);
  return s;
}

export function step(prev: ChainState, dt: number): ChainState {
  if (prev.status !== 'aim' && prev.status !== 'running') return prev;
  const tapBlast = prev.tap ? { ...prev.tap, age: prev.tap.age + dt } : null;
  // Live blasts this frame, with the chain generation each would pass on.
  const blasts: { x: number; y: number; r: number; gen: number }[] = [];
  if (tapBlast && blastRadius(tapBlast.age) > 0) blasts.push({ x: tapBlast.x, y: tapBlast.y, r: blastRadius(tapBlast.age), gen: 1 });

  let popped = prev.popped;
  let pending = prev.pending;
  const dots = prev.dots.map((d) => {
    if (d.blast !== null) return { ...d, blast: d.blast + dt };
    let x = d.x + d.vx * dt;
    let y = d.y + d.vy * dt;
    let { vx, vy } = d;
    if (x < DOT_R || x > SIZE - DOT_R) { vx = -vx; x = Math.max(DOT_R, Math.min(SIZE - DOT_R, x)); }
    if (y < DOT_R || y > SIZE - DOT_R) { vy = -vy; y = Math.max(DOT_R, Math.min(SIZE - DOT_R, y)); }
    return { ...d, x, y, vx, vy };
  });
  for (const d of dots) if (d.blast !== null && blastRadius(d.blast) > 0) blasts.push({ x: d.x, y: d.y, r: blastRadius(d.blast), gen: d.gen + 1 });
  for (const d of dots) {
    if (d.blast !== null) continue;
    const hit = blasts.find((b) => (b.x - d.x) ** 2 + (b.y - d.y) ** 2 <= (b.r + DOT_R) ** 2);
    if (!hit) continue;
    d.blast = 0;
    d.gen = hit.gen;
    popped++;
    pending += dotPoints(hit.gen);
  }

  const next: ChainState = { ...prev, dots, tap: tapBlast, popped, pending };
  if (prev.status === 'running') {
    const active = (tapBlast && tapBlast.age < LIFE) || dots.some((d) => d.blast !== null && d.blast < LIFE);
    if (!active) {
      if (popped >= needed(prev.level)) return { ...next, status: 'cleared', score: prev.score + pending, pending: 0 };
      const lives = prev.lives - 1;
      return { ...next, lives, pending: 0, status: lives <= 0 ? 'over' : 'failed' };
    }
  }
  return next;
}
