import test from 'node:test';
import { strict as assert } from 'node:assert';
import { factLabel, factTags, judge, makeProblem, MATH_OPS, MAX_LEVEL, nextLevel, type MathOp } from './rest-math';
import {
  emptyMathStats,
  normalizeMathStats,
  recordSprintStats,
  summarizeMathStats,
} from './rest-math-stats';

// A seeded random, so a failure can be replayed.
function seeded(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
}

function expectedOp(text: string): MathOp {
  if (text.includes('²')) return 'sq';
  if (text.includes('% of')) return 'pct';
  if (text.includes('×') && (text.includes('+') || text.includes('−'))) return 'mixed';
  if (text.includes('×')) return 'mul';
  if (text.includes('÷')) return 'div';
  if (text.includes('+')) return 'add';
  return 'sub';
}

test('every level gives whole answers from 0 up that match the sum shown and tag op', () => {
  const random = seeded(7);
  const seenOps = new Set<MathOp>();
  for (let level = 1; level <= MAX_LEVEL; level++) {
    for (let i = 0; i < 400; i++) {
      const p = makeProblem(level, random);
      assert.ok(MATH_OPS.includes(p.op), `invalid op ${p.op} for ${p.text}`);
      assert.equal(p.op, expectedOp(p.text), `op mismatch for level ${level}: ${p.text}`);
      seenOps.add(p.op);
      assert.ok(Number.isInteger(p.answer) && p.answer >= 0, `level ${level}: ${p.text} = ${p.answer}`);
      const expr = p.text.replace(/×/g, '*').replace(/÷/g, '/').replace(/−/g, '-').replace(/(\d+)²/, '$1*$1').replace(/(\d+)% of (\d+)/, '$1*$2/100');
      assert.equal(Function(`return ${expr}`)(), p.answer, p.text);
    }
  }
  assert.equal(seenOps.size, MATH_OPS.length);
});

test('levels go up after a run of right answers and down after a miss', () => {
  assert.deepEqual(nextLevel(1, 0, true), { level: 1, streak: 1 });
  assert.deepEqual(nextLevel(1, 2, true), { level: 2, streak: 0 });
  assert.deepEqual(nextLevel(3, 2, false), { level: 2, streak: 0 });
  assert.deepEqual(nextLevel(1, 0, false), { level: 1, streak: 0 });
  assert.deepEqual(nextLevel(MAX_LEVEL, 2, true), { level: MAX_LEVEL, streak: 0 });
});

test('judge waits for enough digits', () => {
  assert.equal(judge('1', 12), 'more');
  assert.equal(judge('12', 12), 'right');
  assert.equal(judge('13', 12), 'wrong');
  assert.equal(judge('0', 0), 'right');
});

test('normalizeMathStats validates and clamps fields and ignores unknown ops', () => {
  assert.deepEqual(normalizeMathStats(null), emptyMathStats());
  assert.deepEqual(
    normalizeMathStats({
      sprints: -5,
      best: 14.9,
      totalRight: Number.NaN,
      totalWrong: 3,
      totalMs: 4200.7,
      byOp: {
        add: { right: 5.8, wrong: -2, totalMs: 5000 },
        bogus: { right: 10, wrong: 0, totalMs: 1000 },
      },
    }),
    {
      sprints: 0,
      best: 14,
      totalRight: 0,
      totalWrong: 3,
      totalMs: 4200,
      byOp: {
        add: { right: 5, wrong: 0, totalMs: 5000 },
      },
      peakLevel: 0,
      byLevel: {},
      cells: {},
      recent: [],
    },
  );
  // Level data: bad keys, bad levels and bad sprint logs are dropped.
  const withLevels = normalizeMathStats({
    peakLevel: 12,
    byLevel: { 3: { right: 2, wrong: 1, totalMs: 900 }, 9: { right: 1, wrong: 0, totalMs: 100 } },
    cells: { '3|x7': { right: 1, wrong: 1, totalMs: 600 }, '3|nope': { right: 1, wrong: 0, totalMs: 1 }, '9|x7': { right: 1, wrong: 0, totalMs: 1 } },
    recent: [{ at: '2026-11-20T10:00:00.000Z', score: 12, misses: 2, avgMs: 2500, peakLevel: 4 }, { at: 'never', score: 1 }],
  });
  assert.equal(withLevels.peakLevel, MAX_LEVEL);
  assert.deepEqual(Object.keys(withLevels.byLevel), ['3']);
  assert.deepEqual(Object.keys(withLevels.cells), ['3|x7']);
  assert.equal(withLevels.recent.length, 1);
});

test('recordSprintStats clamps ms, caps answers, and accumulates per-op stats', () => {
  const start = emptyMathStats();
  const after1 = recordSprintStats(start, {
    score: 2,
    answers: [
      { op: 'add', right: true, ms: 20 }, // clamped to 100
      { op: 'div', right: false, ms: 90_000 }, // clamped to 30_000
      { op: 'mul', right: true, ms: 1500 },
    ],
  }, new Date('2026-11-23T12:00:00.000Z'));

  // Does not mutate input.
  assert.deepEqual(start, emptyMathStats());
  assert.deepEqual(after1, {
    sprints: 1,
    best: 2,
    totalRight: 2,
    totalWrong: 1,
    totalMs: 31_600,
    byOp: {
      add: { right: 1, wrong: 0, totalMs: 100 },
      mul: { right: 1, wrong: 0, totalMs: 1500 },
      div: { right: 0, wrong: 1, totalMs: 30_000 },
    },
    // Answers without a level (older clients) still count, just not by level.
    peakLevel: 0,
    byLevel: {},
    cells: {},
    recent: [{ at: '2026-11-23T12:00:00.000Z', score: 2, misses: 1, avgMs: 10_533, peakLevel: 0 }],
  });

  // Caps answers at 200 and score at 200.
  const many = Array.from({ length: 220 }, () => ({ op: 'add' as const, right: true, ms: 500 }));
  const after2 = recordSprintStats(after1, { score: 250, answers: many });
  assert.equal(after2.sprints, 2);
  assert.equal(after2.best, 200);
  assert.equal(after2.totalRight, 202);
  assert.equal(after2.byOp.add?.right, 201);
});

test('summarizeMathStats computes accuracy, avgMs, and troubleAreas', () => {
  let stats = emptyMathStats();
  stats = recordSprintStats(stats, {
    score: 8,
    answers: [
      // add: 5/5 right, 1000ms avg (fast & accurate)
      { op: 'add', right: true, ms: 1000 },
      { op: 'add', right: true, ms: 1000 },
      { op: 'add', right: true, ms: 1000 },
      { op: 'add', right: true, ms: 1000 },
      { op: 'add', right: true, ms: 1000 },
      // div: 2/4 right = 50% (< 85%), 2000ms avg
      { op: 'div', right: true, ms: 2000 },
      { op: 'div', right: false, ms: 2000 },
      { op: 'div', right: true, ms: 2000 },
      { op: 'div', right: false, ms: 2000 },
      // pct: 3/3 right = 100%, 4000ms avg (> 1.25 * overallAvgMs)
      { op: 'pct', right: true, ms: 4000 },
      { op: 'pct', right: true, ms: 4000 },
      { op: 'pct', right: true, ms: 4000 },
    ],
  });

  const summary = summarizeMathStats(stats);
  assert.equal(summary.totalAttempts, 12);
  assert.equal(summary.accuracy, 83); // 10/12 = 83.33 -> 83
  assert.equal(summary.avgMs, 2083); // 25000/12 = 2083.33 -> 2083
  assert.deepEqual(summary.categories.map((c) => c.op), ['add', 'div', 'pct']);
  // div has 50% accuracy, pct is 100% but slow (4000 > 2083 * 1.25 = 2603.75)
  assert.deepEqual(summary.troubleAreas.map((t) => t.op), ['div', 'pct']);

  // Fallback when no category hits primary threshold (e.g. attempts < 3 but >= 2 with wrong > 0)
  const smallStats = recordSprintStats(emptyMathStats(), {
    score: 3,
    answers: [
      { op: 'add', right: true, ms: 1000 },
      { op: 'add', right: true, ms: 1000 },
      { op: 'sub', right: true, ms: 1000 },
      { op: 'sub', right: false, ms: 1000 },
      { op: 'mul', right: true, ms: 1000 },
      { op: 'mul', right: false, ms: 1000 },
      { op: 'div', right: true, ms: 1000 },
      { op: 'div', right: false, ms: 1200 },
    ],
  });
  const smallSummary = summarizeMathStats(smallStats);
  // 3 categories with 50% accuracy (sub, mul, div) -> sorted by lowest accuracy then slowest avgMs, capped at 2 -> div (1100ms), sub/mul
  assert.equal(smallSummary.troubleAreas.length, 2);
  assert.equal(smallSummary.troubleAreas[0].op, 'div');
});

test('factTags names what a problem exercises, and makeProblem tags every problem', () => {
  assert.deepEqual(factTags('mul', [7, 8]), ['x7', 'x8']);
  assert.deepEqual(factTags('mul', [12, 12]), ['x12']);
  assert.deepEqual(factTags('div', [42, 6]), ['/6']);
  assert.deepEqual(factTags('add', [17, 25]), ['+carry']);
  assert.deepEqual(factTags('add', [12, 31]), ['+plain']);
  assert.deepEqual(factTags('sub', [42, 17]), ['-borrow']);
  assert.deepEqual(factTags('sq', [13]), ['sq13']);
  assert.deepEqual(factTags('pct', [25, 80]), ['25%']);
  assert.equal(factLabel('x7'), '× 7');
  assert.equal(factLabel('sq13'), '13²');
  const random = seeded(7);
  for (let level = 1; level <= MAX_LEVEL; level++) {
    for (let i = 0; i < 50; i++) {
      const p = makeProblem(level, random);
      assert.ok(p.facts.length >= 1, p.text);
      assert.ok(factTags(p.op, p.facts).length >= 1, p.text);
    }
  }
});

test('stats track levels and judge operations and numbers against the same levels', () => {
  const at = (level: number, op: MathOp, facts: number[], right: boolean, ms: number) => ({ op, right, ms, level, facts });
  const answers = [
    // Level 3: additions all right and quick; × 7 goes badly, × 3 fine.
    ...Array.from({ length: 6 }, () => at(3, 'add', [21, 14], true, 1500)),
    at(3, 'mul', [7, 8], false, 5000),
    at(3, 'mul', [6, 7], false, 4800),
    at(3, 'mul', [7, 4], true, 4200),
    at(3, 'mul', [3, 5], true, 1400),
    at(3, 'mul', [3, 4], true, 1300),
    at(3, 'mul', [3, 2], true, 1200),
    // Level 6: everything is slower and less sure, so division at 50% there is normal.
    ...Array.from({ length: 4 }, (_, i) => at(6, 'sq', [13], i < 2, 6000)),
    ...Array.from({ length: 4 }, (_, i) => at(6, 'div', [91, 7], i < 2, 6000)),
  ];
  const stats = recordSprintStats(emptyMathStats(), { score: 14, answers });
  assert.equal(stats.peakLevel, 6);
  assert.deepEqual(stats.byLevel['3'], { right: 10, wrong: 2, totalMs: 9000 + 17_900 });
  assert.deepEqual(stats.cells['3|x7'], { right: 1, wrong: 2, totalMs: 14_000 });

  const summary = summarizeMathStats(stats);
  assert.equal(summary.levelAdjusted, true);
  assert.deepEqual(summary.levels.map((l) => [l.level, l.attempts, l.accuracy]), [[3, 12, 83], [6, 8, 50]]);
  // Raw accuracy would flag division (50%); next to other level-6 answers it's ordinary.
  assert.ok(!summary.troubleAreas.some((t) => t.op === 'div'));
  assert.ok(summary.troubleAreas.some((t) => t.op === 'mul'));
  const div = summary.categories.find((c) => c.op === 'div')!;
  assert.equal(div.expectedAccuracy, 50);
  // × 7 is the number that trips you up; × 3 isn't listed.
  assert.equal(summary.troubleFacts[0].tag, 'x7');
  assert.equal(summary.troubleFacts[0].accuracy, 33);
  assert.ok(!summary.troubleFacts.some((f) => f.tag === 'x3'));
  assert.equal(summary.trend, null);
});

test('the last sprints are kept for a trend', () => {
  let stats = emptyMathStats();
  for (let i = 0; i < 35; i++) {
    stats = recordSprintStats(stats, { score: i < 30 ? 10 : 20, answers: [{ op: 'add', right: true, ms: 1000, level: 2, facts: [3, 4] }] });
  }
  assert.equal(stats.recent.length, 30);
  assert.deepEqual(summarizeMathStats(stats).trend, { recent: 20, before: 10 });
});
