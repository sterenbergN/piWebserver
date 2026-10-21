import test from 'node:test';
import { strict as assert } from 'node:assert';
import { ability, analyze, performance, type AnalysisAttempt } from './analysis';
import { attemptXp } from './progress';
import { validatePack } from './validate';
import { generatedQuestion } from './generated';
import type { Track } from './types';

let n = 0;
function a(track: Track, topic: string, difficulty: number, status: AnalysisAttempt['status'], extra: Partial<AnalysisAttempt> = {}): AnalysisAttempt {
  n++;
  const [correct, total] = status === 'solved' ? [1, 1] : status === 'partial' ? [1, 2] : status === 'wrong' ? [0, 1] : [0, 1];
  return {
    questionId: `q${n}`, at: `2026-10-${String(1 + (n % 20)).padStart(2, '0')}T12:00:${String(n % 60).padStart(2, '0')}Z`, answeredOn: `2026-10-${String(1 + (n % 20)).padStart(2, '0')}`,
    meta: { track, topic, difficulty, title: 't', core: true, boss: false }, status, correct, total, hints: 0, ...extra,
  };
}

test('performance counts partial credit, retries, hints, and nothing for giving up', () => {
  assert.equal(performance(a('controls', 'PID tuning', 3, 'solved')), 1);
  assert.equal(performance(a('controls', 'PID tuning', 3, 'partial')), 0.5);
  assert.equal(performance(a('controls', 'PID tuning', 3, 'solved', { tries: 2 })), 0.85);
  assert.equal(performance(a('controls', 'PID tuning', 3, 'studied')), 0);
});

test('ability rises with hard solves and falls with easy misses', () => {
  const strong = ability([4, 4, 5, 4, 5].map((d) => a('mechanical', 'Statics', d, 'solved')));
  const weak = ability([2, 1, 2, 2, 1].map((d) => a('mechanical', 'Statics', d, 'wrong')));
  assert.ok(strong > 4, `strong ${strong}`);
  assert.ok(weak < 1.5, `weak ${weak}`);
});

test('analyze finds strengths, weaknesses, slips, untried topics and what to focus on', () => {
  const list = [
    ...[3, 4, 4, 5].map((d) => a('mechanical', 'Statics', d, 'solved', { parts: [{ correct: true, type: 'numeric' }] })),
    ...[2, 2, 3, 2].map((d) => a('controls', 'Root locus', d, d === 3 ? 'studied' : 'wrong', { parts: [{ correct: false, type: 'choice', mistake: 'Open- vs closed-loop poles.' }] })),
    a('automation', 'TIA Portal', 2, 'solved'),
  ];
  const r = analyze(list, '2026-10-21');
  assert.equal(r.overall.answered, 8);
  assert.deepEqual(r.strengths.map((t) => t.topic), ['Statics']);
  assert.deepEqual(r.weaknesses.map((t) => t.topic), ['Root locus']);
  assert.equal(r.topics.find((t) => t.topic === 'TIA Portal')!.label, 'new', 'one answer is not enough to judge');
  assert.equal(r.slips[0].note, 'Open- vs closed-loop poles.');
  assert.equal(r.slips[0].count, 3);
  assert.equal(r.focus[0].topic, 'Root locus');
  assert.ok(r.untried.some((u) => u.topic === 'Thermodynamics'));
  assert.ok(!r.untried.some((u) => u.topic === 'Statics'));
  assert.deepEqual(r.answerTypes.map((t) => t.type).sort(), ['choice', 'numeric']);
  assert.equal(r.difficulty.find((d) => d.difficulty === 4)!.solved, 2);
});

test('practice questions are half XP and never late; packs can carry practice-only questions', () => {
  const base = { hints: 0, date: '2026-10-21', answeredOn: '2026-10-21', meta: { track: 'mechanical' as const, topic: 'Statics', difficulty: 2, title: 't', core: false, boss: false } };
  const solved = { correct: 1, total: 1, status: 'solved' as const };
  assert.equal(attemptXp(base, solved), 30);
  assert.equal(attemptXp({ ...base, meta: { ...base.meta, practice: true } }, solved), 15);

  const q = generatedQuestion('gen-beam-reaction-5')!;
  const practice = { formulas: q.formulas, questions: [{ ...q.question, id: 'p-2026-10-21-beam' }] };
  const ok = validatePack({ version: 1, days: [], practice });
  assert.deepEqual(ok.errors, []);
  assert.equal(ok.pack!.practice!.questions.length, 1);
  assert.ok(validatePack({ version: 1, days: [], practice: { formulas: q.formulas, questions: [q.question] } }).errors.some((e) => e.includes('reserved')));
  assert.ok(validatePack({ version: 1, days: [] }).errors.length > 0, 'an empty pack is still refused');
});
