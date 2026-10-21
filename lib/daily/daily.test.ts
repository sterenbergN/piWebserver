import test from 'node:test';
import { strict as assert } from 'node:assert';
import { validateDay, validatePack } from './validate';
import { gradeQuestion, isPartCorrect, parseResponses, publicDay } from './grade';
import { attemptMeta, attemptXp, questionStats, questionStreak, scoreAll, type Attempt } from './progress';
import type { Question } from './types';

function question(overrides: Partial<Question> = {}): any {
  return {
    id: 'q1', track: 'mechanical', topic: 'Statics', difficulty: 2, title: 'Beam reaction',
    prompt: 'A beam carries $P = 10\\,\\text{kN}$. Find $R_A$.',
    parts: [{ id: 'a', answer: { type: 'numeric', value: 6, unit: 'kN' }, mistakes: [{ value: 4, note: 'You took moments about the wrong support.' }] }],
    solution: 'Moments about B: $$R_A \\cdot 5 = 10 \\cdot 3$$ so $R_A = 6$ kN.',
    sources: [{ title: 'Hibbeler, Statics', detail: 'Ch. 5' }],
    formulas: ['moments'],
    ...overrides,
  };
}

function day(overrides: any = {}) {
  return {
    date: '2026-10-21',
    core: question(),
    bonus: [question({ id: 'q2', track: 'controls', topic: 'PID', parts: [{ id: 'a', answer: { type: 'choice', options: ['P', 'PI', 'PD'], correct: 1 } }] })],
    formulas: [{ id: 'moments', name: 'Sum of moments', latex: '\\sum M = 0', source: 'NCEES FE Reference Handbook, Statics' }],
    ...overrides,
  };
}

test('validateDay accepts a good day and drops unknown fields', () => {
  const { day: d, errors } = validateDay({ ...day(), extra: 1, core: { ...question(), junk: true } });
  assert.deepEqual(errors, []);
  assert.equal((d as any).extra, undefined);
  assert.equal((d!.core as any).junk, undefined);
  assert.equal(d!.bonus.length, 1);
});

test('validateDay reports broken math, bad answers and missing references', () => {
  const { day: d, errors } = validateDay(day({
    core: question({ prompt: 'Broken $\\frac{1}{$ math', formulas: ['nope'] }),
    bonus: [question({ id: 'q2', parts: [{ id: 'a', answer: { type: 'choice', options: ['A', 'B'], correct: 5 } }] })],
    formulas: [{ id: 'moments', name: 'x', latex: '\\badcommand{', source: 's' }],
  }));
  assert.equal(d, null);
  const text = errors.join('\n');
  assert.match(text, /core\.prompt: math doesn't render/);
  assert.match(text, /formulas must be ids/);
  assert.match(text, /bonus\[0\]\.parts\[0\]: invalid answer \(choice\)/);
  assert.match(text, /latex doesn't render/);
});

test('validateDay: escaped dollar signs are currency, not math', () => {
  const { errors } = validateDay(day({ core: question({ prompt: 'It saves **\\$5,000** a year; $P = 5000 \\times 7.36$ is about \\$36,800.' }) }));
  assert.deepEqual(errors, []);
});

test('validateDay: zero answers need abs, figures need alt text, ids must be unique', () => {
  const zero = validateDay(day({ core: question({ parts: [{ id: 'a', answer: { type: 'numeric', value: 0 } }] }) }));
  assert.match(zero.errors.join(), /needs an absolute tolerance/);
  const fig = validateDay(day({ core: question({ figure: '<svg></svg>' }) }));
  assert.match(fig.errors.join(), /figureAlt/);
  const dupe = validateDay(day({ bonus: [question()] }));
  assert.match(dupe.errors.join(), /ids must be unique/);
});

test('validatePack rejects repeated dates and question ids across days', () => {
  const ok = validatePack({ version: 1, days: [day(), day({ date: '2026-10-22', core: question({ id: 'q3' }), bonus: [] })] });
  assert.deepEqual(ok.errors, []);
  const bad = validatePack({ version: 1, days: [day(), day()] });
  assert.match(bad.errors.join('\n'), /appears twice/);
  assert.match(bad.errors.join('\n'), /used on another day/);
  assert.match(validatePack({ days: [] }).errors[0], /version: 1/);
});

test('grading each answer type', () => {
  assert.equal(isPartCorrect({ type: 'numeric', value: 100 }, { type: 'numeric', value: 101.9 }), true);
  assert.equal(isPartCorrect({ type: 'numeric', value: 100 }, { type: 'numeric', value: 103 }), false);
  assert.equal(isPartCorrect({ type: 'numeric', value: 0, abs: 0.01 }, { type: 'numeric', value: 0.005 }), true);
  assert.equal(isPartCorrect({ type: 'multi', options: ['a', 'b', 'c'], correct: [0, 2] }, { type: 'multi', options: [2, 0] }), true);
  assert.equal(isPartCorrect({ type: 'multi', options: ['a', 'b', 'c'], correct: [0, 2] }, { type: 'multi', options: [0] }), false);
  assert.equal(isPartCorrect({ type: 'range', min: 0, max: 6 }, { type: 'range', min: 0, max: 6 }), true);
  assert.equal(isPartCorrect({ type: 'range', min: 2, max: null }, { type: 'range', min: 2, max: 10 }), false);
  // 10 / (2s² + 4s + 2) is the same as 5 / (s² + 2s + 1)
  const tf = { type: 'coefficients' as const, numerator: [5], denominator: [1, 2, 1] };
  assert.equal(isPartCorrect(tf, { type: 'coefficients', numerator: [10], denominator: [2, 4, 2] }), true);
  assert.equal(isPartCorrect(tf, { type: 'coefficients', numerator: [0, 5], denominator: [1, 2, 1] }), true, 'leading zeros ignored');
  assert.equal(isPartCorrect(tf, { type: 'coefficients', numerator: [5], denominator: [1, 2] }), false);
  assert.equal(isPartCorrect({ type: 'order', items: ['a', 'b', 'c'] }, { type: 'order', items: ['a', 'b', 'c'] }), true);
  assert.equal(isPartCorrect({ type: 'order', items: ['a', 'b', 'c'] }, { type: 'order', items: ['b', 'a', 'c'] }), false);
});

test('gradeQuestion: partial credit and known-mistake notes; parseResponses drops junk', () => {
  const q = validateDay(day({ core: question({ parts: [
    { id: 'a', answer: { type: 'numeric', value: 6 }, mistakes: [{ value: 4, note: 'Wrong support.' }] },
    { id: 'b', answer: { type: 'choice', options: ['x', 'y'], correct: 0 } },
  ] }) })).day!.core;
  const responses = parseResponses(q, { a: { type: 'numeric', value: 4 }, b: { type: 'choice', option: 0 }, zzz: 1 });
  assert.deepEqual(Object.keys(responses), ['a', 'b']);
  const result = gradeQuestion(q, responses);
  assert.equal(result.status, 'partial');
  assert.equal(result.parts[0].mistake, 'Wrong support.');
  assert.equal(gradeQuestion(q, null).status, 'studied');
  assert.deepEqual(parseResponses(q, { a: { type: 'choice', option: 0 }, b: { type: 'choice', option: 9 } }), {});
});

test('publicDay hides answers, solutions and check notes', () => {
  const d = validateDay(day({ core: question({ check: 'computed twice', parts: [{ id: 'a', answer: { type: 'order', items: ['1', '2', '3', '4'] } }] }) })).day!;
  const pub = publicDay(d);
  const text = JSON.stringify(pub);
  assert.doesNotMatch(text, /computed twice|Moments about B|"correct"|"value"/);
  const items = (pub.core.parts[0].input as any).items;
  assert.notDeepEqual(items, ['1', '2', '3', '4'], 'order items are never shown in the answer order');
  assert.deepEqual([...items].sort(), ['1', '2', '3', '4']);
});

function attempt(overrides: Partial<Attempt> = {}): Attempt {
  return {
    questionId: 'q1', date: '2026-10-21', answeredOn: '2026-10-21', at: '2026-10-21T12:00:00Z',
    responses: { a: { type: 'numeric', value: 6 } }, hints: 0,
    result: { correct: 1, total: 1, status: 'solved' },
    meta: { track: 'mechanical', topic: 'Statics', difficulty: 2, title: 'Beam', core: true, boss: false },
    ...overrides,
  };
}

test('XP: difficulty, hints, catching up and boss problems', () => {
  const solved = { correct: 1, total: 1, status: 'solved' as const };
  assert.equal(attemptXp(attempt(), solved), 30);
  assert.equal(attemptXp(attempt({ hints: 2 }), solved), 18);
  assert.equal(attemptXp(attempt({ hints: 5 }), solved), 15, 'hints never cost more than half');
  assert.equal(attemptXp(attempt({ answeredOn: '2026-10-25' }), solved), 15);
  assert.equal(attemptXp(attempt({ meta: { ...attempt().meta, boss: true } }), solved), 45);
  assert.equal(attemptXp(attempt(), { correct: 0, total: 1, status: 'wrong' }), 5);
  assert.equal(attemptXp(attempt(), { correct: 1, total: 2, status: 'partial' }), 15);
  assert.equal(attemptXp(attempt(), { correct: 0, total: 1, status: 'studied' }), 3, 'reading the solution earns a little');
  assert.equal(attemptXp(attempt({ tries: 2 }), solved), 26, 'each extra check costs 15%');
  assert.equal(attemptXp(attempt({ tries: 3 }), solved), 21);
  assert.equal(attemptXp(attempt({ tries: 9 }), solved), 21, 'never more than three checks');
});

test('streak counts core questions done on their own day; today pending keeps it', () => {
  const list = ['2026-10-17', '2026-10-18', '2026-10-19'].map((d) => attempt({ questionId: d, date: d, answeredOn: d }));
  list.push(attempt({ questionId: 'late', date: '2026-10-15', answeredOn: '2026-10-19' }));
  list.push(attempt({ questionId: 'bonus', date: '2026-10-16', answeredOn: '2026-10-16', meta: { ...attempt().meta, core: false } }));
  assert.deepEqual(questionStreak(list, '2026-10-20'), { current: 3, best: 3, doneToday: false });
  assert.equal(questionStreak(list, '2026-10-21').current, 0);
});

test('scoreAll regrades against a corrected answer key', () => {
  const q = validateDay(day()).day!.core;
  const wrongKey = attempt({ responses: { a: { type: 'numeric', value: 4 } }, result: { correct: 0, total: 1, status: 'wrong' } });
  const [scored] = scoreAll([wrongKey], new Map([[q.id, { ...q, parts: [{ id: 'a', answer: { type: 'numeric', value: 4 } }] }]]));
  assert.equal(scored.status, 'solved');
  assert.equal(scored.regraded, true);
  assert.equal(scored.xp, 30);
  const [untouched] = scoreAll([wrongKey], new Map());
  assert.equal(untouched.status, 'wrong', 'without the question, the stored grade stands');
});

test('questionStats tallies tracks, topics and achievements', () => {
  const meta = (track: any, core = true) => ({ ...attempt().meta, track, core });
  const scored = scoreAll([
    attempt({ questionId: 'a' }),
    attempt({ questionId: 'b', meta: meta('controls', false), responses: null, result: { correct: 0, total: 1, status: 'studied' } }),
    attempt({ questionId: 'c', date: '2026-10-20', answeredOn: '2026-10-20', meta: meta('controls') }),
  ], new Map());
  const stats = questionStats(scored, '2026-10-21');
  assert.equal(stats.total.answered, 2);
  assert.equal(stats.total.solved, 2);
  assert.equal(stats.byTrack.find((t) => t.track === 'controls')!.answered, 1);
  assert.equal(stats.streak.current, 2);
  assert.equal(stats.achievements.find((a) => a.id === 'first')!.earned, true);
  assert.equal(stats.xpThisWeek, 63); // two solves and one studied
  assert.equal(attemptMeta(validateDay(day()).day!.core, true, true).boss, true);
});
