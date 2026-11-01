import test, { after, before } from 'node:test';
import { strict as assert } from 'node:assert';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { BookMeta, ReaderItem } from './items';
import {
  addBook, addFolder, appendUpload, bookPath, coverFrom, coverPath, discardUpload, fillBookDetails, findBook, FolderError, importPublicBook, moveBooks, readLibrary, readProgressFile, readUploadHead,
  removeBook, removeFolder, renameBook, renameFolder, saveProgress, syncNotes, UploadRefused,
} from './store';

const NOW = 1_800_000_000_000;
const original = process.cwd();
let dir = '';

before(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'reader-store-'));
  process.chdir(dir);
});

after(async () => {
  process.chdir(original);
  await fs.rm(dir, { recursive: true, force: true });
});

const stream = (text: string) => new Blob([text]).stream() as ReadableStream<Uint8Array>;
const book = (id: string): BookMeta => ({ id, title: 'A book', author: '', format: 'pdf', size: 8, addedAt: new Date(NOW).toISOString(), hasCover: false });
const note = (id: string, updatedAt: number, text = 'hello'): ReaderItem => ({ id, kind: 'note', anchor: { page: 2 }, createdAt: 1, updatedAt, text });

test('a book goes up in pieces, and a resent piece is not doubled', async () => {
  assert.equal(await appendUpload('ann', 'up1', 0, stream('%PDF')), 4);
  assert.equal(await appendUpload('ann', 'up1', 4, stream('-1.7')), 8);
  // The connection dropped after that piece landed, so the phone sends it again.
  assert.equal(await appendUpload('ann', 'up1', 4, stream('-1.7')), 8);
  const upload = await readUploadHead('ann', 'up1');
  assert.equal(upload?.size, 8);
  assert.equal(new TextDecoder().decode(upload?.head), '%PDF-1.7');
  await discardUpload('ann', 'up1');
});

test('a piece that skips ahead is refused rather than leaving a hole', async () => {
  await assert.rejects(appendUpload('ann', 'up2', 100, stream('x')), UploadRefused);
  await discardUpload('ann', 'up2');
});

test('paths from a request cannot leave the account folder', async () => {
  await assert.rejects(appendUpload('ann', '../../evil', 0, stream('x')), /Invalid/);
  await assert.rejects(appendUpload('../bob', 'up', 0, stream('x')), /Invalid/);
  await assert.rejects(syncNotes('ann', '../../library', 0, [], NOW), /Invalid/);
  assert.throws(() => coverPath('ann', '../x'), /Invalid/);
});

test('a finished upload is listed, and only for its owner', async () => {
  await appendUpload('ann', 'up3', 0, stream('%PDF-1.7'));
  await addBook('ann', 'up3', book('b1'), Buffer.from([0xff, 0xd8]));
  assert.equal((await readLibrary('ann')).books.length, 1);
  assert.equal(await fs.readFile(bookPath('ann', book('b1')), 'utf-8'), '%PDF-1.7');
  assert.ok(await fs.stat(coverPath('ann', 'b1')));
  assert.equal(await readUploadHead('ann', 'up3'), null);
  assert.equal(await findBook('bob', 'b1'), null);
  assert.equal((await readLibrary('bob')).books.length, 0);
});

test('books can be renamed, and an unknown one says so', async () => {
  const renamed = await renameBook('ann', 'b1', 'New name', 'Someone');
  assert.equal(renamed && renamed.title, 'New name');
  assert.equal(await renameBook('ann', 'nope', 'x', ''), false);
});

test('two devices stay in step through the server', async () => {
  const phone = await syncNotes('ann', 'b1', 0, [note('from-phone', 100)], NOW);
  assert.deepEqual(phone.items.map((i) => i.id), ['from-phone']);
  assert.equal((await readLibrary('ann')).seqs.b1, phone.seq);

  // The iPad has never synced: it sends its own and gets the phone's.
  const ipad = await syncNotes('ann', 'b1', 0, [note('from-ipad', 90)], NOW);
  assert.deepEqual(ipad.items.map((i) => i.id).sort(), ['from-ipad', 'from-phone']);

  // The phone comes back, and only hears about what's new to it.
  const again = await syncNotes('ann', 'b1', phone.seq, [], NOW);
  assert.deepEqual(again.items.map((i) => i.id), ['from-ipad']);
  assert.equal((await syncNotes('ann', 'b1', again.seq, [], NOW)).items.length, 0);
});

test('reading positions keep the newest, and ignore books that are not yours', async () => {
  await saveProgress('ann', [{ book: 'b1', anchor: { page: 9 }, pct: 0.5, at: 200 }], NOW);
  await saveProgress('ann', [{ book: 'b1', anchor: { page: 2 }, pct: 0.1, at: 100 }], NOW);
  await saveProgress('ann', [{ book: 'someone-elses', anchor: { page: 2 }, pct: 0.1, at: 300 }], NOW);
  const progress = await readProgressFile('ann');
  assert.equal(progress.b1.anchor.page, 9);
  assert.equal(progress['someone-elses'], undefined);
});

test('reading progress keeps its detail on the server', async () => {
  await saveProgress('ann', [{ book: 'b1', anchor: { page: 40 }, pct: 0.8, at: 300, total: 50, startedAt: 90, finishedAt: 300 }], NOW);
  const { b1 } = await readProgressFile('ann');
  assert.equal(b1.total, 50);
  assert.equal(b1.startedAt, 90);
  assert.equal(b1.finishedAt, 300);
});

test('folders hold books, and removing one leaves the books alone', async () => {
  const sci = await addFolder('ann', 'Sci fi');
  assert.equal((await addFolder('ann', 'sci FI')).id, sci.id, 'the same name is the same folder');
  await assert.rejects(addFolder('ann', '   '), FolderError);
  await renameFolder('ann', sci.id, 'Science fiction');
  assert.equal((await readLibrary('ann')).folders[0].name, 'Science fiction');

  await moveBooks('ann', ['b1', 'not-a-book'], sci.id);
  assert.equal((await findBook('ann', 'b1'))?.folder, sci.id);
  await assert.rejects(moveBooks('ann', ['b1'], 'no-such-folder'), FolderError);
  assert.equal((await findBook('ann', 'b1'))?.folder, sci.id);
  await moveBooks('ann', ['b1'], null);
  assert.equal((await findBook('ann', 'b1'))?.folder, undefined);

  await moveBooks('ann', ['b1'], sci.id);
  await removeFolder('ann', sci.id);
  const library = await readLibrary('ann');
  assert.equal(library.folders.length, 0);
  assert.equal(library.books.find((b) => b.id === 'b1')?.folder, undefined);
  assert.ok(await findBook('ann', 'b1'));
  await assert.rejects(renameFolder('ann', sci.id, 'Back'), FolderError);
});

test('folders are private to their account', async () => {
  await addFolder('ann', 'Mine');
  assert.equal((await readLibrary('bob')).folders.length, 0);
});

test('a shelf saved before folders existed still opens', async () => {
  const file = path.join(dir, '.data', 'reader', 'old', 'library.json');
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify({ books: [book('o1')], seqs: {} }));
  assert.deepEqual((await readLibrary('old')).folders, []);
  const folder = await addFolder('old', 'New');
  await moveBooks('old', ['o1'], folder.id);
  assert.equal((await findBook('old', 'o1'))?.folder, folder.id);
});

test('a book from the public Library becomes a separate private copy', async () => {
  const shelf = path.join(dir, 'public', 'uploads', 'library');
  await fs.mkdir(shelf, { recursive: true });
  const url = '/api/media/uploads/library/1-guide.pdf';
  await fs.writeFile(path.join(shelf, '1-guide.pdf'), '%PDF-1.7 a guide');
  await fs.writeFile(path.join(shelf, 'library.json'), JSON.stringify([{ url, name: 'The Guide', category: 'Manuals' }]));
  const folder = await addFolder('cam', 'Manuals');

  const { book: copy, already } = await importPublicBook('cam', url, folder.id);
  assert.equal(already, false);
  assert.equal(copy.title, 'The Guide');
  assert.equal(copy.format, 'pdf');
  assert.equal(copy.source, url);
  assert.equal(copy.folder, folder.id);
  assert.equal(await fs.readFile(bookPath('cam', copy), 'utf-8'), '%PDF-1.7 a guide');

  // Adding it again is the same book, not a second copy with no notes.
  const again = await importPublicBook('cam', url, undefined);
  assert.equal(again.already, true);
  assert.equal(again.book.id, copy.id);
  assert.equal((await readLibrary('cam')).books.length, 1);

  // Each account gets its own, and the public list is untouched.
  assert.notEqual((await importPublicBook('dee', url, undefined)).book.id, copy.id);
  assert.equal(JSON.parse(await fs.readFile(path.join(shelf, 'library.json'), 'utf-8')).length, 1);

  // Taken off the Library, the copy stays.
  await fs.rm(path.join(shelf, '1-guide.pdf'));
  assert.equal(await fs.readFile(bookPath('cam', copy), 'utf-8'), '%PDF-1.7 a guide');
});

test('only books listed in the Library right now can be imported', async () => {
  const shelf = path.join(dir, 'public', 'uploads', 'library');
  await fs.writeFile(path.join(shelf, 'secret.pdf'), '%PDF-1.7 not listed');
  await fs.writeFile(path.join(shelf, 'library.json'), JSON.stringify([{ url: '/api/media/uploads/library/gone.pdf', name: 'Gone' }, { url: '/api/media/uploads/library/fake.pdf', name: 'Fake' }]));
  await fs.writeFile(path.join(shelf, 'fake.pdf'), 'not a pdf');
  await assert.rejects(importPublicBook('eve', '/api/media/uploads/library/secret.pdf', undefined), FolderError);
  await assert.rejects(importPublicBook('eve', '/api/media/uploads/library/../../../.data/reader/ann/library.json', undefined), FolderError);
  await assert.rejects(importPublicBook('eve', '/api/media/uploads/library/gone.pdf', undefined), /missing/);
  await assert.rejects(importPublicBook('eve', '/api/media/uploads/library/fake.pdf', undefined), /doesn.t look like/);
  assert.equal((await readLibrary('eve')).books.length, 0);
});

test('a device can fill in a cover and author, but not overwrite an author', async () => {
  await appendUpload('fay', 'up9', 0, stream('%PDF-1.7'));
  await addBook('fay', 'up9', { ...book('f1'), author: 'Kept' }, null);
  const cover = coverFrom(`data:image/jpeg;base64,${Buffer.from([0xff, 0xd8, 1]).toString('base64')}`);
  assert.ok(cover);
  const filled = await fillBookDetails('fay', 'f1', cover, 'Someone else');
  assert.ok(filled);
  assert.equal(filled && filled.hasCover, true);
  assert.equal(filled && filled.author, 'Kept');
  assert.ok(await fs.stat(coverPath('fay', 'f1')));
  assert.equal(await fillBookDetails('fay', 'nope', null, ''), false);
  assert.equal(coverFrom('data:image/png;base64,AAAA'), null);
  assert.equal(coverFrom(`data:image/jpeg;base64,${Buffer.from('not a jpeg').toString('base64')}`), null);
});

test('deleting a book takes its file, cover, notes and position with it', async () => {
  assert.equal(await removeBook('ann', 'b1'), true);
  assert.equal(await findBook('ann', 'b1'), null);
  assert.equal(await fs.stat(bookPath('ann', book('b1'))).catch(() => null), null);
  assert.equal(await fs.stat(coverPath('ann', 'b1')).catch(() => null), null);
  assert.equal((await readLibrary('ann')).seqs.b1, undefined);
  assert.equal((await readProgressFile('ann')).b1, undefined);
  assert.equal((await syncNotes('ann', 'b1', 0, [], NOW)).items.length, 0);
  assert.equal(await removeBook('ann', 'b1'), false);
});
