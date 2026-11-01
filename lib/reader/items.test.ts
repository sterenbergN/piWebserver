import test from 'node:test';
import { strict as assert } from 'node:assert';
import {
  cleanItem, emptyNotes, flowPage, formatFromName, itemsSince, markedPages, markupLength, matchesFormat, mergeChanges, notesByChapter, resolveZipPath,
  splitParagraphs, strokeTouches, textToParagraphs, titleFromName, type ReaderItem,
} from './items';

const NOW = 1_800_000_000_000;

const note = (id: string, updatedAt: number, text = 'a thought', page = 3): ReaderItem => ({ id, kind: 'note', anchor: { page }, createdAt: 1, updatedAt, text });
const ink = (id: string, page: number, deleted = false): ReaderItem => ({
  id, kind: 'ink', anchor: { page }, createdAt: 1, updatedAt: 2, deleted,
  ...(deleted ? {} : { stroke: { tool: 'pen', color: 'ink', width: 0.01, pts: [0, 0, 0.5, 1, 1, 0.5] } }),
});

test('the newest edit of a note wins, whichever device sends it first', () => {
  const notes = emptyNotes();
  mergeChanges(notes, [note('a', 200, 'from the iPad')], NOW);
  mergeChanges(notes, [note('a', 100, 'older, from the phone')], NOW);
  assert.equal(notes.items.a.text, 'from the iPad');
  mergeChanges(notes, [note('a', 300, 'newer')], NOW);
  assert.equal(notes.items.a.text, 'newer');
});

test('two devices writing different things offline both keep their work', () => {
  const notes = emptyNotes();
  mergeChanges(notes, [note('phone', 100)], NOW);
  mergeChanges(notes, [note('ipad', 90)], NOW);
  assert.deepEqual(Object.keys(notes.items).sort(), ['ipad', 'phone']);
});

test('a device only gets what it has not seen', () => {
  const notes = emptyNotes();
  mergeChanges(notes, [note('a', 100), note('b', 100)], NOW);
  const cursor = notes.seq;
  assert.deepEqual(itemsSince(notes, cursor), []);
  mergeChanges(notes, [note('c', 100)], NOW);
  assert.deepEqual(itemsSince(notes, cursor).map((i) => i.id), ['c']);
  assert.equal(itemsSince(notes, 0).length, 3);
});

test('a resend of something already held does not count as new', () => {
  const notes = emptyNotes();
  assert.equal(mergeChanges(notes, [note('a', 100)], NOW), true);
  assert.equal(mergeChanges(notes, [note('a', 100)], NOW), false);
  assert.equal(notes.seq, 1);
});

test('a delete reaches other devices, and drops the content', () => {
  const notes = emptyNotes();
  mergeChanges(notes, [note('a', 100)], NOW);
  mergeChanges(notes, [{ ...note('a', 200), deleted: true }], NOW);
  assert.equal(notes.items.a.deleted, true);
  assert.equal(notes.items.a.text, undefined);
  assert.deepEqual(itemsSince(notes, 1).map((i) => i.id), ['a']);
});

test('a clock set in the future cannot win forever', () => {
  const item = cleanItem(note('a', NOW + 1e9), NOW);
  assert.equal(item?.updatedAt, NOW);
});

test('bad items from a device are refused', () => {
  assert.equal(cleanItem(null, NOW), null);
  assert.equal(cleanItem({ ...note('a', 1), id: '../../etc' }, NOW), null);
  assert.equal(cleanItem({ ...note('a', 1), anchor: { page: 0 } }, NOW), null);
  assert.equal(cleanItem({ ...note('a', 1), text: '   ' }, NOW), null);
  const stroke = ink('a', 1);
  assert.ok(cleanItem(stroke, NOW));
  assert.equal(cleanItem({ ...stroke, stroke: { ...stroke.stroke, pts: [1, 2] } }, NOW), null);
  assert.equal(cleanItem({ ...stroke, stroke: { ...stroke.stroke, pts: [1, 2, Number.NaN] } }, NOW), null);
  assert.equal(cleanItem({ ...stroke, stroke: { ...stroke.stroke, color: '<script>' } }, NOW), null);
});

test('long notes are trimmed, and unknown fields are dropped', () => {
  const item = cleanItem({ ...note('a', 1, 'x'.repeat(30_000)), extra: 'nope' }, NOW)!;
  assert.equal(item.text?.length, 20_000);
  assert.equal('extra' in item, false);
});

test('notes read in book order, under their chapters, skipping marks and deleted ones', () => {
  const items: ReaderItem[] = [
    { ...note('c', 1, 'later', 40), anchor: { page: 40, chapter: 'Two' } },
    { ...note('a', 1, 'first', 2), anchor: { page: 2, chapter: 'One' } },
    { ...note('b', 1, 'second', 3), anchor: { page: 3, chapter: 'One' } },
    { ...note('gone', 1, 'x', 4), anchor: { page: 4, chapter: 'One' }, deleted: true },
    ink('mark', 5),
  ];
  assert.deepEqual(notesByChapter(items).map((g) => [g.chapter, g.notes.map((n) => n.id)]), [['One', ['a', 'b']], ['Two', ['c']]]);
});

test('marked pages are listed once each, in order', () => {
  assert.deepEqual(markedPages([ink('a', 9), ink('b', 2), ink('c', 9), ink('d', 5, true)]).map((a) => a.page), [2, 9]);
});

test('page numbers for flowing books count characters', () => {
  assert.equal(flowPage(0), 1);
  assert.equal(flowPage(1499), 1);
  assert.equal(flowPage(1500), 2);
  assert.equal(flowPage(-5), 1);
});

test('a chapter is measured the same way everywhere, ignoring its markup', () => {
  assert.equal(markupLength('<html><head><title>No</title></head><body><p>Hello</p><script>x</script><p>you</p></body></html>'), 8);
  assert.equal(markupLength('<img src="a.png"/>'), 1);
});

test('file types come from the name and are checked against the first bytes', () => {
  assert.equal(formatFromName('Book.EPUB'), 'epub');
  assert.equal(formatFromName('notes.markdown'), 'md');
  assert.equal(formatFromName('virus.exe'), null);
  const bytes = (text: string) => new TextEncoder().encode(text);
  assert.ok(matchesFormat('pdf', bytes('%PDF-1.7 ...')));
  assert.ok(!matchesFormat('pdf', bytes('<html>')));
  assert.ok(matchesFormat('epub', bytes('PK\x03\x04')));
  assert.ok(!matchesFormat('cbz', bytes('nope')));
  assert.ok(matchesFormat('txt', bytes('Once upon a time')));
  assert.ok(!matchesFormat('txt', new Uint8Array([72, 0, 73])));
});

test('titles are tidied from file names', () => {
  assert.equal(titleFromName('the_long_way__home.epub'), 'the long way home');
  assert.equal(titleFromName('.pdf'), 'Untitled');
});

test('links inside a book resolve against the file they are in', () => {
  assert.equal(resolveZipPath('OEBPS/text/ch1.xhtml', '../images/a%20b.png'), 'OEBPS/images/a b.png');
  assert.equal(resolveZipPath('OEBPS/ch1.xhtml', 'ch2.xhtml#note-3'), 'OEBPS/ch2.xhtml');
  assert.equal(resolveZipPath('ch1.xhtml', './ch2.xhtml'), 'ch2.xhtml');
  assert.equal(resolveZipPath('a/b/c.xhtml', '/top.css'), 'top.css');
  assert.equal(resolveZipPath('a/c.xhtml', '../../../outside.css'), 'outside.css');
});

test('long text is split into sections without breaking paragraphs', () => {
  const sections = splitParagraphs(['a'.repeat(40), 'b'.repeat(40), 'c'.repeat(40)], 50);
  assert.deepEqual(sections.map((s) => s.length), [1, 1, 1]);
  assert.deepEqual(splitParagraphs(['short', 'too'], 50), [['short', 'too']]);
});

test('plain text becomes paragraphs, safely', () => {
  assert.deepEqual(textToParagraphs('One\nline two\r\n\r\n<b>Two</b>\n\n\n'), ['<p>One<br>line two</p>', '<p>&lt;b&gt;Two&lt;/b&gt;</p>']);
});

test('the eraser touches strokes along their length, not just at their points', () => {
  const line = [0, 0, 0.5, 10, 0, 0.5];
  assert.ok(strokeTouches(line, 5, 0.5, 1));
  assert.ok(!strokeTouches(line, 5, 2, 1));
  assert.ok(strokeTouches([3, 3, 0.5], 3.5, 3, 1));
});
