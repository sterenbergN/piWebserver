import { createWriteStream } from 'fs';
import fs from 'fs/promises';
import path from 'path';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';
import { readJson, updateJson } from '@/lib/json-store';
import { emptyNotes, isId, itemsSince, MAX_BOOK_BYTES, mergeChanges, cleanAnchor, type BookMeta, type NotesFile, type Progress } from './items';

// One folder per account. .data/reader holds the list of books, reading positions and
// notes, which every backup keeps. The books themselves sit apart in .data/reader-books,
// so backups can leave them out with the photos and PDFs: they're big and you have the
// originals.

export type ReaderLibrary = { books: BookMeta[]; /** How far each book's notes have got, so a device can tell what it's missing. */ seqs: Record<string, number> };
export type ProgressFile = Record<string, Progress>;

const STALE_UPLOAD_MS = 24 * 60 * 60 * 1000;
/** Uploads stop before they'd fill the Pi's card. */
const KEEP_FREE_BYTES = 2 * 1024 * 1024 * 1024;

function account(userId: string) {
  if (!isId(userId)) throw new Error('Invalid account');
  return userId;
}

export const readerFolder = (userId: string) => path.join(process.cwd(), '.data', 'reader', account(userId));
export const bookFolder = (userId: string) => path.join(process.cwd(), '.data', 'reader-books', account(userId));

export const libraryFile = (userId: string) => path.join(readerFolder(userId), 'library.json');
export const progressFile = (userId: string) => path.join(readerFolder(userId), 'progress.json');
export const notesFolder = (userId: string) => path.join(readerFolder(userId), 'notes');

const notesFile = (userId: string, bookId: string) => {
  if (!isId(bookId)) throw new Error('Invalid book');
  return path.join(notesFolder(userId), `${bookId}.json`);
};

const emptyLibrary = (): ReaderLibrary => ({ books: [], seqs: {} });

export const readLibrary = (userId: string) => readJson<ReaderLibrary>(libraryFile(userId), emptyLibrary());
export const readProgressFile = (userId: string) => readJson<ProgressFile>(progressFile(userId), {});

export function bookPath(userId: string, book: Pick<BookMeta, 'id' | 'format'>) {
  if (!isId(book.id)) throw new Error('Invalid book');
  return path.join(bookFolder(userId), `${book.id}.${book.format}`);
}

export function coverPath(userId: string, bookId: string) {
  if (!isId(bookId)) throw new Error('Invalid book');
  return path.join(bookFolder(userId), 'covers', `${bookId}.jpg`);
}

export async function findBook(userId: string, bookId: string) {
  return (await readLibrary(userId)).books.find((book) => book.id === bookId) ?? null;
}

const uploadPath = (userId: string, uploadId: string) => {
  if (!isId(uploadId)) throw new Error('Invalid upload');
  return path.join(bookFolder(userId), 'incoming', `${uploadId}.tmp`);
};

/** Abandoned uploads from a phone that lost its connection for good. */
async function clearStaleUploads(userId: string) {
  const dir = path.dirname(uploadPath(userId, 'x'));
  for (const name of await fs.readdir(dir).catch(() => [] as string[])) {
    const file = path.join(dir, name);
    const stat = await fs.stat(file).catch(() => null);
    if (stat && Date.now() - stat.mtimeMs > STALE_UPLOAD_MS) await fs.rm(file, { force: true });
  }
}

export class UploadRefused extends Error {}

/**
 * Add one piece of an upload to the file on disk, and answer how much is there. A
 * piece that was sent again after a dropped connection overwrites what's after
 * `offset`, so retrying is always safe. Streams to disk, since a Pi can't hold a
 * big book in memory.
 */
export async function appendUpload(userId: string, uploadId: string, offset: number, body: ReadableStream<Uint8Array>) {
  const file = uploadPath(userId, uploadId);
  await fs.mkdir(path.dirname(file), { recursive: true });
  if (offset === 0) await clearStaleUploads(userId);
  const size = (await fs.stat(file).catch(() => null))?.size ?? 0;
  if (offset > size) throw new UploadRefused('That upload lost its place. Try adding the book again.');
  if (offset + 1 > MAX_BOOK_BYTES) throw new UploadRefused('That book is over the 1 GB limit.');
  const disk = await fs.statfs(path.dirname(file));
  if (Number(disk.bavail) * Number(disk.bsize) < KEEP_FREE_BYTES) throw new UploadRefused('The server is nearly out of space.');
  if (offset < size) await fs.truncate(file, offset);

  let received = 0;
  const counted = async function* (source: AsyncIterable<Uint8Array>) {
    for await (const chunk of source) {
      received += chunk.length;
      if (offset + received > MAX_BOOK_BYTES) throw new UploadRefused('That book is over the 1 GB limit.');
      yield chunk;
    }
  };
  await pipeline(Readable.fromWeb(body as Parameters<typeof Readable.fromWeb>[0]), counted, createWriteStream(file, { flags: 'a' }));
  return offset + received;
}

export const readUploadHead = async (userId: string, uploadId: string) => {
  const handle = await fs.open(uploadPath(userId, uploadId), 'r').catch(() => null);
  if (!handle) return null;
  try {
    const head = new Uint8Array(4096);
    const { bytesRead } = await handle.read(head, 0, head.length, 0);
    return { head: head.subarray(0, bytesRead), size: (await handle.stat()).size };
  } finally {
    await handle.close();
  }
};

export const discardUpload = (userId: string, uploadId: string) => fs.rm(uploadPath(userId, uploadId), { force: true });

/** Move a finished upload into place and list it. */
export async function addBook(userId: string, uploadId: string, book: BookMeta, cover: Buffer | null) {
  const target = bookPath(userId, book);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.rename(uploadPath(userId, uploadId), target);
  if (cover) {
    const file = coverPath(userId, book.id);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, cover);
  }
  await updateJson<ReaderLibrary>(libraryFile(userId), emptyLibrary(), (library) => {
    library.books.push(book);
  });
}

export async function renameBook(userId: string, bookId: string, title: string, author: string) {
  return updateJson<ReaderLibrary, BookMeta | null | false>(libraryFile(userId), emptyLibrary(), (library) => {
    const book = library.books.find((b) => b.id === bookId);
    if (!book) return false;
    book.title = title;
    book.author = author;
    return book;
  });
}

/** Gone from the account, along with its notes, everywhere. */
export async function removeBook(userId: string, bookId: string) {
  const book = await findBook(userId, bookId);
  if (!book) return false;
  await updateJson<ReaderLibrary>(libraryFile(userId), emptyLibrary(), (library) => {
    library.books = library.books.filter((b) => b.id !== bookId);
    delete library.seqs[bookId];
  });
  await updateJson<ProgressFile>(progressFile(userId), {}, (progress) => {
    delete progress[bookId];
  });
  await Promise.all([bookPath(userId, book), coverPath(userId, bookId), notesFile(userId, bookId)].map((file) => fs.rm(file, { force: true })));
  return true;
}

/** Keep each book's newest reading position. */
export async function saveProgress(userId: string, entries: { book: unknown; anchor: unknown; pct: unknown; at: unknown }[], now: number) {
  const known = new Set((await readLibrary(userId)).books.map((b) => b.id));
  await updateJson<ProgressFile, boolean>(progressFile(userId), {}, (progress) => {
    let changed = false;
    for (const entry of entries) {
      const anchor = cleanAnchor(entry.anchor);
      if (!anchor || !isId(entry.book) || !known.has(entry.book) || typeof entry.pct !== 'number' || typeof entry.at !== 'number') continue;
      const at = Math.min(entry.at, now);
      if ((progress[entry.book]?.at ?? 0) >= at) continue;
      progress[entry.book] = { anchor, pct: Math.max(0, Math.min(1, entry.pct)), at };
      changed = true;
    }
    return changed;
  });
}

/** Bring one device's changes in, and answer with everything it hasn't seen. */
export async function syncNotes(userId: string, bookId: string, cursor: number, changes: unknown[], now: number) {
  const out = await updateJson<NotesFile, { seq: number; items: ReturnType<typeof itemsSince>; changed: boolean }>(notesFile(userId, bookId), emptyNotes(), (notes) => {
    const changed = mergeChanges(notes, changes, now);
    return { seq: notes.seq, items: itemsSince(notes, cursor), changed };
  });
  if (out.changed) {
    await updateJson<ReaderLibrary>(libraryFile(userId), emptyLibrary(), (library) => {
      library.seqs[bookId] = out.seq;
    });
  }
  return out;
}
