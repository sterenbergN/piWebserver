import test from 'node:test';
import { strict as assert } from 'node:assert';
import {
  applyQuickNoteAction, cleanNoteText, doneNotes, emptyQuickNotes, MAX_NOTE_LENGTH, MAX_NOTES, noteAge,
  normalizeQuickNotes, openNotes, QuickNoteInputError, type QuickNoteAction, type QuickNotesData,
} from './quick-notes';

let n = 0;
const newId = () => `q${++n}`;
const at = (minute: number) => new Date(Date.UTC(2026, 10, 20, 12, minute));
const apply = (data: QuickNotesData, action: QuickNoteAction, minute = 0) => applyQuickNoteAction(data, action, at(minute), newId);

test('text: trimmed, blank lines folded, capped, non-strings empty', () => {
  assert.equal(cleanNoteText('  walk dog later  '), 'walk dog later');
  assert.equal(cleanNoteText('a  \r\n\r\n\r\n\r\nb'), 'a\n\nb');
  assert.equal(cleanNoteText('x'.repeat(MAX_NOTE_LENGTH + 50)).length, MAX_NOTE_LENGTH);
  assert.equal(cleanNoteText(42), '');
  assert.equal(cleanNoteText(null), '');
});

test('add: newest first, keeps a usable client id, records the page it came from', () => {
  const data = emptyQuickNotes();
  apply(data, { type: 'add', text: 'fix bug x on the website', id: 'client-1', from: { path: '/gallery', title: ' Gallery ' } }, 1);
  apply(data, { type: 'add', text: 'walk dog later' }, 2);
  assert.deepEqual(data.notes.map((x) => x.text), ['walk dog later', 'fix bug x on the website']);
  assert.equal(data.notes[1].id, 'client-1');
  assert.deepEqual(data.notes[1].from, { path: '/gallery', title: 'Gallery' });
  assert.equal(data.notes[1].createdAt, at(1).toISOString());
  assert.equal(data.notes[0].from, undefined);
});

test('add: refuses empty text, replaces bad or taken ids, ignores off-site "from"', () => {
  const data = emptyQuickNotes();
  assert.throws(() => apply(data, { type: 'add', text: '   ' }), QuickNoteInputError);
  apply(data, { type: 'add', text: 'one', id: 'same' });
  const second = apply(data, { type: 'add', text: 'two', id: 'same', from: { path: 'https://evil.example/x' } })!;
  const third = apply(data, { type: 'add', text: 'three', id: '../../etc', from: { path: '//evil.example' } })!;
  assert.notEqual(second.id, 'same');
  assert.match(third.id, /^q\d+$/);
  assert.equal(second.from, undefined);
  assert.equal(third.from, undefined);
});

test('done: checks off many at once, keeps the first check-off time, and can be undone', () => {
  const data = emptyQuickNotes();
  const a = apply(data, { type: 'add', text: 'a' }, 1)!;
  const b = apply(data, { type: 'add', text: 'b' }, 2)!;
  const c = apply(data, { type: 'add', text: 'c' }, 3)!;
  apply(data, { type: 'done', ids: [a.id, b.id, 'missing'], done: true }, 10);
  apply(data, { type: 'done', ids: [a.id], done: true }, 20);
  assert.equal(data.notes.find((x) => x.id === a.id)!.doneAt, at(10).toISOString());
  assert.deepEqual(openNotes(data).map((x) => x.id), [c.id]);
  apply(data, { type: 'done', ids: [b.id], done: false }, 30);
  assert.deepEqual(openNotes(data).map((x) => x.id), [c.id, b.id]);
  assert.deepEqual(doneNotes(data).map((x) => x.id), [a.id]);
});

test('edit, remove and clear-done', () => {
  const data = emptyQuickNotes();
  const a = apply(data, { type: 'add', text: 'a' }, 1)!;
  const b = apply(data, { type: 'add', text: 'b' }, 2)!;
  const c = apply(data, { type: 'add', text: 'c' }, 3)!;
  apply(data, { type: 'edit', id: a.id, text: '  a, edited ' });
  assert.equal(data.notes.find((x) => x.id === a.id)!.text, 'a, edited');
  assert.throws(() => apply(data, { type: 'edit', id: a.id, text: '' }), QuickNoteInputError);
  assert.throws(() => apply(data, { type: 'edit', id: 'gone', text: 'x' }), QuickNoteInputError);
  apply(data, { type: 'remove', ids: [b.id] });
  assert.deepEqual(data.notes.map((x) => x.id), [c.id, a.id]);
  apply(data, { type: 'done', ids: [a.id], done: true });
  apply(data, { type: 'clear-done' });
  assert.deepEqual(data.notes.map((x) => x.id), [c.id]);
});

test('restore: undo a clear, in order, without duplicating what is still there', () => {
  const data = emptyQuickNotes();
  const a = apply(data, { type: 'add', text: 'a' }, 1)!;
  const b = apply(data, { type: 'add', text: 'b' }, 2)!;
  apply(data, { type: 'done', ids: [a.id], done: true }, 5);
  const cleared = data.notes.map((x) => ({ ...x }));
  apply(data, { type: 'remove', ids: [a.id] });
  apply(data, { type: 'restore', notes: [...cleared, { id: 'bad' }, 'junk'] });
  assert.deepEqual(data.notes.map((x) => x.id), [b.id, a.id]);
  assert.equal(data.notes[1].doneAt, at(5).toISOString());
});

test('a full list drops its oldest checked-off notes, and refuses when everything is open', () => {
  const data = emptyQuickNotes();
  for (let i = 0; i < MAX_NOTES; i++) apply(data, { type: 'add', text: `note ${i}` }, i % 60);
  assert.throws(() => apply(data, { type: 'add', text: 'one too many' }), QuickNoteInputError);
  const [oldest, older] = [data.notes[data.notes.length - 1], data.notes[data.notes.length - 2]];
  apply(data, { type: 'done', ids: [older.id], done: true }, 1);
  apply(data, { type: 'done', ids: [oldest.id], done: true }, 2);
  apply(data, { type: 'add', text: 'fits now' });
  assert.equal(data.notes.length, MAX_NOTES);
  assert.ok(!data.notes.some((x) => x.id === older.id), 'the first one checked off goes first');
  assert.ok(data.notes.some((x) => x.id === oldest.id));
});

test('normalize: drops junk and duplicates, sorts newest first', () => {
  assert.deepEqual(normalizeQuickNotes(null), { notes: [] });
  assert.deepEqual(normalizeQuickNotes({ notes: 'nope' }), { notes: [] });
  const data = normalizeQuickNotes({
    notes: [
      { id: 'a', text: 'older', createdAt: '2026-11-01T10:00:00.000Z', doneAt: 'not a date' },
      { id: 'b', text: 'newer', createdAt: '2026-11-02T10:00:00.000Z', from: { path: '/today', title: 7 } },
      { id: 'a', text: 'dup', createdAt: '2026-11-03T10:00:00.000Z' },
      { id: 'c', text: '', createdAt: '2026-11-03T10:00:00.000Z' },
      { id: 'd', text: 'no date' },
      { id: 'has space', text: 'bad id', createdAt: '2026-11-03T10:00:00.000Z' },
    ],
  });
  assert.deepEqual(data.notes.map((x) => x.id), ['b', 'a']);
  assert.equal(data.notes[1].doneAt, undefined);
  assert.deepEqual(data.notes[0].from, { path: '/today' });
});

test('unknown changes are refused', () => {
  assert.throws(() => apply(emptyQuickNotes(), { type: 'wipe' } as unknown as QuickNoteAction), QuickNoteInputError);
});

test('age reads naturally', () => {
  const now = new Date(2026, 10, 20, 15, 0);
  assert.equal(noteAge(new Date(2026, 10, 20, 14, 59, 30).toISOString(), now), 'just now');
  assert.equal(noteAge(new Date(2026, 10, 20, 14, 55).toISOString(), now), '5 min ago');
  assert.equal(noteAge(new Date(2026, 10, 20, 11, 0).toISOString(), now), '4 h ago');
  assert.equal(noteAge(new Date(2026, 10, 19, 23, 0).toISOString(), now), 'yesterday');
  assert.equal(noteAge(new Date(2026, 10, 17, 9, 0).toISOString(), now), 'Tue');
  assert.equal(noteAge(new Date(2026, 10, 3, 9, 0).toISOString(), now), 'Nov 3');
  assert.equal(noteAge(new Date(2025, 10, 3, 9, 0).toISOString(), now), 'Nov 3, 2025');
});
