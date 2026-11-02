import test from 'node:test';
import { strict as assert } from 'node:assert';
import { finishGuestAttempt, forgetGuestTest, openGuestTest, readGuestData, saveGuestAttempt, startGuestAttempt, type GuestData } from './guest';
import { guestCopy } from './sharing';
import { createSet } from './sets';
import { addTest, emptyTests, parseTestReply, scoreAttempt, type StudyTest } from './study';

const NOW = '2026-11-02T15:00:00.000Z';
const TODAY = '2026-11-02';
let counter = 0;
const makeId = () => `q${++counter}`;

function sharedTest(stems = ['One?', 'Two?', 'Three?']): StudyTest {
  const data = emptyTests();
  return addTest(data, parseTestReply(JSON.stringify({
    title: 'Cardio', questions: stems.map((stem) => ({ stem, choices: ['Right', 'Wrong'], correct: 'A', explanation: 'Because.', topic: 'Heart' })),
  })), {}, makeId, NOW);
}

test('a guest takes a shared test in the browser, graded the same way', () => {
  const data: GuestData = { tests: {} };
  const entry = openGuestTest(data, 'share-1', sharedTest(), NOW);
  const attempt = startGuestAttempt(entry, { mode: 'exam' }, makeId, 1, NOW);
  const [a, b] = entry.test.questions;
  saveGuestAttempt(entry, { attemptId: attempt.id, answers: { [a.id]: [0] }, flagged: [], elapsed: 30 });
  const score = finishGuestAttempt(entry, { attemptId: attempt.id, answers: { [a.id]: [0], [b.id]: [1] }, flagged: [], elapsed: 60 }, TODAY, NOW);
  assert.deepEqual([score.right, score.total], [1, 3]);
  assert.equal(entry.progress.attempts[0].finishedAt, NOW);
  assert.equal(scoreAttempt(entry.progress.attempts[0], entry.test).right, 1);

  // What's stored reads back the same.
  const again = readGuestData(JSON.stringify(data));
  assert.equal(again.tests['share-1'].progress.attempts.length, 1);
  assert.throws(() => saveGuestAttempt(entry, { attemptId: 'gone', answers: {}, flagged: [], elapsed: 0 }), /isn’t in this browser/);
});

test('it keeps the version its tries were graded on, and takes the latest until then', () => {
  const data: GuestData = { tests: {} };
  openGuestTest(data, 's', sharedTest(['Old?']), NOW);
  const fresh = openGuestTest(data, 's', sharedTest(['New?']), NOW);
  assert.equal(fresh.test.questions[0].stem, 'New?', 'nothing tried yet, so the latest');
  startGuestAttempt(fresh, { mode: 'tutor' }, makeId, 1, NOW);
  const later = openGuestTest(data, 's', sharedTest(['Newer?']), NOW);
  assert.equal(later.test.questions[0].stem, 'New?', 'its tries stay graded against what they saw');
});

test('clearing forgets every try here, and old tests make room for new ones', () => {
  const data: GuestData = { tests: {} };
  openGuestTest(data, 'keep', sharedTest(), '2026-11-02T00:00:00.000Z');
  forgetGuestTest(data, 'keep');
  assert.deepEqual(data.tests, {});
  for (let i = 0; i < 31; i++) openGuestTest(data, `t${i}`, sharedTest(), `2026-11-${String(i + 1).padStart(2, '0')}T00:00:00.000Z`);
  assert.equal(Object.keys(data.tests).length, 30);
  assert.equal(data.tests.t0, undefined, 'the oldest goes');
  assert.ok(data.tests.t30);
});

test('broken storage reads as nothing kept', () => {
  assert.deepEqual(readGuestData('not json'), { tests: {} });
  assert.deepEqual(readGuestData(null), { tests: {} });
  assert.deepEqual(readGuestData(JSON.stringify({ tests: { x: { test: { title: 'no questions' } } } })), { tests: {} });
});

test('a guest gets the test, but nothing about the owner’s set or where it came from', () => {
  const data = emptyTests();
  const set = createSet(data, { title: 'Cardio' }, makeId, NOW);
  const t = sharedTest();
  t.setId = set.id;
  t.source = { shareId: 'x', by: 'sam', addedAt: NOW };
  const copy = guestCopy(t, 'Cardio: Test 1');
  assert.equal(copy.title, 'Cardio: Test 1');
  assert.equal(copy.setId, undefined);
  assert.equal(copy.source, undefined);
  assert.equal(copy.questions.length, 3);
  copy.questions[0].stem = 'Changed';
  assert.equal(t.questions[0].stem, 'One?', 'a copy, not the owner’s own');
});
