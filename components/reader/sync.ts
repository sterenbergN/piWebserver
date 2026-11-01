'use client';

import { MAX_CHANGES, UPLOAD_CHUNK_BYTES, type BookMeta, type Progress, type ReaderItem } from '@/lib/reader/items';
import {
  dirtyProgress, forgetBook, getCover, getItems, getKv, getProgress, listBooks, putBooks, putCover, putFile, putItems, putKv, putProgress, type StoredItem,
} from './db';

// Keeping this device and the server in step. Everything is saved here first and sent
// when there's a connection, so a dead zone never loses a note. Nothing here throws for
// being offline: it tries again on the next change, or when the connection comes back.

export const USER_KEY = 'reader-user';

export class ReaderSignedOut extends Error {}

export type Shelf = { userId: string; books: BookMeta[]; seqs: Record<string, number>; progress: Record<string, Progress> };

async function readJson<T>(res: Response): Promise<T> {
  if (res.status === 401) throw new ReaderSignedOut();
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.success) throw new Error(body.message || 'Something went wrong. Try again.');
  return body as T;
}

const LOOKS_OFFLINE = 8000;

/** The account's shelf from the server. Gives up quickly: a dead connection shouldn't hold up a book. */
export async function fetchShelf() {
  const giveUp = new AbortController();
  const timer = setTimeout(() => giveUp.abort(), LOOKS_OFFLINE);
  try {
    return await readJson<Shelf>(await fetch('/api/reader', { cache: 'no-store', signal: giveUp.signal }));
  } finally {
    clearTimeout(timer);
  }
}

const postAction = async (payload: Record<string, unknown>) => readJson<Record<string, unknown>>(await fetch('/api/reader', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(payload),
}));

/** Bring this device's copy of the shelf in line with the server's. */
export async function applyShelf(shelf: Shelf) {
  const known = new Set(shelf.books.map((b) => b.id));
  for (const book of await listBooks()) {
    if (!known.has(book.id)) await forgetBook(book.id);
  }
  await putBooks(shelf.books);
  for (const book of shelf.books) {
    const remote = shelf.progress[book.id];
    const local = await getProgress(book.id);
    if (remote && remote.at > (local?.at ?? 0)) await putProgress(book.id, remote);
    if (book.hasCover && !(await getCover(book.id))) {
      const res = await fetch(`/api/reader/file?book=${encodeURIComponent(book.id)}&cover=1`).catch(() => null);
      if (res?.ok) await putCover(book.id, await res.blob());
    }
  }
}

let flushingProgress = false;
export async function flushProgress() {
  if (flushingProgress) return;
  flushingProgress = true;
  try {
    const dirty = await dirtyProgress();
    if (!dirty.length) return;
    await postAction({ action: 'progress', entries: dirty.slice(0, 500).map(({ book, progress }) => ({ book, anchor: progress.anchor, pct: progress.pct, at: progress.at })) });
    for (const { book, progress } of dirty.slice(0, 500)) {
      const current = await getProgress(book);
      if (current && current.at === progress.at) await putProgress(book, { ...current, dirty: false });
    }
  } catch { /* Offline: it stays marked and goes next time. */ } finally {
    flushingProgress = false;
  }
}

export async function saveProgressHere(book: string, progress: Progress) {
  await putProgress(book, { ...progress, dirty: true });
  scheduleFlush();
}

const running = new Map<string, Promise<boolean>>();

/** Send this book's changes and take in the other devices'. True if anything new arrived. */
export function syncBook(book: string): Promise<boolean> {
  const held = running.get(book);
  if (held) return held;
  const run = syncBookNow(book).finally(() => running.delete(book));
  running.set(book, run);
  return run;
}

async function syncBookNow(book: string) {
  let gotNews = false;
  for (let round = 0; round < 40; round++) {
    const local = await getItems(book);
    const changes = local.filter((item) => item.dirty).slice(0, MAX_CHANGES);
    const cursor = (await getKv<number>(`cursor:${book}`)) ?? 0;
    const res = await fetch('/api/reader/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ book, cursor, changes: changes.map(({ book: _book, dirty: _dirty, ...item }) => item) }),
    });
    const body = await readJson<{ cursor: number; items: ReaderItem[] }>(res);

    // Look again: a note may have been edited while that request was out.
    const latest = new Map((await getItems(book)).map((item) => [item.id, item]));
    const save = new Map<string, StoredItem>();
    for (const incoming of body.items) {
      const mine = latest.get(incoming.id);
      if (mine && mine.updatedAt > incoming.updatedAt) continue;
      if (!mine || mine.updatedAt < incoming.updatedAt) gotNews = true;
      save.set(incoming.id, { ...incoming, book, dirty: false });
    }
    // Anything sent and not changed since is done, whether or not the server's copy won.
    for (const item of changes) {
      const mine = latest.get(item.id);
      if (mine && mine.updatedAt === item.updatedAt && !save.has(item.id)) save.set(item.id, { ...mine, dirty: false });
    }
    await putItems([...save.values()]);
    await putKv(`cursor:${book}`, body.cursor);
    if (changes.length < MAX_CHANGES) break;
  }
  return gotNews;
}

let flushTimer: ReturnType<typeof setTimeout> | null = null;
const dirtyBooks = new Set<string>();

export function noteBookChanged(book: string) {
  dirtyBooks.add(book);
  scheduleFlush();
}

function scheduleFlush() {
  if (flushTimer) clearTimeout(flushTimer);
  flushTimer = setTimeout(() => { void flushNow(); }, 2500);
}

export async function flushNow() {
  if (flushTimer) clearTimeout(flushTimer);
  flushTimer = null;
  await flushProgress();
  for (const book of [...dirtyBooks]) {
    try {
      await syncBook(book);
      dirtyBooks.delete(book);
    } catch { /* Offline or signed out: still dirty, tried again later. */ }
  }
}

/** Everything that was changed offline, in any book, on any earlier day. */
export async function flushEverything(books: BookMeta[]) {
  for (const book of books) {
    if ((await getItems(book.id)).some((item) => item.dirty)) dirtyBooks.add(book.id);
  }
  await flushNow();
}

/** Fetch the notes of books changed on other devices, so they're here for the next flight. */
export async function pullChangedNotes(shelf: Shelf) {
  for (const book of shelf.books) {
    const cursor = (await getKv<number>(`cursor:${book.id}`)) ?? 0;
    if ((shelf.seqs[book.id] ?? 0) > cursor) await syncBook(book.id).catch(() => false);
  }
}

/** Keep a book on this device. Reports progress as a fraction of the file. */
export async function downloadBook(book: BookMeta, onProgress?: (fraction: number) => void) {
  const res = await fetch(`/api/reader/file?book=${encodeURIComponent(book.id)}`);
  if (res.status === 401) throw new ReaderSignedOut();
  if (!res.ok || !res.body) throw new Error('That book wouldn’t download.');
  const reader = res.body.getReader();
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value as Uint8Array<ArrayBuffer>);
    received += value.length;
    onProgress?.(Math.min(1, received / Math.max(1, book.size)));
  }
  const blob = new Blob(chunks);
  await putFile(book.id, blob);
  return blob;
}

const newUploadId = () => Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => b.toString(16).padStart(2, '0')).join('');

/** Send a file up in pieces, each one retried if the connection blips. */
export async function uploadBook(file: File, details: { title: string; author: string; cover: string | null }, onProgress: (fraction: number) => void) {
  const upload = newUploadId();
  let offset = 0;
  do {
    const piece = file.slice(offset, offset + UPLOAD_CHUNK_BYTES);
    let received = -1;
    for (let attempt = 0; received < 0; attempt++) {
      try {
        const res = await fetch(`/api/reader/upload?upload=${upload}&offset=${offset}`, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: piece });
        received = (await readJson<{ received: number }>(res)).received;
      } catch (error) {
        if (error instanceof ReaderSignedOut || attempt >= 2 || (error instanceof Error && error.name !== 'TypeError')) throw error;
        await new Promise((resolve) => setTimeout(resolve, 1500 * (attempt + 1)));
      }
    }
    offset = received;
    onProgress(file.size ? offset / file.size : 1);
  } while (offset < file.size);

  const body = await readJson<{ book: BookMeta }>(await fetch(`/api/reader/upload?upload=${upload}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fileName: file.name, ...details }),
  }));
  await putBooks([body.book]);
  await putFile(body.book.id, file.slice(0, file.size, file.type));
  if (details.cover) await putCover(body.book.id, await (await fetch(details.cover)).blob());
  return body.book;
}

export async function renameBookEverywhere(book: BookMeta, title: string, author: string) {
  const updated = await postAction({ action: 'rename', book: book.id, title, author });
  await putBooks([updated.book as BookMeta]);
}

export async function deleteBookEverywhere(id: string) {
  await postAction({ action: 'delete', book: id });
  await forgetBook(id);
}
