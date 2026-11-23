// Mental arithmetic for a 60-second sprint. Answers are always whole numbers
// from 0 up, so the keypad needs only digits. Levels run 1–8: a few right in a
// row moves up, a miss moves down.

export type MathOp = 'add' | 'sub' | 'mul' | 'div' | 'pct' | 'sq' | 'mixed';

export const MATH_OPS: MathOp[] = ['add', 'sub', 'mul', 'div', 'pct', 'sq', 'mixed'];

export const MATH_OP_LABELS: Record<MathOp, string> = {
  add: 'Addition',
  sub: 'Subtraction',
  mul: 'Multiplication',
  div: 'Division',
  pct: 'Percentages',
  sq: 'Squares',
  mixed: 'Mixed',
};

export type MathProblem = { text: string; answer: number; op: MathOp };

export const MAX_LEVEL = 8;
export const SPRINT_SECONDS = 60;
/** Right answers in a row to go up a level. */
export const STREAK_UP = 3;

const int = (random: () => number, lo: number, hi: number) => lo + Math.floor(random() * (hi - lo + 1));

export function makeProblem(level: number, random: () => number = Math.random): MathProblem {
  const r = (lo: number, hi: number) => int(random, lo, hi);
  const kind = r(0, 3);
  switch (Math.max(1, Math.min(MAX_LEVEL, Math.round(level)))) {
    case 1: {
      const a = r(1, 9), b = r(1, 9);
      return kind < 3 ? { text: `${a} + ${b}`, answer: a + b, op: 'add' } : { text: `${a + b} − ${b}`, answer: a, op: 'sub' };
    }
    case 2: {
      const a = r(6, 19), b = r(3, 12);
      return kind < 2 ? { text: `${a} + ${b}`, answer: a + b, op: 'add' } : { text: `${a + b} − ${a}`, answer: b, op: 'sub' };
    }
    case 3: {
      if (kind < 2) { const a = r(2, 9), b = r(2, 9); return { text: `${a} × ${b}`, answer: a * b, op: 'mul' }; }
      const a = r(12, 49), b = r(6, 39);
      return kind === 2 ? { text: `${a} + ${b}`, answer: a + b, op: 'add' } : { text: `${a + b} − ${b}`, answer: a, op: 'sub' };
    }
    case 4: {
      if (kind === 0) { const a = r(3, 12), b = r(6, 12); return { text: `${a} × ${b}`, answer: a * b, op: 'mul' }; }
      if (kind === 1) { const a = r(2, 9), b = r(2, 12); return { text: `${a * b} ÷ ${a}`, answer: b, op: 'div' }; }
      const a = r(24, 89), b = r(13, 59);
      return kind === 2 ? { text: `${a} + ${b}`, answer: a + b, op: 'add' } : { text: `${a + b} − ${b}`, answer: a, op: 'sub' };
    }
    case 5: {
      if (kind === 0) { const a = r(12, 29), b = r(3, 9); return { text: `${a} × ${b}`, answer: a * b, op: 'mul' }; }
      if (kind === 1) { const a = r(3, 12), b = r(6, 15); return { text: `${a * b} ÷ ${a}`, answer: b, op: 'div' }; }
      const a = r(110, 480), b = r(25, 99);
      return kind === 2 ? { text: `${a} + ${b}`, answer: a + b, op: 'add' } : { text: `${a} − ${b}`, answer: a - b, op: 'sub' };
    }
    case 6: {
      if (kind === 0) { const a = r(13, 49), b = r(4, 9); return { text: `${a} × ${b}`, answer: a * b, op: 'mul' }; }
      if (kind === 1) { const a = r(10, 20) * 5; const p = [10, 20, 25, 50][r(0, 3)]; return { text: `${p}% of ${a * 4}`, answer: (a * 4 * p) / 100, op: 'pct' }; }
      if (kind === 2) { const a = r(2, 15); return { text: `${a}²`, answer: a * a, op: 'sq' }; }
      const a = r(6, 12), b = r(7, 19); return { text: `${a * b} ÷ ${a}`, answer: b, op: 'div' };
    }
    case 7: {
      if (kind === 0) { const a = r(11, 19), b = r(11, 19); return { text: `${a} × ${b}`, answer: a * b, op: 'mul' }; }
      if (kind === 1) { const a = r(250, 950), b = r(120, Math.min(480, a - 20)); return { text: `${a} − ${b}`, answer: a - b, op: 'sub' }; }
      if (kind === 2) { const a = r(3, 9), b = r(2, 9), c = r(2, 9); return { text: `${a} × ${b} + ${c}`, answer: a * b + c, op: 'mixed' }; }
      const a = r(12, 25); return { text: `${a}²`, answer: a * a, op: 'sq' };
    }
    default: {
      if (kind === 0) { const a = r(12, 39), b = r(12, 29); return { text: `${a} × ${b}`, answer: a * b, op: 'mul' }; }
      if (kind === 1) { const a = r(12, 19), b = r(12, 25); return { text: `${a * b} ÷ ${a}`, answer: b, op: 'div' }; }
      if (kind === 2) { const a = r(4, 12), b = r(5, 12), c = r(11, Math.min(49, a * b - 1)); return { text: `${a} × ${b} − ${c}`, answer: a * b - c, op: 'mixed' }; }
      const p = [15, 30, 40, 75][r(0, 3)], a = r(2, 12) * 20; return { text: `${p}% of ${a}`, answer: (a * p) / 100, op: 'pct' };
    }
  }
}

/** The level after an answer, and the run of right answers so far. */
export function nextLevel(level: number, streak: number, right: boolean): { level: number; streak: number } {
  if (!right) return { level: Math.max(1, level - 1), streak: 0 };
  const run = streak + 1;
  return run >= STREAK_UP ? { level: Math.min(MAX_LEVEL, level + 1), streak: 0 } : { level, streak: run };
}

/** Checked once enough digits are typed: right, wrong, or keep typing. */
export function judge(typed: string, answer: number): 'right' | 'wrong' | 'more' {
  if (typed === String(answer)) return 'right';
  return typed.length >= String(answer).length ? 'wrong' : 'more';
}
