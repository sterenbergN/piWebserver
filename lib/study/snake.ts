// Study Snake: a question on top, and its answers on the board as lettered food.
// Eat the right one to grow. The snake waits for a turn before each question, so
// reading is never against the clock. Pure, and seeded so it can be tested.

import type { GameQuestion } from './games';

export const BOARD = 14;
const START_HEARTS = 3;
const POINTS = 10;
export const MAX_FOODS = 4;

export type Dir = 'up' | 'down' | 'left' | 'right';
export type Cell = { x: number; y: number };
const VECTORS: Record<Dir, Cell> = { up: { x: 0, y: -1 }, down: { x: 0, y: 1 }, left: { x: -1, y: 0 }, right: { x: 1, y: 0 } };
const OPPOSITE: Record<Dir, Dir> = { up: 'down', down: 'up', left: 'right', right: 'left' };

export type SnakeRun = {
  rng: number;
  snake: Cell[];
  dir: Dir;
  queue: Dir[];
  /** Waiting: read the question, then turn to go. Feedback: showing how the last answer went. */
  phase: 'waiting' | 'moving' | 'feedback' | 'over';
  questionId: string;
  /** Each food is one of the question's choices, by original index. */
  foods: (Cell & { choice: number })[];
  hearts: number;
  score: number;
  right: number;
  wrong: number;
  used: string[];
  last: { right: boolean; answer: number[]; crashed: boolean } | null;
  missed: string[];
};

function roll(run: Pick<SnakeRun, 'rng'>) {
  run.rng = (run.rng + 0x6d2b79f5) | 0;
  let t = Math.imul(run.rng ^ (run.rng >>> 15), 1 | run.rng);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/** A question fits if it has one right answer. Long choice lists are cut down to four. */
export const snakeQuestions = (pool: GameQuestion[]) => pool.filter((q) => q.correct.length === 1 && q.choices.length >= 2);

function freeCell(run: SnakeRun, taken: Cell[]): Cell {
  for (let tries = 0; tries < 400; tries++) {
    const cell = { x: Math.floor(roll(run) * BOARD), y: Math.floor(roll(run) * BOARD) };
    const clash = (other: Cell) => other.x === cell.x && other.y === cell.y;
    const head = run.snake[0];
    // Not right in front of the snake, so nothing gets eaten by accident.
    if (!taken.some(clash) && !run.snake.some(clash) && Math.abs(cell.x - head.x) + Math.abs(cell.y - head.y) >= 3) return cell;
  }
  return { x: 0, y: 0 };
}

function deal(run: SnakeRun, pool: GameQuestion[]) {
  let fresh = pool.filter((q) => !run.used.includes(q.id));
  if (!fresh.length) {
    run.used = [];
    fresh = pool;
  }
  const urgent = fresh.filter((q) => q.priority > 1);
  const from = urgent.length && roll(run) < 0.6 ? urgent : fresh;
  const question = from[Math.floor(roll(run) * from.length)];
  run.used.push(question.id);
  run.questionId = question.id;
  const wrong = question.choices.map((_, i) => i).filter((i) => i !== question.correct[0]);
  while (wrong.length > MAX_FOODS - 1) wrong.splice(Math.floor(roll(run) * wrong.length), 1);
  const choices = [question.correct[0], ...wrong];
  for (let i = choices.length - 1; i > 0; i--) {
    const j = Math.floor(roll(run) * (i + 1));
    [choices[i], choices[j]] = [choices[j], choices[i]];
  }
  const foods: SnakeRun['foods'] = [];
  for (const choice of choices) foods.push({ ...freeCell(run, foods), choice });
  run.foods = foods;
  run.queue = [];
  run.phase = 'waiting';
}

export function startSnake(pool: GameQuestion[], seed: number): SnakeRun {
  const run: SnakeRun = {
    rng: seed | 0,
    snake: [{ x: 7, y: 7 }, { x: 7, y: 8 }, { x: 7, y: 9 }],
    dir: 'up', queue: [], phase: 'waiting', questionId: '', foods: [],
    hearts: START_HEARTS, score: 0, right: 0, wrong: 0, used: [], last: null, missed: [],
  };
  deal(run, pool);
  return run;
}

/** A turn. The first one after a question sets the snake off. */
export function turn(run: SnakeRun, next: Dir) {
  if (run.phase !== 'waiting' && run.phase !== 'moving') return run;
  const last = run.queue[run.queue.length - 1] ?? run.dir;
  if (next !== OPPOSITE[last] && next !== last && run.queue.length < 3) run.queue.push(next);
  run.phase = 'moving';
  return run;
}

/** Move one step. Returns an answer to save, if food was eaten or she crashed. */
export function tick(run: SnakeRun, pool: GameQuestion[]): { questionId: string; answer: number[] } | null {
  if (run.phase !== 'moving') return null;
  run.dir = run.queue.shift() ?? run.dir;
  const step = VECTORS[run.dir];
  const head = { x: run.snake[0].x + step.x, y: run.snake[0].y + step.y };
  const question = pool.find((q) => q.id === run.questionId);
  if (!question) return null;

  const offBoard = head.x < 0 || head.y < 0 || head.x >= BOARD || head.y >= BOARD;
  const bitten = run.snake.slice(0, -1).some((s) => s.x === head.x && s.y === head.y);
  if (offBoard || bitten) {
    // A crash isn't a wrong answer, so nothing's saved. It costs a heart and the question.
    run.hearts--;
    run.last = { right: false, answer: [], crashed: true };
    run.phase = run.hearts <= 0 ? 'over' : 'feedback';
    return null;
  }

  const eaten = run.foods.find((f) => f.x === head.x && f.y === head.y);
  run.snake.unshift(head);
  if (!eaten) {
    run.snake.pop();
    return null;
  }
  const right = question.correct.includes(eaten.choice);
  if (right) {
    run.right++;
    run.score += POINTS * run.snake.length;
  } else {
    run.wrong++;
    run.hearts--;
    run.snake.pop();
    if (!run.missed.includes(question.id)) run.missed.push(question.id);
  }
  run.last = { right, answer: [eaten.choice], crashed: false };
  run.phase = run.hearts <= 0 ? 'over' : 'feedback';
  return { questionId: question.id, answer: [eaten.choice] };
}

/** On to the next question, with the snake back in the middle if it crashed. */
export function nextQuestion(run: SnakeRun, pool: GameQuestion[]) {
  if (run.phase !== 'feedback') return run;
  if (run.last?.crashed) {
    const length = run.snake.length;
    run.snake = Array.from({ length }, (_, i) => ({ x: 7, y: Math.min(BOARD - 1, 7 + i) }));
    run.dir = 'up';
  }
  run.last = null;
  deal(run, pool);
  return run;
}
