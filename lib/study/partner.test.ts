import test from 'node:test';
import { strict as assert } from 'node:assert';
import type { GameQuestion } from './games';
import { isExpired, isToken, markQuestion, newSession, ownerView, partnerCaseView, partnerQuizView, quizPick, setTicked } from './partner';
import { diffOptions, parseCaseReply, formatSeconds, type PatientCase } from './practice';
import type { StudyQuestion } from './study';

const NOW = new Date('2026-11-02T15:00:00.000Z');
const TOKEN = 'a'.repeat(32);
const session = (over: Partial<Parameters<typeof newSession>[0]> = {}) => newSession({ token: TOKEN, ownerId: 'her', kind: 'quiz', questionIds: ['q1', 'q2'], ...over }, NOW);
const question = { id: 'q1', stem: 'Stem?', choices: ['a', 'b'], correct: [1], explanation: 'Why', topic: 'T', whyWrong: { 0: 'no' } } as unknown as StudyQuestion;

const parsedCase = parseCaseReply(JSON.stringify({
  door: { age: 58, sex: 'man', complaint: 'chest pain', vitals: 'BP 150/90' },
  opening: 'My chest hurts.',
  script: [{ ask: 'Onset', say: 'An hour ago.' }, { ask: 'Radiation', say: 'To my left arm.' }, { ask: 'Smoking', say: 'A pack a day.' }],
  checklist: ['Asks onset', 'Asks radiation', 'Names it'],
  diagnosis: 'Acute coronary syndrome',
  teaching: 'Get an ECG.',
})).items[0];
const item: PatientCase = { ...parsedCase, id: 'c1', createdAt: NOW.toISOString(), runs: [] };

test('only well-formed tokens pass, so a link can’t reach outside its folder', () => {
  assert.ok(isToken(TOKEN));
  for (const bad of ['short', '../../etc/passwd/aaaaaaaaaaaaaaaaaaaaaaaaaaaa', `${'a'.repeat(32)}.json`, 'a'.repeat(65), 7, null]) assert.ok(!isToken(bad), String(bad));
});

test('a session runs out after a day, and a damaged one counts as run out', () => {
  const s = session();
  assert.ok(!isExpired(s, new Date(NOW.getTime() + 23 * 3_600_000)));
  assert.ok(isExpired(s, new Date(NOW.getTime() + 24 * 3_600_000)));
  assert.ok(isExpired({ ...s, expiresAt: 'nonsense' }, NOW));
});

test('a quiz asks what’s due first, then misses, then the rest', () => {
  const pool = [1, 3, 1, 2, 3].map((priority, i) => ({ id: `q${i}`, priority })) as GameQuestion[];
  const picked = quizPick(pool, 3, () => 0.5);
  assert.deepEqual(new Set(picked.slice(0, 2)), new Set(['q1', 'q4']));
  assert.equal(picked[2], 'q3');
  assert.equal(quizPick(pool, 50).length, 5);
});

test('marking moves through the quiz, and a double tap counts once', () => {
  const s = session();
  assert.deepEqual(markQuestion(s, 0, true, NOW), { id: 'q1', verdict: true });
  assert.equal(markQuestion(s, 0, true, NOW), null, 'the same question again');
  assert.equal(s.right, 1);
  assert.equal(s.finishedAt, undefined);
  assert.deepEqual(markQuestion(s, 1, false, NOW), { id: 'q2', verdict: false });
  assert.deepEqual([s.wrong, s.missedIds, s.finishedAt], [1, ['q2'], NOW.toISOString()]);
  assert.equal(markQuestion(s, 2, true, NOW), null, 'nothing left');
});

test('skipping counts for nothing', () => {
  const s = session();
  assert.deepEqual(markQuestion(s, 0, null, NOW), { id: 'q1', verdict: null });
  assert.deepEqual([s.right, s.wrong, s.index], [0, 0, 1]);
});

test('the helper sees one question at a time, nothing once it’s over, and never whose it is', () => {
  const s = session();
  const view = partnerQuizView(s, question);
  assert.equal(view.finished, false);
  assert.ok(!view.finished && view.question?.stem === 'Stem?');
  const text = JSON.stringify(view);
  assert.ok(!text.includes('her'), 'not the owner');
  assert.ok(!text.includes('q2'), 'not the rest of the quiz');
  s.finishedAt = NOW.toISOString();
  assert.ok(!JSON.stringify(partnerQuizView(s, question)).includes('Stem?'));
});

test('the patient script shows until it’s over, then only how it went', () => {
  const s = session({ kind: 'patient', caseId: 'c1', questionIds: [] });
  const view = partnerCaseView(s, item);
  assert.ok(!view.finished && view.script.length === 3);
  assert.ok(!JSON.stringify(view).includes('"her"'));
  s.finishedAt = NOW.toISOString();
  s.run = { on: '2026-11-02', right: 2, total: 3, missed: ['Names it'], seconds: 90 };
  const after = partnerCaseView(s, item);
  assert.ok(after.finished && after.diagnosis === 'Acute coronary syndrome');
  assert.ok(!JSON.stringify(after).includes('To my left arm'));
});

test('her own screen gets the door chart, and no spoilers until it’s over', () => {
  const s = session({ kind: 'patient', caseId: 'c1', questionIds: [] });
  const before = JSON.stringify(ownerView(s, item, []));
  for (const secret of ['Acute coronary', 'To my left arm', 'Asks onset', 'Get an ECG']) assert.ok(!before.includes(secret), secret);
  assert.ok(before.includes('chest pain'));
  s.finishedAt = NOW.toISOString();
  s.run = { on: '2026-11-02', right: 2, total: 3, missed: ['Names it'], seconds: 90 };
  assert.ok(JSON.stringify(ownerView(s, item, [])).includes('Acute coronary'));
});

test('her quiz screen shows the score, and what she missed only at the end', () => {
  const s = session();
  markQuestion(s, 0, false, NOW);
  const during = ownerView(s, null, ['Stem?']);
  assert.ok(!JSON.stringify(during).includes('Stem?'));
  assert.deepEqual([(during as { index: number }).index, (during as { wrong: number }).wrong], [1, 1]);
  markQuestion(s, 1, true, NOW);
  assert.deepEqual((ownerView(s, null, ['Stem?']) as { missedStems?: string[] }).missedStems, ['Stem?']);
});

test('ticks stay within the checklist, and stop when it’s over', () => {
  const s = session({ kind: 'patient', caseId: 'c1', questionIds: [] });
  setTicked(s, [0, 2, 2, 9, -1, 'x'], 3);
  assert.deepEqual(s.ticked, [0, 2]);
  setTicked(s, 'nope', 3);
  assert.deepEqual(s.ticked, [0, 2]);
  s.finishedAt = NOW.toISOString();
  setTicked(s, [1], 3);
  assert.deepEqual(s.ticked, [0, 2]);
});

test('the answer isn’t always in the same spot among the options', () => {
  const lasts = new Set(Array.from({ length: 12 }, (_, i) => diffOptions({ id: `case${i}`, options: ['a', 'b', 'c', 'answer'] }).indexOf('answer')));
  assert.ok(lasts.size > 1);
  assert.deepEqual(diffOptions({ id: 'x', options: ['a', 'b', 'c'] }), diffOptions({ id: 'x', options: ['a', 'b', 'c'] }));
});

test('times read like a clock', () => {
  assert.equal(formatSeconds(0), '0:00');
  assert.equal(formatSeconds(65), '1:05');
  assert.equal(formatSeconds(725), '12:05');
});
