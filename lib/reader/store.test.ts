import test, { after, before } from 'node:test';
import { strict as assert } from 'node:assert';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { BookMeta, ReaderItem } from './items';
import {
  addBook, appendUpload, bookPath, coverPath, discardUpload, findBook, readLibrary, readProgressFile, readUploadHead, removeBook, renameBook, saveProgress, syncNotes, UploadRefused,
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
