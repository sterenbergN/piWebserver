'use client';

import type { BookMeta, Folder, Progress, ReaderItem } from '@/lib/reader/items';

// What's kept on this device, for reading with no connection: the shelf, the books you
// chose to keep, reading positions, and your notes and pen marks. Each account gets its
// own database, so someone else signing in on this device never sees yours.

export type StoredItem = ReaderItem & { book: string; dirty?: boolean };
export type StoredProgress = Progress & { dirty?: boolean };

type StoreName = 'books' | 'files' | 'covers' | 'items' | 'kv';

let opened: { user: string; db: Promise<IDBDatabase> } | null = null;

function openDb(user: string) {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(`reader-${user}`, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      db.createObjectStore('books', { keyPath: 'id' });
      db.createObjectStore('files');
      db.createObjectStore('covers');
      const items = db.createObjectStore('items', { keyPath: 'id' });
      items.createIndex('book', 'book');
      db.createObjectStore('kv');
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export function selectAccount(user: string) {
  if (opened?.user !== user) opened = { user, db: openDb(user) };
}

function database() {
  if (!opened) throw new Error('No account yet');
  return opened.db;
}

async function run<T>(store: StoreName, mode: IDBTransactionMode, work: (s: IDBObjectStore) => IDBRequest<T> | void): Promise<T> {
  const db = await database();
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction(store, mode);
    const request = work(tx.objectStore(store));
    tx.oncomplete = () => resolve(request ? request.result : (undefined as T));
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export const listBooks = () => run<BookMeta[]>('books', 'readonly', (s) => s.getAll());
export const putBooks = (books: BookMeta[]) => run('books', 'readwrite', (s) => { for (const book of books) s.put(book); });
export const deleteBookMeta = (id: string) => run('books', 'readwrite', (s) => { s.delete(id); });

/**
 * Keep a file. A Blob is best, since it's read from disk a piece at a time, but Safari
 * refuses them in private windows, so there it goes in as plain bytes.
 */
async function putBytes(store: 'files' | 'covers', id: string, blob: Blob) {
  try {
    await run(store, 'readwrite', (s) => { s.put(blob, id); });
  } catch {
    const bytes = await blob.arrayBuffer();
    await run(store, 'readwrite', (s) => { s.put(bytes, id); });
  }
}

async function getBytes(store: 'files' | 'covers', id: string) {
  const held = await run<Blob | ArrayBuffer | undefined>(store, 'readonly', (s) => s.get(id));
  if (!held) return null;
  return held instanceof ArrayBuffer ? new Blob([held]) : held;
}

export const getCover = (id: string) => getBytes('covers', id);
export const putCover = (id: string, blob: Blob) => putBytes('covers', id, blob);

export const putFile = (id: string, blob: Blob) => putBytes('files', id, blob);
export const deleteFile = (id: string) => run('files', 'readwrite', (s) => { s.delete(id); });
export const listFileIds = async () => (await run<IDBValidKey[]>('files', 'readonly', (s) => s.getAllKeys())) as string[];

/** A kept book, or nothing if it isn't here or its stored copy has gone bad. */
export async function getFile(id: string) {
  const blob = await getBytes('files', id);
  if (!blob) return null;
  try {
    await blob.slice(0, 4).arrayBuffer();
    return blob;
  } catch {
    return null;
  }
}

export const getKv = <T>(key: string) => run<T | undefined>('kv', 'readonly', (s) => s.get(key));
export const putKv = (key: string, value: unknown) => run('kv', 'readwrite', (s) => { s.put(value, key); });
export const deleteKv = (key: string) => run('kv', 'readwrite', (s) => { s.delete(key); });

export const getFolders = async () => (await getKv<Folder[]>('folders')) ?? [];
export const putFolders = (folders: Folder[]) => putKv('folders', folders);

export const getProgress = (book: string) => getKv<StoredProgress>(`progress:${book}`);
export const putProgress = (book: string, progress: StoredProgress) => putKv(`progress:${book}`, progress);

export const getItems = (book: string) => run<StoredItem[]>('items', 'readonly', (s) => s.index('book').getAll(book));
export const putItems = (items: StoredItem[]) => run('items', 'readwrite', (s) => { for (const item of items) s.put(item); });
export const deleteItems = (ids: string[]) => run('items', 'readwrite', (s) => { for (const id of ids) s.delete(id); });

/** All the progress waiting to go up. */
export async function dirtyProgress() {
  const db = await database();
  return new Promise<{ book: string; progress: StoredProgress }[]>((resolve, reject) => {
    const out: { book: string; progress: StoredProgress }[] = [];
    const tx = db.transaction('kv', 'readonly');
    const request = tx.objectStore('kv').openCursor(IDBKeyRange.bound('progress:', 'progress:￿'));
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) return;
      const progress = cursor.value as StoredProgress;
      if (progress.dirty) out.push({ book: String(cursor.key).slice('progress:'.length), progress });
      cursor.continue();
    };
    tx.oncomplete = () => resolve(out);
    tx.onerror = () => reject(tx.error);
  });
}

/** Everything about one book on this device. */
export async function forgetBook(id: string) {
  const items = await getItems(id);
  await Promise.all([
    deleteItems(items.map((item) => item.id)),
    deleteFile(id),
    deleteBookMeta(id),
    run('covers', 'readwrite', (s) => { s.delete(id); }),
    deleteKv(`progress:${id}`),
    deleteKv(`cursor:${id}`),
  ]);
}
