import test from 'node:test';
import { strict as assert } from 'node:assert';
import { emptyJournal, JournalInputError, listEntries, normalizeJournal, saveEntry, searchEntries, writingStreak } from './journal';

const TODAY = '2026-10-28';
const NOW = '2026-10-28T20:00:00.000Z';

test('saving: writes, keeps createdAt, clears empty days and refuses bad input', () => {
  const data = emptyJournal();
  saveEntry(data, '2026-10-27', 'First day.', 4, TODAY, '2026-10-27T21:00:00.000Z');
  saveEntry(data, '2026-10-27', 'First day, edited.', 4, TODAY, NOW);
  assert.equal(data.entries['2026-10-27'].text, 'First day, edited.');
  assert.equal(data.entries['2026-10-27'].createdAt, '2026-10-27T21:00:00.000Z');
  assert.equal(data.entries['2026-10-27'].updatedAt, NOW);

  // A mood alone is an entry; no text and no mood removes the day.
  assert.ok(saveEntry(data, TODAY, '', 2, TODAY, NOW));
  assert.equal(saveEntry(data, TODAY, '   ', null, TODAY, NOW), null);
  assert.equal(data.entries[TODAY], undefined);

  assert.throws(() => saveEntry(data, '2026-10-29', 'tomorrow', null, TODAY, NOW), JournalInputError);
  assert.throws(() => saveEntry(data, '2026-02-30', 'x', null, TODAY, NOW), JournalInputError);
  assert.throws(() => saveEntry(data, TODAY, 'x', 6, TODAY, NOW), JournalInputError);
  assert.throws(() => saveEntry(data, TODAY, 42, null, TODAY, NOW), JournalInputError);
});

test('normalize drops malformed entries', () => {
  const data = normalizeJournal({ entries: { '2026-10-01': { text: 'ok', mood: 9 }, nope: { text: 'x' }, '2026-10-02': { mood: 3 } } });
  assert.deepEqual(Object.keys(data.entries), ['2026-10-01']);
  assert.equal(data.entries['2026-10-01'].mood, undefined);
  assert.deepEqual(normalizeJournal(null), emptyJournal());
});

test('list is newest first; search needs every word and previews near the match', () => {
  const data = emptyJournal();
  saveEntry(data, '2026-10-01', 'Went climbing with Sam. Fingers sore.', 5, TODAY, NOW);
  saveEntry(data, '2026-10-05', `${'Long day at work. '.repeat(5)}Then climbing again in the evening.`, 3, TODAY, NOW);
  saveEntry(data, '2026-10-03', 'Quiet day.', null, TODAY, NOW);

  assert.deepEqual(listEntries(data).map((s) => s.date), ['2026-10-05', '2026-10-03', '2026-10-01']);
  assert.equal(listEntries(data)[2].words, 6);

  assert.deepEqual(searchEntries(data, 'CLIMBING').map((s) => s.date), ['2026-10-05', '2026-10-01']);
  assert.deepEqual(searchEntries(data, 'climbing sam').map((s) => s.date), ['2026-10-01']);
  assert.ok(searchEntries(data, 'climbing')[0].preview.startsWith('…'));
  assert.equal(searchEntries(data, '  ').length, 3);
});

test('streak counts back from today, or from yesterday before today is written', () => {
  assert.equal(writingStreak(['2026-10-26', '2026-10-27'], TODAY), 2);
  assert.equal(writingStreak(['2026-10-26', '2026-10-27', TODAY], TODAY), 3);
  assert.equal(writingStreak(['2026-10-25', '2026-10-27'], TODAY), 1);
  assert.equal(writingStreak(['2026-10-25'], TODAY), 0);
});
