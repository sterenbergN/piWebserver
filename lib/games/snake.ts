// Pure Snake game logic: the page renders state and feeds it input + ticks.

export const GRID_SIZE = 20;
export const POINTS_PER_FOOD = 10;
/** The best possible score: every cell but the starting head filled with food. */
export const MAX_SCORE = (GRID_SIZE * GRID_SIZE - 1) * POINTS_PER_FOOD;

export type Point = { x: number; y: number };
export type Direction = 'up' | 'down' | 'left' | 'right';

export type SnakeState = {
  snake: Point[];
  food: Point;
  direction: Direction;
  /** Turns waiting to be applied, one per tick (so quick double-taps both register). */
  queue: Direction[];
  score: number;
  status: 'ready' | 'playing' | 'over';
};

const VECTORS: Record<Direction, Point> = {
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
};
const OPPOSITE: Record<Direction, Direction> = { up: 'down', down: 'up', left: 'right', right: 'left' };

export function createGame(): SnakeState {
  return {
    snake: [{ x: 10, y: 10 }],
    food: { x: 15, y: 15 },
    direction: 'up',
    queue: [],
    score: 0,
    status: 'ready',
  };
}

/**
 * Queue a turn. Validated against the last *queued* direction, not the pending
 * one, so pressing Left then Down within one tick can't reverse into yourself.
 */
export function queueDirection(state: SnakeState, next: Direction): SnakeState {
  if (state.status === 'over') return state;
  const last = state.queue[state.queue.length - 1] ?? state.direction;
  const growing = state.snake.length > 1;
  if (next === last || (growing && next === OPPOSITE[last]) || state.queue.length >= 3) {
    return state.status === 'ready' ? { ...state, status: 'playing' } : state;
  }
  return { ...state, queue: [...state.queue, next], status: 'playing' };
}

function randomFreeCell(snake: Point[], random: () => number): Point {
  const free: Point[] = [];
  for (let y = 0; y < GRID_SIZE; y++) {
    for (let x = 0; x < GRID_SIZE; x++) {
      if (!snake.some((seg) => seg.x === x && seg.y === y)) free.push({ x, y });
    }
  }
  return free[Math.floor(random() * free.length)] ?? snake[0];
}

/** Advance one tick. */
export function step(state: SnakeState, random: () => number = Math.random): SnakeState {
  if (state.status !== 'playing') return state;
  const [nextDirection, ...rest] = state.queue;
  const direction = nextDirection ?? state.direction;
  const head = state.snake[0];
  const vector = VECTORS[direction];
  const newHead = { x: head.x + vector.x, y: head.y + vector.y };

  const eats = newHead.x === state.food.x && newHead.y === state.food.y;
  // The tail moves out of the way this tick unless the snake is growing.
  const body = eats ? state.snake : state.snake.slice(0, -1);
  const hitsWall = newHead.x < 0 || newHead.x >= GRID_SIZE || newHead.y < 0 || newHead.y >= GRID_SIZE;
  const hitsSelf = body.some((seg) => seg.x === newHead.x && seg.y === newHead.y);
  if (hitsWall || hitsSelf) return { ...state, direction, queue: [], status: 'over' };

  const snake = [newHead, ...body];
  return {
    ...state,
    snake,
    direction,
    queue: rest,
    score: eats ? state.score + POINTS_PER_FOOD : state.score,
    food: eats ? randomFreeCell(snake, random) : state.food,
  };
}

/** Tick length in ms: speeds up as the score grows. */
export function tickMs(score: number) {
  return Math.max(60, 150 - Math.floor(score / 50) * 15);
}
