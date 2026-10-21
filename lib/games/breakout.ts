// Breakout: bounce the ball off the paddle to clear rows of bricks. Pure
// logic on a fixed 480 × 600 field; the page draws it and feeds input + time.

export const W = 480;
export const H = 600;
export const COLS = 8;
export const ROWS = 6;
export const PADDLE_Y = H - 42;
export const PADDLE_H = 12;
export const BALL_R = 7;
const MARGIN = 12;
const GAP = 4;
const TOP = 70;
export const BRICK_W = (W - 2 * MARGIN - (COLS - 1) * GAP) / COLS;
export const BRICK_H = 18;
const PADDLE_SPEED = 620;
const MAX_BOUNCE = (60 * Math.PI) / 180;

/** Top rows are worth more: 60 down to 10. */
export const brickPoints = (row: number) => (ROWS - row) * 10;
/** A full wall is 1,680 points; a hundred walls is beyond anyone. */
export const MAX_BREAKOUT_SCORE = COLS * 210 * 100;

export type Ball = { x: number; y: number; vx: number; vy: number };
export type BreakoutState = {
  paddleX: number;
  paddleW: number;
  ball: Ball;
  /** Waiting on the paddle for a launch. */
  stuck: boolean;
  /** Alive bricks, row by row. */
  bricks: boolean[];
  level: number;
  lives: number;
  score: number;
  status: 'ready' | 'playing' | 'over';
};
export type BreakoutInput = { move: -1 | 0 | 1; target: number | null; launch: boolean };

export const brickRect = (i: number) => {
  const row = Math.floor(i / COLS);
  const col = i % COLS;
  return { x: MARGIN + col * (BRICK_W + GAP), y: TOP + row * (BRICK_H + GAP), row };
};
export const ballSpeed = (level: number) => Math.min(640, 330 + 28 * (level - 1));

const fullWall = () => Array(COLS * ROWS).fill(true) as boolean[];

export function createGame(): BreakoutState {
  return {
    paddleX: W / 2, paddleW: 90, ball: { x: W / 2, y: PADDLE_Y - BALL_R - 1, vx: 0, vy: 0 }, stuck: true,
    bricks: fullWall(), level: 1, lives: 3, score: 0, status: 'ready',
  };
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** Advance by `dt` seconds. */
export function step(prev: BreakoutState, dt: number, input: BreakoutInput, rng: () => number = Math.random): BreakoutState {
  if (prev.status === 'over') return prev;
  const s: BreakoutState = { ...prev, ball: { ...prev.ball }, bricks: prev.bricks };
  const half = s.paddleW / 2;
  s.paddleX = input.target !== null
    ? clamp(input.target, half, W - half)
    : clamp(s.paddleX + input.move * PADDLE_SPEED * dt, half, W - half);

  if (s.stuck) {
    s.ball.x = s.paddleX;
    s.ball.y = PADDLE_Y - BALL_R - 1;
    if (!input.launch) return s;
    const speed = ballSpeed(s.level);
    const angle = (rng() - 0.5) * 0.7;
    s.ball.vx = speed * Math.sin(angle);
    s.ball.vy = -speed * Math.cos(angle);
    s.stuck = false;
    s.status = 'playing';
  }

  // Small substeps so a fast ball can't skip through a brick.
  const travel = Math.hypot(s.ball.vx, s.ball.vy) * dt;
  const n = Math.max(1, Math.ceil(travel / (BALL_R * 0.6)));
  const h = dt / n;
  for (let k = 0; k < n; k++) {
    const b = s.ball;
    b.x += b.vx * h;
    b.y += b.vy * h;
    if (b.x < BALL_R) { b.x = BALL_R; b.vx = Math.abs(b.vx); }
    if (b.x > W - BALL_R) { b.x = W - BALL_R; b.vx = -Math.abs(b.vx); }
    if (b.y < BALL_R) { b.y = BALL_R; b.vy = Math.abs(b.vy); }

    // Paddle: where it hits sets the angle (centre straight up, edges up to 60°).
    if (b.vy > 0 && b.y + BALL_R >= PADDLE_Y && b.y - BALL_R <= PADDLE_Y + PADDLE_H && Math.abs(b.x - s.paddleX) <= half + BALL_R) {
      const hit = clamp((b.x - s.paddleX) / half, -1, 1);
      const speed = Math.hypot(b.vx, b.vy);
      b.vx = speed * Math.sin(hit * MAX_BOUNCE);
      b.vy = -speed * Math.cos(hit * MAX_BOUNCE);
      b.y = PADDLE_Y - BALL_R;
    }

    // Bricks: the first one touched breaks, and the ball bounces off its nearer side.
    for (let i = 0; i < s.bricks.length; i++) {
      if (!s.bricks[i]) continue;
      const r = brickRect(i);
      const nx = clamp(b.x, r.x, r.x + BRICK_W);
      const ny = clamp(b.y, r.y, r.y + BRICK_H);
      if ((b.x - nx) ** 2 + (b.y - ny) ** 2 > BALL_R * BALL_R) continue;
      if (s.bricks === prev.bricks) s.bricks = [...prev.bricks];
      s.bricks[i] = false;
      s.score += brickPoints(r.row);
      const dx = (b.x - (r.x + BRICK_W / 2)) / (BRICK_W / 2);
      const dy = (b.y - (r.y + BRICK_H / 2)) / (BRICK_H / 2);
      if (Math.abs(dx) > Math.abs(dy)) b.vx = Math.sign(dx || 1) * Math.abs(b.vx);
      else b.vy = Math.sign(dy || 1) * Math.abs(b.vy);
      break;
    }

    if (b.y - BALL_R > H) {
      s.lives -= 1;
      s.stuck = true;
      s.ball = { x: s.paddleX, y: PADDLE_Y - BALL_R - 1, vx: 0, vy: 0 };
      if (s.lives <= 0) s.status = 'over';
      return s;
    }
    if (!s.bricks.some(Boolean)) {
      // Wall cleared: the next one comes faster.
      s.level += 1;
      s.bricks = fullWall();
      s.stuck = true;
      s.ball = { x: s.paddleX, y: PADDLE_Y - BALL_R - 1, vx: 0, vy: 0 };
      return s;
    }
  }
  return s;
}
