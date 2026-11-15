import test, { after, before } from 'node:test';
import { strict as assert } from 'node:assert';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  booksInProgress, cleanProgress, entrySeries, inSeriesOrder, nextProgress, progressNewer, seriesOnShelf, setAside, shelfEntries, withSetAside, type BookMeta, type Progress,
} from './items';
import {
  addMadeBook, FolderError, linkBooks, orderSeries, readLibrary, readProgressFile, removeBook, removeSeries, renameSeries, saveProgress, setChapters, setSeries, unlinkBook,
} from './store';

// How the shelf is put together: a book and its audio book as one, books in a series, and
// what's on Continue reading.

const NOW = 1_800_000_000_000;
const USER = 'shelf-test';
const original = process.cwd();
let dir = '';

before(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'reader-shelf-'));
  process.chdir(dir);
});

after(async () => {
  process.chdir(original);
  await fs.rm(dir, { recursive: true, force: true });
});

const book = (id: string, format: BookMeta['format'] = 'epub', more: Partial<BookMeta> = {}): BookMeta => ({
  id, title: `Book ${id}`, author: '', format, size: 4, addedAt: new Date(NOW).toISOString(), hasCover: false,
  ...(format === 'audio' ? { audio: { duration: 600, chapters: [] } } : {}), ...more,
});

async function shelve(meta: BookMeta) {
  const file = path.join(dir, `${meta.id}.tmp`);
  await fs.writeFile(file, 'data');
  await addMadeBook(USER, file, meta, null);
}

const held = async (id: string) => (await readLibrary(USER)).books.find((b) => b.id === id)!;

test('a book set aside leaves Continue reading until it’s opened again', () => {
  const reading: Progress = { anchor: { page: 5 }, pct: 0.2, at: 1000, startedAt: 900 };
  const books = [{ id: 'a' }, { id: 'b' }];
  assert.deepEqual(booksInProgress(books, { a: reading, b: { ...reading, at: 2000 } }).map((b) => b.id), ['b', 'a']);

  const aside = withSetAside(reading, 5000);
  assert.ok(setAside(aside));
  assert.equal(aside.pct, 0.2, 'your place is kept');
  assert.deepEqual(booksInProgress(books, { a: aside, b: reading }).map((b) => b.id), ['b']);
  assert.ok(progressNewer(aside, reading), 'the same reading, set aside since, is the later word');
  assert.ok(!progressNewer(reading, aside));

  // Reading on puts it back, on whichever device.
  const again = nextProgress(aside, { anchor: { page: 6 }, pct: 0.25, total: 100, atEnd: false }, 6000);
  assert.ok(!setAside(again));
  assert.ok(progressNewer(again, aside));
  // A device whose clock runs behind still can't set aside something read later than it thinks.
  assert.ok(withSetAside({ ...reading, at: 9000 }, 5000).hiddenAt! >= 9000);
  assert.equal(cleanProgress({ ...aside }, 10_000)?.hiddenAt, 5000, 'it survives the trip to the server');
});

test('the server keeps a set-aside, and the newer of two', async () => {
  await shelve(book('p1'));
  const reading = { book: 'p1', anchor: { page: 5 }, pct: 0.2, at: NOW - 5000, startedAt: NOW - 9000 };
  await saveProgress(USER, [reading], NOW);
  await saveProgress(USER, [{ ...reading, hiddenAt: NOW - 1000 }], NOW);
  assert.equal((await readProgressFile(USER)).p1.hiddenAt, NOW - 1000);
  await saveProgress(USER, [reading], NOW);
  assert.equal((await readProgressFile(USER)).p1.hiddenAt, NOW - 1000, 'an older copy without it doesn’t undo it');
  await saveProgress(USER, [{ ...reading, at: NOW - 500, pct: 0.3 }], NOW);
  assert.equal((await readProgressFile(USER)).p1.hiddenAt, undefined, 'reading on does');
});

test('a book and its audio book share a place on the shelf, text first', async () => {
  await shelve(book('audio1', 'audio'));
  await shelve(book('text1', 'pdf'));
  await shelve(book('alone'));
  await assert.rejects(linkBooks(USER, ['text1']), FolderError);
  await assert.rejects(linkBooks(USER, ['text1', 'nope']), FolderError);
  await linkBooks(USER, ['audio1', 'text1']);
  const library = await readLibrary(USER);
  const entries = shelfEntries(library.books.filter((b) => b.id !== 'p1'));
  assert.deepEqual(entries.map((e) => e.books.map((b) => b.id)), [['text1', 'audio1'], ['alone']]);
  assert.ok((await held('text1')).work && (await held('text1')).work === (await held('audio1')).work);

  // A second audio version joins the same book.
  await shelve(book('audio2', 'audio'));
  await linkBooks(USER, ['audio2', 'text1']);
  assert.equal((await held('audio2')).work, (await held('text1')).work);
  await unlinkBook(USER, 'audio2');
  assert.equal((await held('audio2')).work, undefined);
  assert.ok((await held('text1')).work, 'the other two stay together');

  // Deleting one form leaves the other as an ordinary book.
  await removeBook(USER, 'audio1');
  assert.equal((await held('text1')).work, undefined);
  await removeBook(USER, 'audio2');
});

test('books go into a series in order, with every form of each', async () => {
  for (const id of ['s1', 's2', 's3']) await shelve(book(id));
  await shelve(book('s2-audio', 'audio'));
  await linkBooks(USER, ['s2', 's2-audio']);
  await assert.rejects(setSeries(USER, ['s1'], '   '), FolderError);

  await setSeries(USER, ['s2', 's1'], ' The  Saga ');
  assert.deepEqual([(await held('s2')).seriesIndex, (await held('s1')).seriesIndex], [1, 2], 'in the order given');
  assert.equal((await held('s2-audio')).series, 'The Saga', 'the audio book comes with its text');
  assert.equal((await held('s2-audio')).seriesIndex, 1);

  await setSeries(USER, ['s3', 's1'], 'the saga');
  assert.equal((await held('s3')).series, 'The Saga', 'the name as it was first written');
  assert.equal((await held('s3')).seriesIndex, 3, 'after the ones already there');
  assert.equal((await held('s1')).seriesIndex, 2, 'one already in it keeps its place');

  let books = (await readLibrary(USER)).books;
  assert.deepEqual(seriesOnShelf(books), [{ name: 'The Saga', count: 3 }]);
  const inOrder = () => inSeriesOrder(shelfEntries(books).filter((e) => entrySeries(e)?.name === 'The Saga')).map((e) => e.books[0].id);
  assert.deepEqual(inOrder(), ['s2', 's1', 's3']);

  await orderSeries(USER, 'The Saga', ['s1', 's2-audio']);
  books = (await readLibrary(USER)).books;
  assert.deepEqual(inOrder(), ['s1', 's2', 's3'], 'the ones left out follow');
  assert.equal((await held('s2')).seriesIndex, (await held('s2-audio')).seriesIndex);

  await setSeries(USER, ['s3'], 'Another');
  await assert.rejects(renameSeries(USER, 'The Saga', 'another'), FolderError, 'not onto a series that’s there');
  await renameSeries(USER, 'The Saga', 'The Long Saga');
  assert.equal((await held('s1')).series, 'The Long Saga');

  await setSeries(USER, ['s2-audio'], null);
  assert.equal((await held('s2')).series, undefined, 'taken out with its other form');
  await removeSeries(USER, 'The Long Saga');
  assert.equal((await held('s1')).series, undefined);
  assert.ok(await held('s1'), 'the book itself stays');
});

test('an audio book’s chapters can be changed, and only an audio book’s', async () => {
  await shelve(book('listen', 'audio'));
  const saved = await setChapters(USER, 'listen', [{ start: 300, title: 'Two' }, { start: 0, title: 'One' }, { start: 9999, title: 'Past the end' }]);
  assert.ok(saved);
  assert.deepEqual((await held('listen')).audio, { duration: 600, chapters: [{ start: 0, title: 'One' }, { start: 300, title: 'Two' }] });
  await setChapters(USER, 'listen', []);
  assert.deepEqual((await held('listen')).audio?.chapters, []);
  assert.equal(await setChapters(USER, 's1', [{ start: 0, title: 'x' }]), false);
  assert.equal(await setChapters(USER, 'nope', []), false);
});
