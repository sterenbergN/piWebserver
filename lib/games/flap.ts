// Flap: tap to flap a little bird up through gaps in the pipes. One point a
// pipe. Pure logic on a 400 × 600 field.

export const W = 400;
export const H = 600;
export const GROUND = H - 60;
export const BIRD_X = 110;
export const BIRD_R = 14;
export const PIPE_W = 64;
const GRAVITY = 1500;
const FLAP_V = -460;
const SPACING = 220;
export const MAX_FLAP_SCORE = 100_000;

export type Pipe = { x: number; gapY: number; gap: number; scored: boolean };
export type FlapState = { y: number; vy: number; pipes: Pipe[]; score: number; status: 'ready' | 'playing' | 'over'; t: number };

/** Pipes move faster and gaps narrow as the score climbs. */
export const pipeSpeed = (score: number) => Math.min(260, 165 + score * 2.5);
export const gapSize = (score: number) => Math.max(128, 175 - score * 1.2);

export function createGame(): FlapState {
  return { y: H * 0.42, vy: 0, pipes: [], score: 0, status: 'ready', t: 0 };
}

export function flap(s: FlapState): FlapState {
  if (s.status === 'over') return s;
  return { ...s, vy: FLAP_V, status: 'playing' };
}

function newPipe(x: number, score: number, rng: () => number): Pipe {
  const gap = gapSize(score);
  const margin = 70;
  return { x, gap, gapY: margin + gap / 2 + rng() * (GROUND - 2 * margin - gap), scored: false };
}

/** Does the bird (a circle) touch this pipe? */
export function hitsPipe(y: number, p: Pipe) {
  const touches = (top: number, bottom: number) => {
    const nx = Math.max(p.x, Math.min(BIRD_X, p.x + PIPE_W));
    const ny = Math.max(top, Math.min(y, bottom));
    return (BIRD_X - nx) ** 2 + (y - ny) ** 2 < BIRD_R * BIRD_R;
  };
  return touches(-1000, p.gapY - p.gap / 2) || touches(p.gapY + p.gap / 2, GROUND);
}

export function step(prev: FlapState, dt: number, rng: () => number = Math.random): FlapState {
  if (prev.status === 'ready') return { ...prev, t: prev.t + dt, y: H * 0.42 + Math.sin((prev.t + dt) * 3) * 8 };
  if (prev.status === 'over') {
    // Fall to the ground after a crash.
    if (prev.y >= GROUND - BIRD_R) return prev;
    const vy = prev.vy + GRAVITY * dt;
    return { ...prev, vy, y: Math.min(GROUND - BIRD_R, prev.y + vy * dt) };
  }
  const speed = pipeSpeed(prev.score);
  const vy = Math.min(900, prev.vy + GRAVITY * dt);
  const y = prev.y + vy * dt;
  let score = prev.score;
  let pipes = prev.pipes.map((p) => ({ ...p, x: p.x - speed * dt })).filter((p) => p.x + PIPE_W > -10);
  pipes = pipes.map((p) => {
    if (!p.scored && p.x + PIPE_W < BIRD_X - BIRD_R) { score++; return { ...p, scored: true }; }
    return p;
  });
  const lastX = pipes.length ? pipes[pipes.length - 1].x : W - SPACING;
  if (lastX < W - SPACING + PIPE_W) pipes.push(newPipe(Math.max(W, lastX + SPACING), score, rng));
  const crashed = y + BIRD_R >= GROUND || y - BIRD_R <= -40 || pipes.some((p) => hitsPipe(y, p));
  return { ...prev, y: Math.min(y, GROUND - BIRD_R), vy: crashed ? Math.max(vy, 0) : vy, pipes, score, status: crashed ? 'over' : 'playing', t: prev.t + dt };
}
