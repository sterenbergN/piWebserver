import { MATH_OP_LABELS, MATH_OPS, type MathOp } from './rest-math';

// Pure mental-math statistics helpers, shared by the server store and browser.

export type MathOpStat = { right: number; wrong: number; totalMs: number };
export type MathAnswerRecord = { op: MathOp; right: boolean; ms: number };
export type MathStats = {
  sprints: number;
  best: number;
  totalRight: number;
  totalWrong: number;
  totalMs: number;
  byOp: Partial<Record<MathOp, MathOpStat>>;
};

export type MathCategorySummary = {
  op: MathOp;
  label: string;
  attempts: number;
  right: number;
  wrong: number;
  accuracy: number;
  avgMs: number;
};

export type MathStatsSummary = {
  totalAttempts: number;
  accuracy: number | null;
  avgMs: number | null;
  categories: MathCategorySummary[];
  troubleAreas: MathCategorySummary[];
};

const VALID_OPS = new Set<string>(MATH_OPS);
const MIN_ANSWER_MS = 100;
const MAX_ANSWER_MS = 30_000;
const MAX_ANSWERS_PER_SPRINT = 200;

const nonNegInt = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0);

const clampMs = (v: unknown) => {
  const n = typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : MIN_ANSWER_MS;
  return Math.min(MAX_ANSWER_MS, Math.max(MIN_ANSWER_MS, n));
};

export const emptyMathStats = (): MathStats => ({
  sprints: 0,
  best: 0,
  totalRight: 0,
  totalWrong: 0,
  totalMs: 0,
  byOp: {},
});

/** Normalize stored or incoming JSON into a valid MathStats object. */
export function normalizeMathStats(raw: unknown): MathStats {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<MathStats>;
  const byOp: Partial<Record<MathOp, MathOpStat>> = {};
  const rawByOp = r.byOp && typeof r.byOp === 'object' ? (r.byOp as Record<string, unknown>) : {};

  for (const op of MATH_OPS) {
    const entry = rawByOp[op];
    if (!entry || typeof entry !== 'object') continue;
    const e = entry as Partial<MathOpStat>;
    const right = nonNegInt(e.right);
    const wrong = nonNegInt(e.wrong);
    const totalMs = nonNegInt(e.totalMs);
    if (right > 0 || wrong > 0 || totalMs > 0) {
      byOp[op] = { right, wrong, totalMs };
    }
  }

  return {
    sprints: nonNegInt(r.sprints),
    best: nonNegInt(r.best),
    totalRight: nonNegInt(r.totalRight),
    totalWrong: nonNegInt(r.totalWrong),
    totalMs: nonNegInt(r.totalMs),
    byOp,
  };
}

/** Record one completed sprint into stats without mutating `current`. */
export function recordSprintStats(
  current: MathStats,
  input: { score: number; answers: MathAnswerRecord[] },
): MathStats {
  const base = normalizeMathStats(current);
  const safeScore = Math.min(MAX_ANSWERS_PER_SPRINT, nonNegInt(input.score));
  const answers = Array.isArray(input.answers) ? input.answers.slice(0, MAX_ANSWERS_PER_SPRINT) : [];

  const byOp: Partial<Record<MathOp, MathOpStat>> = {};
  for (const op of MATH_OPS) {
    const existing = base.byOp[op];
    if (existing) byOp[op] = { ...existing };
  }

  let addRight = 0;
  let addWrong = 0;
  let addMs = 0;

  for (const item of answers) {
    if (!item || typeof item !== 'object' || typeof item.op !== 'string' || !VALID_OPS.has(item.op)) continue;
    const op = item.op as MathOp;
    const ms = clampMs(item.ms);
    const right = item.right === true;

    const prev = byOp[op] ?? { right: 0, wrong: 0, totalMs: 0 };
    byOp[op] = {
      right: prev.right + (right ? 1 : 0),
      wrong: prev.wrong + (right ? 0 : 1),
      totalMs: prev.totalMs + ms,
    };

    if (right) addRight += 1;
    else addWrong += 1;
    addMs += ms;
  }

  return {
    sprints: base.sprints + 1,
    best: Math.max(base.best, safeScore),
    totalRight: base.totalRight + addRight,
    totalWrong: base.totalWrong + addWrong,
    totalMs: base.totalMs + addMs,
    byOp,
  };
}

/** Compute accuracy, average solve time, per-op breakdown, and trouble areas. */
export function summarizeMathStats(stats: MathStats): MathStatsSummary {
  const totalAttempts = stats.totalRight + stats.totalWrong;
  const accuracy = totalAttempts > 0 ? Math.round((stats.totalRight / totalAttempts) * 100) : null;
  const avgMs = totalAttempts > 0 ? Math.round(stats.totalMs / totalAttempts) : null;

  const categories: MathCategorySummary[] = [];
  for (const op of MATH_OPS) {
    const s = stats.byOp[op];
    if (!s) continue;
    const attempts = s.right + s.wrong;
    if (attempts <= 0) continue;
    categories.push({
      op,
      label: MATH_OP_LABELS[op],
      attempts,
      right: s.right,
      wrong: s.wrong,
      accuracy: Math.round((s.right / attempts) * 100),
      avgMs: Math.round(s.totalMs / attempts),
    });
  }

  const primaryTrouble = categories
    .filter((c) => c.attempts >= 3 && (c.accuracy < 85 || (avgMs !== null && c.avgMs > avgMs * 1.25)))
    .sort((a, b) => a.accuracy - b.accuracy || b.avgMs - a.avgMs);

  const troubleAreas = primaryTrouble.length > 0
    ? primaryTrouble
    : categories
        .filter((c) => c.attempts >= 2 && c.wrong > 0 && c.accuracy < 100)
        .sort((a, b) => a.accuracy - b.accuracy || b.avgMs - a.avgMs)
        .slice(0, 2);

  return { totalAttempts, accuracy, avgMs, categories, troubleAreas };
}
