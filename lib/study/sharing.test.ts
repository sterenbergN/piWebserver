import test from 'node:test';
import { strict as assert } from 'node:assert';
import { addSharedTest, copyOf, dropMissing, emptyShares, isShareId, normalizeShares, sharedTitle, sharePreview, shareTest, unshareTest } from './sharing';
import { createSet } from './sets';
import { addTest, emptyTests, parseTestReply, StudyInputError, type TestsData } from './study';

const NOW = '2026-11-02T15:00:00.000Z';
let counter = 0;
const makeId = () => `x${++counter}`;
const makeToken = () => `token-${String(++counter).padStart(20, '0')}`;

function hers(): TestsData {
  const data = emptyTests();
  addTest(data, parseTestReply(JSON.stringify({
    title: 'Heart failure',
    questions: ['one', 'two', 'three', 'four'].map((n) => ({
      stem: `Question ${n}?`, choices: ['Right', 'Wrong'], correct: 'A', explanation: `Because ${n}.`, topic: n === 'four' ? 'Diuretics' : 'Diagnosis', quote: `From my notes on ${n}`,
    })),
  })), { course: 'Clin Med', difficulty: 3 }, makeId, NOW);
  return data;
}

test('sharing makes one link per test, and publishing only changes who can find it', () => {
  const tests = hers();
  const shares = emptyShares();
  const id = tests.tests[0].id;
  const link = shareTest(shares, tests, id, false, makeToken, NOW);
  assert.ok(isShareId(link.id));
  assert.equal(link.public, false);
  const again = shareTest(shares, tests, id, true, makeToken, NOW);
  assert.equal(again.id, link.id, 'the same link, now listed');
  assert.equal(shares.shares.length, 1);
  assert.equal(shares.shares[0].public, true);
  unshareTest(shares, id);
  assert.deepEqual(shares.shares, []);
});

test('only her own tests, with questions, can be shared', () => {
  const tests = hers();
  assert.throws(() => shareTest(emptyShares(), tests, 'gone', true, makeToken, NOW), StudyInputError);
  tests.tests[0].questions = [];
  assert.throws(() => shareTest(emptyShares(), tests, tests.tests[0].id, true, makeToken, NOW), /nothing to share/);
});

test('the preview shows what a test covers and none of its answers', () => {
  const tests = hers();
  const share = shareTest(emptyShares(), tests, tests.tests[0].id, true, makeToken, NOW);
  const preview = sharePreview(share, tests.tests[0], 'sam');
  assert.deepEqual({ title: preview.title, by: preview.by, course: preview.course, count: preview.count, difficulty: preview.difficulty }, { title: 'Heart failure', by: 'sam', course: 'Clin Med', count: 4, difficulty: 3 });
  assert.deepEqual(preview.topics, ['Diagnosis', 'Diuretics']);
  assert.deepEqual(preview.sample, ['Question one?', 'Question two?', 'Question three?']);
  const text = JSON.stringify(preview);
  for (const hidden of ['Right', 'Because', 'From my notes', '"correct"']) assert.ok(!text.includes(hidden), `${hidden} stays hidden`);
});

test('adding makes their own copy, once, with new ids and where it came from', () => {
  const tests = hers();
  const original = tests.tests[0];
  const share = shareTest(emptyShares(), tests, original.id, true, makeToken, NOW);
  const theirs = emptyTests();
  const { test: copy, added } = addSharedTest(theirs, share.id, original, 'sam', makeId, NOW);
  assert.ok(added);
  assert.notEqual(copy.id, original.id);
  assert.equal(copy.questions.length, 4);
  assert.ok(copy.questions.every((q, i) => q.id !== original.questions[i].id && q.stem === original.questions[i].stem && q.explanation === original.questions[i].explanation));
  assert.deepEqual(copy.source, { shareId: share.id, by: 'sam', addedAt: NOW });
  assert.equal(copy.setId, undefined, 'it starts outside any set of hers');

  copy.questions[0].stem = 'Edited in their copy';
  assert.equal(original.questions[0].stem, 'Question one?', 'their edits don’t touch hers');

  const twice = addSharedTest(theirs, share.id, original, 'sam', makeId, NOW);
  assert.equal(twice.added, false);
  assert.equal(twice.test.id, copy.id);
  assert.equal(theirs.tests.length, 1);
  assert.equal(copyOf(theirs, share.id)?.id, copy.id);
});

test('a test in a set carries the set’s name, since “Test 2” says nothing to anyone else', () => {
  const tests = hers();
  assert.equal(sharedTitle(tests.tests[0], tests), 'Heart failure');
  const set = createSet(tests, { title: 'Cardio' }, makeId, NOW);
  tests.tests[0].setId = set.id;
  tests.tests[0].title = 'Test 2';
  assert.equal(sharedTitle(tests.tests[0], tests), 'Cardio: Test 2');
  const theirs = emptyTests();
  const { test: copy } = addSharedTest(theirs, 'a'.repeat(22), tests.tests[0], 'sam', makeId, NOW, sharedTitle(tests.tests[0], tests));
  assert.equal(copy.title, 'Cardio: Test 2');
});

test('a copy isn’t shared onward, so stopping sharing really stops it', () => {
  const tests = hers();
  const share = shareTest(emptyShares(), tests, tests.tests[0].id, true, makeToken, NOW);
  const theirs = emptyTests();
  const { test: copy } = addSharedTest(theirs, share.id, tests.tests[0], 'sam', makeId, NOW);
  assert.throws(() => shareTest(emptyShares(), theirs, copy.id, true, makeToken, NOW), /sam’s test/);
});

test('deleted tests drop their shares, and stored shares are read safely', () => {
  const tests = hers();
  const shares = emptyShares();
  shareTest(shares, tests, tests.tests[0].id, false, makeToken, NOW);
  tests.tests = [];
  dropMissing(shares, tests);
  assert.deepEqual(shares.shares, []);
  const read = normalizeShares({ shares: [{ id: 'short', testId: 't' }, { id: 'a'.repeat(22), testId: 't', public: 'yes' }] as never });
  assert.deepEqual(read.shares, [{ id: 'a'.repeat(22), testId: 't', public: false, createdAt: '' }]);
  assert.deepEqual(normalizeShares(null), emptyShares());
});
