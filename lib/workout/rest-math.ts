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

/** `facts` are the numbers in it (for + and −, the two as shown; for ÷, dividend then divisor; for %, percent then whole). */
export type MathProblem = { text: string; answer: number; op: MathOp; facts: number[] };

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
      return kind < 3 ? { text: `${a} + ${b}`, answer: a + b, op: 'add', facts: [a, b] } : { text: `${a + b} − ${b}`, answer: a, op: 'sub', facts: [a + b, b] };
    }
    case 2: {
      const a = r(6, 19), b = r(3, 12);
      return kind < 2 ? { text: `${a} + ${b}`, answer: a + b, op: 'add', facts: [a, b] } : { text: `${a + b} − ${a}`, answer: b, op: 'sub', facts: [a + b, a] };
    }
    case 3: {
      if (kind < 2) { const a = r(2, 9), b = r(2, 9); return { text: `${a} × ${b}`, answer: a * b, op: 'mul', facts: [a, b] }; }
      const a = r(12, 49), b = r(6, 39);
      return kind === 2 ? { text: `${a} + ${b}`, answer: a + b, op: 'add', facts: [a, b] } : { text: `${a + b} − ${b}`, answer: a, op: 'sub', facts: [a + b, b] };
    }
    case 4: {
      if (kind === 0) { const a = r(3, 12), b = r(6, 12); return { text: `${a} × ${b}`, answer: a * b, op: 'mul', facts: [a, b] }; }
      if (kind === 1) { const a = r(2, 9), b = r(2, 12); return { text: `${a * b} ÷ ${a}`, answer: b, op: 'div', facts: [a * b, a] }; }
      const a = r(24, 89), b = r(13, 59);
      return kind === 2 ? { text: `${a} + ${b}`, answer: a + b, op: 'add', facts: [a, b] } : { text: `${a + b} − ${b}`, answer: a, op: 'sub', facts: [a + b, b] };
    }
    case 5: {
      if (kind === 0) { const a = r(12, 29), b = r(3, 9); return { text: `${a} × ${b}`, answer: a * b, op: 'mul', facts: [a, b] }; }
      if (kind === 1) { const a = r(3, 12), b = r(6, 15); return { text: `${a * b} ÷ ${a}`, answer: b, op: 'div', facts: [a * b, a] }; }
      const a = r(110, 480), b = r(25, 99);
      return kind === 2 ? { text: `${a} + ${b}`, answer: a + b, op: 'add', facts: [a, b] } : { text: `${a} − ${b}`, answer: a - b, op: 'sub', facts: [a, b] };
    }
    case 6: {
      if (kind === 0) { const a = r(13, 49), b = r(4, 9); return { text: `${a} × ${b}`, answer: a * b, op: 'mul', facts: [a, b] }; }
      if (kind === 1) { const a = r(10, 20) * 5; const p = [10, 20, 25, 50][r(0, 3)]; return { text: `${p}% of ${a * 4}`, answer: (a * 4 * p) / 100, op: 'pct', facts: [p, a * 4] }; }
      if (kind === 2) { const a = r(2, 15); return { text: `${a}²`, answer: a * a, op: 'sq', facts: [a] }; }
      const a = r(6, 12), b = r(7, 19); return { text: `${a * b} ÷ ${a}`, answer: b, op: 'div', facts: [a * b, a] };
    }
    case 7: {
      if (kind === 0) { const a = r(11, 19), b = r(11, 19); return { text: `${a} × ${b}`, answer: a * b, op: 'mul', facts: [a, b] }; }
      if (kind === 1) { const a = r(250, 950), b = r(120, Math.min(480, a - 20)); return { text: `${a} − ${b}`, answer: a - b, op: 'sub', facts: [a, b] }; }
      if (kind === 2) { const a = r(3, 9), b = r(2, 9), c = r(2, 9); return { text: `${a} × ${b} + ${c}`, answer: a * b + c, op: 'mixed', facts: [a, b, c] }; }
      const a = r(12, 25); return { text: `${a}²`, answer: a * a, op: 'sq', facts: [a] };
    }
    default: {
      if (kind === 0) { const a = r(12, 39), b = r(12, 29); return { text: `${a} × ${b}`, answer: a * b, op: 'mul', facts: [a, b] }; }
      if (kind === 1) { const a = r(12, 19), b = r(12, 25); return { text: `${a * b} ÷ ${a}`, answer: b, op: 'div', facts: [a * b, a] }; }
      if (kind === 2) { const a = r(4, 12), b = r(5, 12), c = r(11, Math.min(49, a * b - 1)); return { text: `${a} × ${b} − ${c}`, answer: a * b - c, op: 'mixed', facts: [a, b, c] }; }
      const p = [15, 30, 40, 75][r(0, 3)], a = r(2, 12) * 20; return { text: `${p}% of ${a}`, answer: (a * p) / 100, op: 'pct', facts: [p, a] };
    }
  }
}

/**
 * What a problem exercises, for finding the numbers you trip on: each factor of a
 * multiplication (×7), the divisor (÷6), the square (13²), the percent (25%), and
 * whether a sum carries or a difference borrows. Same tag across levels, so
 * "× 7" collects 7 × 8 at level 3 and 17 × 7 at level 6.
 */
export function factTags(op: MathOp, facts: number[]): string[] {
  const [a = 0, b = 0] = facts;
  switch (op) {
    case 'add': return [(a % 10) + (b % 10) >= 10 ? '+carry' : '+plain'];
    case 'sub': return [a % 10 < b % 10 ? '-borrow' : '-plain'];
    case 'mul':
    case 'mixed': return a === b ? [`x${a}`] : [`x${a}`, `x${b}`];
    case 'div': return [`/${b}`];
    case 'sq': return [`sq${a}`];
    case 'pct': return [`${a}%`];
  }
}

/** How a fact tag reads on screen. */
export function factLabel(tag: string): string {
  if (tag === '+carry') return 'Adding with a carry';
  if (tag === '+plain') return 'Adding, no carry';
  if (tag === '-borrow') return 'Subtracting with a borrow';
  if (tag === '-plain') return 'Subtracting, no borrow';
  if (tag.startsWith('x')) return `× ${tag.slice(1)}`;
  if (tag.startsWith('/')) return `÷ ${tag.slice(1)}`;
  if (tag.startsWith('sq')) return `${tag.slice(2)}²`;
  return `${tag} of`;
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
