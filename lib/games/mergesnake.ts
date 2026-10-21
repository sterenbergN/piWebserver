// Merge Snake: Snake crossed with 2048. Every tile you eat becomes a body
// segment right behind the head, carrying its number. When the two front
// segments match they merge (2 + 2 → 4), and that can cascade down the body
// like a 2048 slide (4 + 4 → 8, 8 + 8 → 16 …), each merge shortening the
// snake. Eat in the wrong order and you just get longer. Walls and your own
// body end the run. Pure logic on an 11 × 11 grid.

export const GRID = 11;
export const MAX_MERGE_SCORE = 50_000_000;

export type Point = { x: number; y: number };
export type Direction = 'up' | 'down' | 'left' | 'right';
export type Food = Point & { value: number };
export type MergeSnakeState = {
  /** Cells from head to tail. */
  cells: Point[];
  /** Body values from just behind the head to the tail (one fewer than cells). */
  values: number[];
  food: Food[];
  direction: Direction;
  queue: Direction[];
  score: number;
  /** The last cascade, for the "+16 ×3 chain" flash. */
  lastMerge: { value: number; chain: number; at: number } | null;
  ticks: number;
  status: 'ready' | 'playing' | 'over';
};

const VECTORS: Record<Direction, Point> = { up: { x: 0, y: -1 }, down: { x: 0, y: 1 }, left: { x: -1, y: 0 }, right: { x: 1, y: 0 } };
const OPPOSITE: Record<Direction, Direction> = { up: 'down', down: 'up', left: 'right', right: 'left' };
const FOODS = 3;

export function createGame(random: () => number = Math.random): MergeSnakeState {
  const mid = Math.floor(GRID / 2);
  const base: MergeSnakeState = {
    cells: [{ x: mid, y: mid }, { x: mid, y: mid + 1 }], values: [2], food: [], direction: 'up', queue: [],
    score: 0, lastMerge: null, ticks: 0, status: 'ready',
  };
  return { ...base, food: refill(base, random) };
}

export function queueDirection(s: MergeSnakeState, next: Direction): MergeSnakeState {
  if (s.status === 'over') return s;
  const last = s.queue[s.queue.length - 1] ?? s.direction;
  if (next === last || next === OPPOSITE[last] || s.queue.length >= 3) return s.status === 'ready' ? { ...s, status: 'playing' } : s;
  return { ...s, queue: [...s.queue, next], status: 'playing' };
}

/** The biggest number in the body. */
export const topValue = (s: Pick<MergeSnakeState, 'values'>) => Math.max(2, ...s.values);

/**
 * Put a new value behind the head and merge the front while it matches.
 * Returns the new values, points scored and how many merges chained.
 */
export function insertAndMerge(values: number[], value: number) {
  const out = [value, ...values];
  let points = 0;
  let chain = 0;
  while (out.length >= 2 && out[0] === out[1]) {
    const merged = out[0] * 2;
    out.splice(0, 2, merged);
    points += merged;
    chain++;
  }
  return { values: out, points, chain };
}

/**
 * Keep three tiles on the board: always a 2 (somewhere to start a stack), and
 * one that matches the front segment when that's small enough to appear.
 */
function refill(s: Pick<MergeSnakeState, 'cells' | 'values' | 'food'>, random: () => number): Food[] {
  const food = [...s.food];
  const taken = (x: number, y: number) => s.cells.some((c) => c.x === x && c.y === y) || food.some((f) => f.x === x && f.y === y);
  const free: Point[] = [];
  for (let y = 0; y < GRID; y++) for (let x = 0; x < GRID; x++) if (!taken(x, y)) free.push({ x, y });
  const front = s.values[0] ?? 2;
  const top = topValue({ values: s.values });
  while (food.length < FOODS && free.length) {
    const want = !food.some((f) => f.value === 2) ? 2
      : front <= 8 && !food.some((f) => f.value === front) ? front
        : random() < 0.6 ? 2 : random() < 0.75 || top < 32 ? 4 : 8;
    const [cell] = free.splice(Math.floor(random() * free.length), 1);
    food.push({ ...cell, value: want });
  }
  return food;
}

/** Ticks get quicker as the body's biggest number grows. */
export const tickMs = (s: Pick<MergeSnakeState, 'values'>) => Math.max(85, 200 - Math.log2(topValue(s)) * 11);

export function step(prev: MergeSnakeState, random: () => number = Math.random): MergeSnakeState {
  if (prev.status !== 'playing') return prev;
  const [next, ...queue] = prev.queue;
  const direction = next ?? prev.direction;
  const v = VECTORS[direction];
  const head = { x: prev.cells[0].x + v.x, y: prev.cells[0].y + v.y };
  const eaten = prev.food.find((f) => f.x === head.x && f.y === head.y);
  // Moving without eating: the tail leaves its cell this tick.
  const body = eaten ? prev.cells : prev.cells.slice(0, -1);
  const hitWall = head.x < 0 || head.y < 0 || head.x >= GRID || head.y >= GRID;
  const hitSelf = body.some((c) => c.x === head.x && c.y === head.y);
  if (hitWall || hitSelf) return { ...prev, direction, queue: [], status: 'over' };

  let cells = [head, ...body];
  let values = prev.values;
  let score = prev.score;
  let food = prev.food;
  let lastMerge = prev.lastMerge;
  if (eaten) {
    const merged = insertAndMerge(prev.values, eaten.value);
    values = merged.values;
    score += eaten.value + merged.points;
    // Each merge takes a segment off the tail end.
    cells = cells.slice(0, values.length + 1);
    if (merged.chain) lastMerge = { value: values[0], chain: merged.chain, at: prev.ticks + 1 };
    food = refill({ cells, values, food: prev.food.filter((f) => f !== eaten) }, random);
  }
  return { ...prev, cells, values, food, direction, queue, score, lastMerge, ticks: prev.ticks + 1 };
}
