import { factLabel, factTags, GRID_MAX, MATH_OP_LABELS, MATH_OPS, MAX_LEVEL, pairOf, type DrillTarget, type MathOp } from './rest-math';

// Pure mental-math statistics helpers, shared by the server store and browser.
//
// Problems get harder as the level climbs, so raw accuracy per operation mostly
// says which levels you spend time at. Each answer is also filed by its level
// and by what it exercised (× 7, ÷ 6, a carry…), so an operation or a number
// can be measured against everything else you answered at the same levels.

export type MathOpStat = { right: number; wrong: number; totalMs: number };
export type MathAnswerRecord = {
  op: MathOp;
  right: boolean;
  ms: number;
  level?: number;
  facts?: number[];
  /** The problem as shown ("17 × 8"), its answer, and what was typed when it was wrong ('' for a skip). */
  text?: string;
  answer?: number;
  typed?: string;
};
/** One problem as you've met it: how it went, and your last wrong answer. */
export type MathProblemStat = MathOpStat & { answer: number; lastWrong?: string; seen: number };
/** One finished sprint, for the trend. */
export type MathSprintLog = { at: string; score: number; misses: number; avgMs: number; peakLevel: number };
export type MathStats = {
  sprints: number;
  best: number;
  totalRight: number;
  totalWrong: number;
  totalMs: number;
  byOp: Partial<Record<MathOp, MathOpStat>>;
  /** Highest level ever reached. */
  peakLevel: number;
  /** Keyed by level ("1"–"8"). Only answers recorded since levels were tracked. */
  byLevel: Record<string, MathOpStat>;
  /** Keyed `${level}|op:${op}` or `${level}|${fact tag}`, for level-adjusted comparisons. */
  cells: Record<string, MathOpStat>;
  /** The last sprints, oldest first. */
  recent: MathSprintLog[];
  /** Times-table facts, keyed "7x8" (smaller first, 2–20), whether met as ×, ÷ or in a mixed problem. */
  pairs: Record<string, MathOpStat>;
  /** Problems by their text ("17 × 8"), the most recently seen kept. */
  problems: Record<string, MathProblemStat>;
  /** Drills done (they're practice: not in best, sprints or the trend). */
  drills: number;
};

export type MathCategorySummary = {
  op: MathOp;
  label: string;
  attempts: number;
  right: number;
  wrong: number;
  accuracy: number;
  avgMs: number;
  /** What the rest of your answers at the same levels scored, or null without enough to compare. */
  expectedAccuracy: number | null;
  expectedMs: number | null;
};

export type MathLevelSummary = { level: number; attempts: number; accuracy: number; avgMs: number };

export type MathFactSummary = {
  tag: string;
  label: string;
  attempts: number;
  accuracy: number;
  avgMs: number;
  expectedAccuracy: number;
  expectedMs: number;
  /** Lowest and highest level it came up at. */
  levels: [number, number];
};

export type MathStatsSummary = {
  totalAttempts: number;
  accuracy: number | null;
  avgMs: number | null;
  categories: MathCategorySummary[];
  troubleAreas: MathCategorySummary[];
  /** True when trouble areas were judged against your level rather than raw numbers. */
  levelAdjusted: boolean;
  levels: MathLevelSummary[];
  peakLevel: number;
  /** Numbers and kinds of problem that go worse than the rest at the same level, worst first. */
  troubleFacts: MathFactSummary[];
  /** Average score of the last five sprints against the five before, once there are ten. */
  trend: { recent: number; before: number } | null;
  recent: MathSprintLog[];
};

const VALID_OPS = new Set<string>(MATH_OPS);
const MIN_ANSWER_MS = 100;
const MAX_ANSWER_MS = 30_000;
const MAX_ANSWERS_PER_SPRINT = 200;
const MAX_CELLS = 1000;
const RECENT_KEPT = 200;
const MAX_PROBLEMS = 400;
const PAIR_KEY = /^(\d{1,2})x(\d{1,2})$/;
const PROBLEM_TEXT = /^[0-9 ×÷+−%²of]{1,40}$/u;
const pairKey = (pair: [number, number]) => `${pair[0]}x${pair[1]}`;
const validPairKey = (key: string) => {
  const m = key.match(PAIR_KEY);
  if (!m) return false;
  const a = Number(m[1]), b = Number(m[2]);
  return a >= 2 && a <= b && b <= GRID_MAX;
};
/** Fewer answers than this at a level (outside the one being judged) and there's nothing fair to compare with. */
const MIN_COMPARE = 3;
const CELL_KEY = /^([1-8])\|(op:(add|sub|mul|div|pct|sq|mixed)|\+carry|\+plain|-borrow|-plain|x\d{1,4}|\/\d{1,4}|sq\d{1,4}|\d{1,3}%)$/;

const nonNegInt = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0);

const clampMs = (v: unknown) => {
  const n = typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : MIN_ANSWER_MS;
  return Math.min(MAX_ANSWER_MS, Math.max(MIN_ANSWER_MS, n));
};

const validLevel = (v: unknown): number | null => (typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= MAX_LEVEL ? v : null);

const validFacts = (v: unknown): number[] | null =>
  Array.isArray(v) && v.length >= 1 && v.length <= 3 && v.every((n) => typeof n === 'number' && Number.isInteger(n) && n >= 0 && n < 10_000) ? v : null;

function normalizeStat(entry: unknown): MathOpStat | null {
  if (!entry || typeof entry !== 'object') return null;
  const e = entry as Partial<MathOpStat>;
  const stat = { right: nonNegInt(e.right), wrong: nonNegInt(e.wrong), totalMs: nonNegInt(e.totalMs) };
  return stat.right > 0 || stat.wrong > 0 || stat.totalMs > 0 ? stat : null;
}

const add = (map: Record<string, MathOpStat>, key: string, right: boolean, ms: number) => {
  const prev = map[key] ?? { right: 0, wrong: 0, totalMs: 0 };
  map[key] = { right: prev.right + (right ? 1 : 0), wrong: prev.wrong + (right ? 0 : 1), totalMs: prev.totalMs + ms };
};

export const emptyMathStats = (): MathStats => ({
  sprints: 0,
  best: 0,
  totalRight: 0,
  totalWrong: 0,
  totalMs: 0,
  byOp: {},
  peakLevel: 0,
  byLevel: {},
  cells: {},
  recent: [],
  pairs: {},
  problems: {},
  drills: 0,
});

/** Normalize stored or incoming JSON into a valid MathStats object. */
export function normalizeMathStats(raw: unknown): MathStats {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<MathStats>;
  const byOp: Partial<Record<MathOp, MathOpStat>> = {};
  const rawByOp = r.byOp && typeof r.byOp === 'object' ? (r.byOp as Record<string, unknown>) : {};
  for (const op of MATH_OPS) {
    const stat = normalizeStat(rawByOp[op]);
    if (stat) byOp[op] = stat;
  }

  const byLevel: Record<string, MathOpStat> = {};
  const rawByLevel = r.byLevel && typeof r.byLevel === 'object' ? (r.byLevel as Record<string, unknown>) : {};
  for (let level = 1; level <= MAX_LEVEL; level++) {
    const stat = normalizeStat(rawByLevel[String(level)]);
    if (stat) byLevel[String(level)] = stat;
  }

  const cells: Record<string, MathOpStat> = {};
  const rawCells = r.cells && typeof r.cells === 'object' ? (r.cells as Record<string, unknown>) : {};
  for (const key of Object.keys(rawCells).slice(0, MAX_CELLS)) {
    if (!CELL_KEY.test(key)) continue;
    const stat = normalizeStat(rawCells[key]);
    if (stat) cells[key] = stat;
  }

  const recent: MathSprintLog[] = (Array.isArray(r.recent) ? r.recent : []).flatMap((entry: unknown) => {
    if (!entry || typeof entry !== 'object') return [];
    const e = entry as Partial<MathSprintLog>;
    if (typeof e.at !== 'string' || Number.isNaN(Date.parse(e.at))) return [];
    return [{ at: e.at, score: nonNegInt(e.score), misses: nonNegInt(e.misses), avgMs: nonNegInt(e.avgMs), peakLevel: Math.min(MAX_LEVEL, nonNegInt(e.peakLevel)) }];
  }).slice(-RECENT_KEPT);

  const pairs: Record<string, MathOpStat> = {};
  const rawPairs = r.pairs && typeof r.pairs === 'object' ? (r.pairs as Record<string, unknown>) : {};
  for (const key of Object.keys(rawPairs)) {
    if (!validPairKey(key)) continue;
    const stat = normalizeStat(rawPairs[key]);
    if (stat) pairs[key] = stat;
  }

  const problems: Record<string, MathProblemStat> = {};
  const rawProblems = r.problems && typeof r.problems === 'object' ? (r.problems as Record<string, unknown>) : {};
  for (const text of Object.keys(rawProblems).slice(0, MAX_PROBLEMS)) {
    if (!PROBLEM_TEXT.test(text)) continue;
    const stat = normalizeStat(rawProblems[text]);
    const p = rawProblems[text] as Partial<MathProblemStat>;
    if (!stat || typeof p.answer !== 'number' || !Number.isFinite(p.answer)) continue;
    problems[text] = { ...stat, answer: p.answer, seen: nonNegInt(p.seen), ...(typeof p.lastWrong === 'string' && /^\d{0,8}$/.test(p.lastWrong) ? { lastWrong: p.lastWrong } : {}) };
  }

  return {
    sprints: nonNegInt(r.sprints),
    best: nonNegInt(r.best),
    totalRight: nonNegInt(r.totalRight),
    totalWrong: nonNegInt(r.totalWrong),
    totalMs: nonNegInt(r.totalMs),
    byOp,
    peakLevel: Math.min(MAX_LEVEL, nonNegInt(r.peakLevel)),
    byLevel,
    cells,
    recent,
    pairs,
    problems,
    drills: nonNegInt(r.drills),
  };
}

/** Record one completed sprint into stats without mutating `current`. */
export function recordSprintStats(
  current: MathStats,
  input: { score: number; answers: MathAnswerRecord[]; mode?: 'sprint' | 'drill' },
  now: Date = new Date(),
): MathStats {
  const drill = input.mode === 'drill';
  const base = normalizeMathStats(current);
  const safeScore = Math.min(MAX_ANSWERS_PER_SPRINT, nonNegInt(input.score));
  const answers = Array.isArray(input.answers) ? input.answers.slice(0, MAX_ANSWERS_PER_SPRINT) : [];

  const byOp = { ...base.byOp } as Record<string, MathOpStat>;
  const byLevel = { ...base.byLevel };
  const cells = { ...base.cells };
  const cellCount = () => Object.keys(cells).length;
  const pairs = { ...base.pairs };
  const problems = { ...base.problems };
  // A counter rather than a time, so the order stays right whatever the clock says.
  let seen = Math.max(0, ...Object.values(problems).map((p) => p.seen));

  let addRight = 0;
  let addWrong = 0;
  let addMs = 0;
  let sprintPeak = 0;

  for (const item of answers) {
    if (!item || typeof item !== 'object' || typeof item.op !== 'string' || !VALID_OPS.has(item.op)) continue;
    const op = item.op as MathOp;
    const ms = clampMs(item.ms);
    const right = item.right === true;

    add(byOp, op, right, ms);
    if (right) addRight += 1;
    else addWrong += 1;
    addMs += ms;

    const facts = validFacts(item.facts);
    const pair = facts ? pairOf(op, facts) : null;
    if (pair) add(pairs, pairKey(pair), right, ms);
    if (typeof item.text === 'string' && PROBLEM_TEXT.test(item.text) && typeof item.answer === 'number' && Number.isFinite(item.answer)) {
      const prev = problems[item.text];
      const typed = typeof item.typed === 'string' && /^\d{0,8}$/.test(item.typed) ? item.typed : undefined;
      problems[item.text] = {
        right: (prev?.right ?? 0) + (right ? 1 : 0),
        wrong: (prev?.wrong ?? 0) + (right ? 0 : 1),
        totalMs: (prev?.totalMs ?? 0) + ms,
        answer: item.answer,
        seen: ++seen,
        ...(right ? (prev?.lastWrong !== undefined ? { lastWrong: prev.lastWrong } : {}) : typed !== undefined ? { lastWrong: typed } : {}),
      };
    }

    const level = validLevel(item.level);
    if (level === null) continue;
    sprintPeak = Math.max(sprintPeak, level);
    add(byLevel, String(level), right, ms);
    const keys = [`op:${op}`, ...(facts ? factTags(op, facts) : [])].map((k) => `${level}|${k}`);
    for (const key of keys) {
      if (!CELL_KEY.test(key) || (!cells[key] && cellCount() >= MAX_CELLS)) continue;
      add(cells, key, right, ms);
    }
  }

  const answered = addRight + addWrong;
  const log: MathSprintLog = {
    at: now.toISOString(),
    score: safeScore,
    misses: addWrong,
    avgMs: answered ? Math.round(addMs / answered) : 0,
    peakLevel: sprintPeak,
  };

  // Keep the most recently seen problems.
  const problemTexts = Object.keys(problems);
  if (problemTexts.length > MAX_PROBLEMS) {
    for (const text of problemTexts.sort((a, b) => problems[a].seen - problems[b].seen).slice(0, problemTexts.length - MAX_PROBLEMS)) delete problems[text];
  }

  if (drill) {
    return { ...base, totalRight: base.totalRight + addRight, totalWrong: base.totalWrong + addWrong, totalMs: base.totalMs + addMs, byOp: byOp as Partial<Record<MathOp, MathOpStat>>, pairs, problems, drills: base.drills + 1 };
  }

  return {
    sprints: base.sprints + 1,
    best: Math.max(base.best, safeScore),
    totalRight: base.totalRight + addRight,
    totalWrong: base.totalWrong + addWrong,
    totalMs: base.totalMs + addMs,
    byOp: byOp as Partial<Record<MathOp, MathOpStat>>,
    peakLevel: Math.max(base.peakLevel, sprintPeak),
    byLevel,
    cells,
    recent: [...base.recent, log].slice(-RECENT_KEPT),
    pairs,
    problems,
    drills: base.drills,
  };
}

type Compared = { attempts: number; right: number; totalMs: number; expRight: number; expMs: number; minLevel: number; maxLevel: number };

/**
 * One key's answers next to what everything else at the same levels scored,
 * weighted by how often the key came up at each level. Levels where too little
 * else was answered are left out of both sides.
 */
function compareAtLevels(stats: MathStats, key: string): Compared | null {
  const out: Compared = { attempts: 0, right: 0, totalMs: 0, expRight: 0, expMs: 0, minLevel: MAX_LEVEL, maxLevel: 0 };
  for (let level = 1; level <= MAX_LEVEL; level++) {
    const cell = stats.cells[`${level}|${key}`];
    const all = stats.byLevel[String(level)];
    if (!cell || !all) continue;
    const n = cell.right + cell.wrong;
    const othersN = all.right + all.wrong - n;
    if (n === 0 || othersN < MIN_COMPARE) continue;
    out.attempts += n;
    out.right += cell.right;
    out.totalMs += cell.totalMs;
    out.expRight += (n * (all.right - cell.right)) / othersN;
    out.expMs += (n * (all.totalMs - cell.totalMs)) / othersN;
    out.minLevel = Math.min(out.minLevel, level);
    out.maxLevel = Math.max(out.maxLevel, level);
  }
  return out.attempts > 0 ? out : null;
}

/** How much worse than expected (accuracy points, plus 20 per 100% slower). Above 0 is worse. */
const shortfall = (accuracy: number, avgMs: number, expAcc: number, expMs: number) => (expAcc - accuracy) + 20 * (avgMs / Math.max(1, expMs) - 1);
const struggles = (accuracy: number, avgMs: number, expAcc: number, expMs: number) => accuracy < expAcc - 10 || avgMs > expMs * 1.3;

/** Compute accuracy, average solve time, per-op and per-level breakdowns, trouble areas and trouble numbers. */
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
    const cmp = compareAtLevels(stats, `op:${op}`);
    const fair = cmp && cmp.attempts >= MIN_COMPARE ? cmp : null;
    categories.push({
      op,
      label: MATH_OP_LABELS[op],
      attempts,
      right: s.right,
      wrong: s.wrong,
      accuracy: Math.round((s.right / attempts) * 100),
      avgMs: Math.round(s.totalMs / attempts),
      expectedAccuracy: fair ? Math.round((fair.expRight / fair.attempts) * 100) : null,
      expectedMs: fair ? Math.round(fair.expMs / fair.attempts) : null,
    });
  }

  // Level-adjusted once there's level data to go on: an operation is trouble when it goes worse than
  // the other problems at the levels it came up at (its own answers since levels were tracked).
  const adjusted = categories.flatMap((c) => {
    const cmp = compareAtLevels(stats, `op:${c.op}`);
    if (!cmp || cmp.attempts < MIN_COMPARE) return [];
    const acc = (cmp.right / cmp.attempts) * 100;
    const ms = cmp.totalMs / cmp.attempts;
    const expAcc = (cmp.expRight / cmp.attempts) * 100;
    const expMs = cmp.expMs / cmp.attempts;
    return struggles(acc, ms, expAcc, expMs) ? [{ c, score: shortfall(acc, ms, expAcc, expMs) }] : [];
  });
  const levelAdjusted = categories.some((c) => c.expectedAccuracy !== null);

  let troubleAreas: MathCategorySummary[];
  if (levelAdjusted) {
    troubleAreas = adjusted.sort((a, b) => b.score - a.score).map((t) => t.c);
  } else {
    const primaryTrouble = categories
      .filter((c) => c.attempts >= 3 && (c.accuracy < 85 || (avgMs !== null && c.avgMs > avgMs * 1.25)))
      .sort((a, b) => a.accuracy - b.accuracy || b.avgMs - a.avgMs);
    troubleAreas = primaryTrouble.length > 0
      ? primaryTrouble
      : categories
          .filter((c) => c.attempts >= 2 && c.wrong > 0 && c.accuracy < 100)
          .sort((a, b) => a.accuracy - b.accuracy || b.avgMs - a.avgMs)
          .slice(0, 2);
  }

  const levels: MathLevelSummary[] = [];
  for (let level = 1; level <= MAX_LEVEL; level++) {
    const s = stats.byLevel[String(level)];
    if (!s) continue;
    const attempts = s.right + s.wrong;
    if (attempts > 0) levels.push({ level, attempts, accuracy: Math.round((s.right / attempts) * 100), avgMs: Math.round(s.totalMs / attempts) });
  }

  const tags = new Set(Object.keys(stats.cells).map((k) => k.split('|')[1]).filter((t) => !t.startsWith('op:')));
  const troubleFacts = [...tags].flatMap((tag) => {
    const cmp = compareAtLevels(stats, tag);
    if (!cmp || cmp.attempts < MIN_COMPARE) return [];
    const acc = (cmp.right / cmp.attempts) * 100;
    const ms = cmp.totalMs / cmp.attempts;
    const expAcc = (cmp.expRight / cmp.attempts) * 100;
    const expMs = cmp.expMs / cmp.attempts;
    if (!struggles(acc, ms, expAcc, expMs)) return [];
    const fact: MathFactSummary = {
      tag,
      label: factLabel(tag),
      attempts: cmp.attempts,
      accuracy: Math.round(acc),
      avgMs: Math.round(ms),
      expectedAccuracy: Math.round(expAcc),
      expectedMs: Math.round(expMs),
      levels: [cmp.minLevel, cmp.maxLevel],
    };
    return [{ fact, score: shortfall(acc, ms, expAcc, expMs) }];
  }).sort((a, b) => b.score - a.score).slice(0, 6).map((t) => t.fact);

  const scores = stats.recent.map((r) => r.score);
  const mean = (xs: number[]) => Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10;
  const trend = scores.length >= 10 ? { recent: mean(scores.slice(-5)), before: mean(scores.slice(-10, -5)) } : null;

  return {
    totalAttempts,
    accuracy,
    avgMs,
    categories,
    troubleAreas,
    levelAdjusted,
    levels,
    peakLevel: stats.peakLevel,
    troubleFacts,
    trend,
    recent: stats.recent,
  };
}

// ── Times table, progress, problems and drills ─────────────────────────────────

export type GridCell = { a: number; b: number; attempts: number; accuracy: number; avgMs: number };

/** The times-table grid: 2–12, or further when you've met bigger facts. Cells keyed "7x8" (smaller first). */
export function timesGrid(stats: MathStats): { max: number; cells: Record<string, GridCell>; avgMs: number | null } {
  const cells: Record<string, GridCell> = {};
  let max = 12;
  let total = 0, ms = 0;
  for (const [key, s] of Object.entries(stats.pairs)) {
    const [a, b] = key.split('x').map(Number);
    const attempts = s.right + s.wrong;
    if (!attempts) continue;
    max = Math.max(max, b);
    total += attempts;
    ms += s.totalMs;
    cells[key] = { a, b, attempts, accuracy: Math.round((s.right / attempts) * 100), avgMs: Math.round(s.totalMs / attempts) };
  }
  return { max: Math.min(GRID_MAX, max), cells, avgMs: total ? Math.round(ms / total) : null };
}

export type WeekProgress = { week: string; sprints: number; avgScore: number; accuracy: number; avgMs: number; topLevel: number };

/** Monday of the week a time falls in, as YYYY-MM-DD (local time). */
export function weekOf(iso: string): string {
  const d = new Date(iso);
  d.setHours(12, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Sprints by week, oldest first. */
export function weeklyProgress(stats: MathStats): WeekProgress[] {
  const weeks = new Map<string, MathSprintLog[]>();
  for (const r of stats.recent) {
    const key = weekOf(r.at);
    weeks.set(key, [...(weeks.get(key) ?? []), r]);
  }
  return [...weeks.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([week, list]) => {
    const right = list.reduce((sum, r) => sum + r.score, 0);
    const wrong = list.reduce((sum, r) => sum + r.misses, 0);
    const answered = right + wrong;
    return {
      week,
      sprints: list.length,
      avgScore: Math.round((right / list.length) * 10) / 10,
      accuracy: answered ? Math.round((right / answered) * 100) : 0,
      avgMs: answered ? Math.round(list.reduce((sum, r) => sum + r.avgMs * (r.score + r.misses), 0) / answered) : 0,
      topLevel: Math.max(0, ...list.map((r) => r.peakLevel)),
    };
  });
}

export type ProblemSummary = { text: string; answer: number; attempts: number; wrong: number; avgMs: number; lastWrong?: string };

/** The problems you miss most and the ones that take longest. */
export function problemHistory(stats: MathStats, limit = 8): { mostMissed: ProblemSummary[]; slowest: ProblemSummary[] } {
  const all: ProblemSummary[] = Object.entries(stats.problems).map(([text, p]) => ({
    text, answer: p.answer, attempts: p.right + p.wrong, wrong: p.wrong, avgMs: Math.round(p.totalMs / Math.max(1, p.right + p.wrong)), lastWrong: p.lastWrong,
  }));
  return {
    mostMissed: all.filter((p) => p.wrong > 0).sort((a, b) => b.wrong / b.attempts - a.wrong / a.attempts || b.wrong - a.wrong || b.avgMs - a.avgMs).slice(0, limit),
    // Right answers only count as slow; a miss is already in the other list.
    slowest: all.filter((p) => p.attempts > p.wrong).sort((a, b) => b.avgMs - a.avgMs).slice(0, limit),
  };
}

/**
 * What a drill should aim at: times-table facts and kinds of problem that go worse
 * than your usual, weighted by how much. Empty until there's something to go on.
 */
export function drillTargets(stats: MathStats): DrillTarget[] {
  const grid = timesGrid(stats);
  const targets: DrillTarget[] = [];
  for (const cell of Object.values(grid.cells)) {
    const slow = grid.avgMs ? cell.avgMs / grid.avgMs - 1 : 0;
    const weight = (100 - cell.accuracy) / 25 + Math.max(0, slow) * 2;
    if (cell.accuracy < 90 || slow > 0.3) targets.push({ pair: [cell.a, cell.b], weight: Math.max(0.5, weight) });
  }
  for (const fact of summarizeMathStats(stats).troubleFacts) {
    const weight = Math.max(0.5, (fact.expectedAccuracy - fact.accuracy) / 20 + Math.max(0, fact.avgMs / Math.max(1, fact.expectedMs) - 1) * 2);
    targets.push({ tag: fact.tag, weight });
  }
  return targets;
}
