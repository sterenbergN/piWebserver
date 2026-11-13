import crypto from 'crypto';
import { createWriteStream } from 'fs';
import fs from 'fs/promises';
import path from 'path';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';
import { readJson, updateJson } from '@/lib/json-store';
import {
  cleanFolderName, cleanProgress, emptyNotes, formatFromName, isId, itemsSince, matchesFormat, MAX_BOOK_BYTES, MAX_FOLDERS, mergeChanges, publicLibraryFile,
  titleFromName, type BookMeta, type Folder, type NotesFile, type Progress,
} from './items';

// One folder per account. .data/reader holds the list of books, reading positions and
// notes, which every backup keeps. The books themselves sit apart in .data/reader-books,
// so backups can leave them out with the photos and PDFs: they're big and you have the
// originals.

export type ReaderLibrary = { books: BookMeta[]; folders: Folder[]; /** How far each book's notes have got, so a device can tell what it's missing. */ seqs: Record<string, number> };
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

const emptyLibrary = (): ReaderLibrary => ({ books: [], folders: [], seqs: {} });

export const readLibrary = async (userId: string): Promise<ReaderLibrary> => ({ ...emptyLibrary(), ...(await readJson<Partial<ReaderLibrary>>(libraryFile(userId), {})) });

/** Change the shelf, and answer with whatever the change says. Answering `false` leaves it as it was. */
function updateLibrary<R>(userId: string, mutate: (library: ReaderLibrary) => R) {
  return updateJson<ReaderLibrary, R>(libraryFile(userId), emptyLibrary(), (library) => {
    Object.assign(library, { ...emptyLibrary(), ...library });
    return mutate(library);
  });
}
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

async function assertRoom(folder: string, bytes: number) {
  const disk = await fs.statfs(folder);
  if (Number(disk.bavail) * Number(disk.bsize) - bytes < KEEP_FREE_BYTES) throw new UploadRefused('The server is nearly out of space.');
}

/** A cover sent by a device, if it really is a small JPEG. */
const MAX_COVER_BASE64 = 700_000;
export function coverFrom(value: unknown) {
  if (typeof value !== 'string' || !value.startsWith('data:image/jpeg;base64,') || value.length > MAX_COVER_BASE64) return null;
  const bytes = Buffer.from(value.slice(value.indexOf(',') + 1), 'base64');
  return bytes[0] === 0xff && bytes[1] === 0xd8 ? bytes : null;
}

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
  await assertRoom(path.dirname(file), 0);
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
  await updateLibrary(userId, (library) => {
    // A folder deleted on another device while this was uploading.
    if (book.folder && !library.folders.some((f) => f.id === book.folder)) delete book.folder;
    library.books.push(book);
  });
}

/** Shelve a book made here on the server (an audio book): its file is moved in from `source`, on the same disk. */
export async function addMadeBook(userId: string, source: string, book: BookMeta, cover: Buffer | null) {
  const target = bookPath(userId, book);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.rename(source, target);
  if (cover) {
    const file = coverPath(userId, book.id);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, cover);
  }
  await updateLibrary(userId, (library) => {
    if (book.folder && !library.folders.some((f) => f.id === book.folder)) delete book.folder;
    library.books.push(book);
  });
}

const newId = () => crypto.randomBytes(9).toString('base64url');

export class FolderError extends Error {}

export async function addFolder(userId: string, rawName: unknown) {
  const name = cleanFolderName(rawName);
  if (!name) throw new FolderError('A folder needs a name.');
  return updateLibrary<Folder>(userId, (library) => {
    const same = library.folders.find((f) => f.name.toLowerCase() === name.toLowerCase());
    if (same) return same;
    if (library.folders.length >= MAX_FOLDERS) throw new FolderError('That’s a lot of folders. Remove one first.');
    const folder = { id: newId(), name };
    library.folders.push(folder);
    return folder;
  });
}

export async function renameFolder(userId: string, folderId: unknown, rawName: unknown) {
  const name = cleanFolderName(rawName);
  if (!name) throw new FolderError('A folder needs a name.');
  await updateLibrary(userId, (library) => {
    const folder = library.folders.find((f) => f.id === folderId);
    if (!folder) throw new FolderError('That folder isn’t here any more.');
    folder.name = name;
  });
}

/** The folder goes. Its books stay on the shelf, just not in a folder. */
export async function removeFolder(userId: string, folderId: unknown) {
  await updateLibrary(userId, (library) => {
    library.folders = library.folders.filter((f) => f.id !== folderId);
    for (const book of library.books) {
      if (book.folder === folderId) delete book.folder;
    }
  });
}

/** Put books in a folder, or take them out with null. */
export async function moveBooks(userId: string, bookIds: unknown[], folderId: unknown) {
  await updateLibrary(userId, (library) => {
    if (folderId !== null && !library.folders.some((f) => f.id === folderId)) throw new FolderError('That folder isn’t here any more.');
    const moving = new Set(bookIds);
    for (const book of library.books) {
      if (!moving.has(book.id)) continue;
      if (folderId === null) delete book.folder;
      else book.folder = folderId as string;
    }
  });
}

type PublicDocument = { url?: unknown; name?: unknown };

/**
 * Copy a book from the public Library onto this account's private shelf. It has to
 * be listed there right now, so this can't reach any other file, and the copy stands
 * alone: taking it off the Library doesn't touch it, and nothing here shows there.
 */
export async function importPublicBook(userId: string, url: unknown, folderId: unknown) {
  const folder = path.join(process.cwd(), 'public', 'uploads', 'library');
  const listed = await readJson<PublicDocument[]>(path.join(folder, 'library.json'), []);
  const fileName = publicLibraryFile(url);
  const document = Array.isArray(listed) ? listed.find((doc) => doc.url === url) : undefined;
  if (!fileName || !document) throw new FolderError('That isn’t in the Library any more.');
  const format = formatFromName(fileName);
  if (!format) throw new FolderError('The Reader can’t open that kind of file.');

  const held = (await readLibrary(userId)).books.find((book) => book.source === url);
  if (held) return { book: held, already: true };

  const source = path.join(folder, fileName);
  const stat = await fs.stat(source).catch(() => null);
  if (!stat) throw new FolderError('That file is missing from the Library.');
  const handle = await fs.open(source, 'r');
  const head = new Uint8Array(4096);
  const { bytesRead } = await handle.read(head, 0, head.length, 0).finally(() => handle.close());
  if (!matchesFormat(format, head.subarray(0, bytesRead))) throw new FolderError(`That file doesn’t look like a ${format.toUpperCase()}.`);

  const book: BookMeta = {
    id: newId(),
    title: typeof document.name === 'string' && document.name.trim() ? document.name.trim().slice(0, 300) : titleFromName(fileName),
    author: '',
    format,
    size: stat.size,
    addedAt: new Date().toISOString(),
    hasCover: false,
    source: url as string,
    ...(typeof folderId === 'string' ? { folder: folderId } : {}),
  };
  const uploadId = newId();
  const incoming = uploadPath(userId, uploadId);
  await fs.mkdir(path.dirname(incoming), { recursive: true });
  await assertRoom(path.dirname(incoming), stat.size);
  await fs.copyFile(source, incoming);
  await addBook(userId, uploadId, book, null);
  return { book, already: false };
}

/** A cover made by the device, and an author found in the file. Neither replaces one already there. */
export async function fillBookDetails(userId: string, bookId: string, cover: Buffer | null, author: string) {
  const held = await findBook(userId, bookId);
  if (!held) return false;
  if (cover && !held.hasCover) {
    const file = coverPath(userId, bookId);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, cover);
  }
  return updateLibrary<BookMeta | false>(userId, (library) => {
    const book = library.books.find((b) => b.id === bookId);
    if (!book) return false;
    if (cover) book.hasCover = true;
    if (author && !book.author) book.author = author;
    return book;
  });
}

export async function renameBook(userId: string, bookId: string, title: string, author: string) {
  return updateLibrary<BookMeta | false>(userId, (library) => {
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
  await updateLibrary(userId, (library) => {
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
export async function saveProgress(userId: string, entries: ({ book: unknown } & Parameters<typeof cleanProgress>[0])[], now: number) {
  const known = new Set((await readLibrary(userId)).books.map((b) => b.id));
  await updateJson<ProgressFile, boolean>(progressFile(userId), {}, (progress) => {
    let changed = false;
    for (const entry of entries) {
      const clean = cleanProgress(entry, now);
      if (!clean || !isId(entry.book) || !known.has(entry.book)) continue;
      if ((progress[entry.book]?.at ?? 0) >= clean.at) continue;
      progress[entry.book] = clean;
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
    await updateLibrary(userId, (library) => {
      library.seqs[bookId] = out.seq;
    });
  }
  return out;
}
