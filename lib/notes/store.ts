import { createReadStream, createWriteStream } from 'fs';
import fs from 'fs/promises';
import path from 'path';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';
import { readJson, updateJson } from '@/lib/json-store';
import {
  cleanBookRecord, cleanElement, cleanLibraryRecord, emptyFile, isId, MAX_FILE_BYTES, mergeChanges, recordsSince, sniffFile, type BookRecord, type LibraryRecord, type PageElement, type RecordFile,
} from './items';

// One folder per account, and inside it one file for the library, one for each notebook's
// list of pages, and one for each page's contents, so saving a stroke rewrites that page and
// nothing bigger. .data/notes goes in every backup. PDFs, pictures and recordings sit apart in
// .data/notes-files, so backups can leave them out with the photos and PDFs: they can be big.

/** How far each notebook has got, so a device can tell which ones it's behind on without asking each one. */
export type LibraryFile = RecordFile<LibraryRecord> & { revs: Record<string, number> };
export type BookFile = RecordFile<BookRecord> & { pageSeqs: Record<string, number> };

const STALE_UPLOAD_MS = 24 * 60 * 60 * 1000;
/** Uploads stop before they'd fill the Pi's card. */
const KEEP_FREE_BYTES = 2 * 1024 * 1024 * 1024;

function safe(id: string, what: string) {
  if (!isId(id)) throw new Error(`Invalid ${what}`);
  return id;
}

export const notesFolder = (userId: string) => path.join(process.cwd(), '.data', 'notes', safe(userId, 'account'));
const filesFolder = (userId: string) => path.join(process.cwd(), '.data', 'notes-files', safe(userId, 'account'));
const libraryPath = (userId: string) => path.join(notesFolder(userId), 'library.json');
const bookFolder = (userId: string, notebook: string) => path.join(notesFolder(userId), 'books', safe(notebook, 'notebook'));
const bookPath = (userId: string, notebook: string) => path.join(bookFolder(userId, notebook), 'book.json');
const pagePath = (userId: string, notebook: string, page: string) => path.join(bookFolder(userId, notebook), 'pages', `${safe(page, 'page')}.json`);
const storedFile = (userId: string, notebook: string, file: string) => path.join(filesFolder(userId), safe(notebook, 'notebook'), safe(file, 'file'));
const incomingFile = (userId: string, notebook: string, file: string) => `${storedFile(userId, notebook, file)}.incoming`;

const emptyLibrary = (): LibraryFile => ({ ...emptyFile<LibraryRecord>(), revs: {} });
const emptyBook = (): BookFile => ({ ...emptyFile<BookRecord>(), pageSeqs: {} });

export const readLibrary = async (userId: string) => ({ ...emptyLibrary(), ...(await readJson<Partial<LibraryFile>>(libraryPath(userId), {})) });

/** A notebook that's on this account and hasn't been deleted for good. */
async function hasNotebook(userId: string, notebook: string) {
  const record = (await readLibrary(userId)).items[notebook];
  return record?.kind === 'notebook' && !record.deleted;
}

const bumpRev = (userId: string, notebook: string) => updateJson<LibraryFile>(libraryPath(userId), emptyLibrary(), (library) => {
  library.revs = library.revs ?? {};
  library.revs[notebook] = (library.revs[notebook] ?? 0) + 1;
});

/** A device's changes to the library go in, and what it hasn't seen comes back. */
export async function syncLibrary(userId: string, cursor: number, changes: unknown[], now: number) {
  const { seq, items, removed, revs } = await updateJson<LibraryFile, { seq: number; items: LibraryRecord[]; removed: string[]; revs: Record<string, number> }>(libraryPath(userId), emptyLibrary(), (library) => {
    library.revs = library.revs ?? {};
    // Deleted for good stays deleted: its pages are gone, so a late edit from a device that had it open can't bring back an empty shell.
    const allowed = changes.filter((raw) => {
      const held = library.items[(raw as { id?: string } | null)?.id ?? ''];
      return !(held?.kind === 'notebook' && held.deleted);
    });
    const accepted = mergeChanges(library, allowed, cleanLibraryRecord, now);
    const gone = accepted.filter((record) => record.kind === 'notebook' && record.deleted).map((record) => record.id);
    for (const id of gone) delete library.revs[id];
    return { seq: library.seq, items: recordsSince(library, cursor), removed: gone, revs: library.revs };
  });
  // Deleted for good from the trash: the pages and files go with it, on the server.
  await Promise.all(removed.flatMap((id) => [
    fs.rm(bookFolder(userId, id), { recursive: true, force: true }),
    fs.rm(path.join(filesFolder(userId), id), { recursive: true, force: true }),
  ]));
  return { cursor: seq, items, revs };
}

export class NotebookGone extends Error {}

/** The same for a notebook's list of pages and recordings. `pageSeqs` says how far each page's contents have got. */
export async function syncBook(userId: string, notebook: string, cursor: number, changes: unknown[], now: number) {
  if (!(await hasNotebook(userId, notebook))) throw new NotebookGone();
  const out = await updateJson<BookFile, { seq: number; items: BookRecord[]; pageSeqs: Record<string, number>; changed: boolean }>(bookPath(userId, notebook), emptyBook(), (book) => {
    book.pageSeqs = book.pageSeqs ?? {};
    const changed = mergeChanges(book, changes, cleanBookRecord, now).length > 0;
    return { seq: book.seq, items: recordsSince(book, cursor), pageSeqs: book.pageSeqs, changed };
  });
  if (out.changed) await bumpRev(userId, notebook);
  return { cursor: out.seq, items: out.items, pageSeqs: out.pageSeqs };
}

/** And for what's on one page. */
export async function syncPage(userId: string, notebook: string, page: string, cursor: number, changes: unknown[], now: number) {
  if (!(await hasNotebook(userId, notebook))) throw new NotebookGone();
  const out = await updateJson<RecordFile<PageElement>, { seq: number; items: PageElement[]; changed: boolean }>(pagePath(userId, notebook, page), emptyFile<PageElement>(), (file) => {
    const changed = mergeChanges(file, changes, cleanElement, now).length > 0;
    return { seq: file.seq, items: recordsSince(file, cursor), changed };
  });
  if (out.changed) {
    await updateJson<BookFile>(bookPath(userId, notebook), emptyBook(), (book) => {
      book.pageSeqs = { ...book.pageSeqs, [page]: out.seq };
    });
    await bumpRev(userId, notebook);
  }
  return { cursor: out.seq, items: out.items };
}

export class UploadRefused extends Error {}

async function assertRoom(folder: string) {
  const disk = await fs.statfs(folder);
  if (Number(disk.bavail) * Number(disk.bsize) < KEEP_FREE_BYTES) throw new UploadRefused('The server is nearly out of space.');
}

/** Pieces from a phone that lost its connection for good. */
async function clearStaleUploads(folder: string) {
  for (const name of await fs.readdir(folder).catch(() => [] as string[])) {
    if (!name.endsWith('.incoming')) continue;
    const file = path.join(folder, name);
    const stat = await fs.stat(file).catch(() => null);
    if (stat && Date.now() - stat.mtimeMs > STALE_UPLOAD_MS) await fs.rm(file, { force: true });
  }
}

/**
 * Add one piece of a file, and answer how much is there. A piece sent again after a dropped
 * connection overwrites what's after `offset`, so retrying is always safe. Streams to disk,
 * since a Pi can't hold a big PDF in memory.
 */
export async function appendUpload(userId: string, notebook: string, file: string, offset: number, body: ReadableStream<Uint8Array>) {
  if (!(await hasNotebook(userId, notebook))) throw new NotebookGone();
  const target = incomingFile(userId, notebook, file);
  await fs.mkdir(path.dirname(target), { recursive: true });
  if (offset === 0) await clearStaleUploads(path.dirname(target));
  const size = (await fs.stat(target).catch(() => null))?.size ?? 0;
  if (offset > size) throw new UploadRefused('That upload lost its place.');
  await assertRoom(path.dirname(target));
  if (offset < size) await fs.truncate(target, offset);

  let received = 0;
  const counted = async function* (source: AsyncIterable<Uint8Array>) {
    for await (const chunk of source) {
      received += chunk.length;
      if (offset + received > MAX_FILE_BYTES) throw new UploadRefused('That file is over the 1 GB limit.');
      yield chunk;
    }
  };
  await pipeline(Readable.fromWeb(body as Parameters<typeof Readable.fromWeb>[0]), counted, createWriteStream(target, { flags: 'a' }));
  return offset + received;
}

/** All the pieces are here: check it's something the notes keep, and put it in place. */
export async function finishUpload(userId: string, notebook: string, file: string) {
  const incoming = incomingFile(userId, notebook, file);
  const handle = await fs.open(incoming, 'r').catch(() => null);
  if (!handle) throw new UploadRefused('That upload isn’t here any more.');
  const head = new Uint8Array(4096);
  const { bytesRead } = await handle.read(head, 0, head.length, 0).finally(() => handle.close());
  if (!sniffFile(head.subarray(0, bytesRead))) {
    await fs.rm(incoming, { force: true });
    throw new UploadRefused('That doesn’t look like a PDF, picture or recording.');
  }
  await fs.rename(incoming, storedFile(userId, notebook, file));
}

export async function openStoredFile(userId: string, notebook: string, file: string) {
  const target = storedFile(userId, notebook, file);
  const stat = await fs.stat(target).catch(() => null);
  if (!stat) return null;
  return { size: stat.size, stream: () => Readable.toWeb(createReadStream(target)) as ReadableStream<Uint8Array> };
}
