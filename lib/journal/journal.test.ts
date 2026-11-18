import test from 'node:test';
import { strict as assert } from 'node:assert';
import { addTalk, emptyJournal, JournalInputError, listEntries, MAX_SUMMARY, normalizeJournal, saveEntry, searchEntries, updateTalk, writingStreak } from './journal';

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

test('searchEntries searches inside kept talks topics and transcripts', () => {
  const data = emptyJournal();
  saveEntry(data, '2026-10-02', 'Short reflection.', 4, TODAY, NOW);
  data.entries['2026-10-02'].talks = [
    { id: 't1', topic: 'Hydraulics valve sizing', transcript: 'Me: Should we check cavitation margins?\nAI: Yes, compute sigma.', createdAt: NOW },
  ];
  assert.deepEqual(searchEntries(data, 'cavitation sigma').map((s) => s.date), ['2026-10-02']);
  assert.deepEqual(searchEntries(data, 'hydraulics').map((s) => s.date), ['2026-10-02']);
  assert.ok(searchEntries(data, 'cavitation')[0].preview.toLowerCase().includes('cavitation'));
});

test('streak counts back from today, or from yesterday before today is written', () => {
  assert.equal(writingStreak(['2026-10-26', '2026-10-27'], TODAY), 2);
  assert.equal(writingStreak(['2026-10-26', '2026-10-27', TODAY], TODAY), 3);
  assert.equal(writingStreak(['2026-10-25', '2026-10-27'], TODAY), 1);
  assert.equal(writingStreak(['2026-10-25'], TODAY), 0);
});

test('addTalk stores mode and summary even with empty transcript, and summarize uses talk preview when text is empty', () => {
  const data = emptyJournal();
  const talk = addTalk(data, TODAY, 'Buying vs renting', '', TODAY, NOW, 'talk-1', {
    mode: 'decide',
    summary: '- **The decision:** Wait six months.\n- **Where I landed:** Keep saving.',
  });
  assert.equal(talk.mode, 'decide');
  assert.equal(talk.transcript, '');
  assert.match(talk.summary ?? '', /Wait six months/);

  // Saving empty text/mood preserves the day when talks exist.
  assert.ok(saveEntry(data, TODAY, '', null, TODAY, NOW));
  assert.equal(data.entries[TODAY].talks?.length, 1);

  const list = listEntries(data);
  assert.equal(list.length, 1);
  assert.equal(list[0].talks, 1);
  assert.ok(list[0].preview.includes('Buying vs renting'));
  assert.ok(list[0].preview.includes('The decision: Wait six months'));

  const reread = normalizeJournal(JSON.parse(JSON.stringify(data)));
  assert.equal(reread.entries[TODAY].talks?.[0].mode, 'decide');
  assert.equal(reread.entries[TODAY].talks?.[0].summary, talk.summary);

  // Invalid mode or missing both transcript and summary are rejected.
  assert.throws(() => addTalk(data, TODAY, 'x', '', TODAY, NOW, 'talk-2', { summary: '   ' }), JournalInputError);
  assert.throws(() => addTalk(data, TODAY, 'x', '', TODAY, NOW, 'talk-2', { mode: 'invalid' as unknown as 'explore', summary: 'ok' }), JournalInputError);
  assert.throws(() => addTalk(data, TODAY, 'x', '', TODAY, NOW, 'talk-2', { summary: 'a'.repeat(MAX_SUMMARY + 1) }), JournalInputError);
});

test('updateTalk refines topic, summary and mode and rejects missing day or talk', () => {
  const data = emptyJournal();
  addTalk(data, TODAY, 'Initial topic', '', TODAY, NOW, 'talk-1', {
    mode: 'explore',
    summary: '- **What we covered:** Draft notes.',
  });

  const later = '2026-10-28T21:30:00.000Z';
  const updated = updateTalk(
    data,
    TODAY,
    'talk-1',
    { topic: ' Refined topic ', summary: ' - **What we covered:** Polished notes. ', mode: 'debate' },
    later,
  );
  assert.equal(updated.topic, 'Refined topic');
  assert.equal(updated.summary, '- **What we covered:** Polished notes.');
  assert.equal(updated.mode, 'debate');
  assert.equal(data.entries[TODAY].updatedAt, later);

  // Clearing mode works; clearing summary fails when no transcript is kept.
  const clearedMode = updateTalk(data, TODAY, 'talk-1', { mode: null }, later);
  assert.equal(clearedMode.mode, undefined);
  assert.throws(() => updateTalk(data, TODAY, 'talk-1', { summary: '   ' }, later), JournalInputError);

  assert.throws(() => updateTalk(data, '2026-10-01', 'talk-1', { topic: 'x' }, later), JournalInputError);
  assert.throws(() => updateTalk(data, TODAY, 'missing', { topic: 'x' }, later), JournalInputError);
});

test('searchEntries matches talk summary and generates plain-text preview', () => {
  const data = emptyJournal();
  addTalk(data, '2026-10-20', 'Solar inverter', '', TODAY, NOW, 'talk-solar', {
    mode: 'brainstorm',
    summary: '- **Best ideas:** Add a microgrid transfer switch for outages.',
  });

  const hits = searchEntries(data, 'microgrid transfer');
  assert.deepEqual(hits.map((s) => s.date), ['2026-10-20']);
  assert.ok(hits[0].preview.toLowerCase().includes('microgrid'));
  assert.equal(searchEntries(data, 'nonexistent term').length, 0);
});
