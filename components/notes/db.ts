'use client';

import type { BookRecord, LibraryRecord, PageElement, PageRecord, RecordingRecord } from '@/lib/notes/items';

// What's kept on this device: everything. Notes are for writing with no connection, so the
// server is the copy that travels and this is the one you work on. Each account gets its own
// database, so someone else signing in on this device never sees yours.

export type StoredLibrary = LibraryRecord & { dirty?: boolean };
export type StoredBook = BookRecord & { notebook: string; dirty?: boolean };
export type StoredElement = PageElement & { notebook: string; page: string; dirty?: boolean };

type StoreName = 'library' | 'book' | 'elements' | 'dirty' | 'files' | 'thumbs' | 'kv';

let opened: { user: string; db: Promise<IDBDatabase> } | null = null;

function openDb(user: string) {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(`notes-${user}`, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      db.createObjectStore('library', { keyPath: 'id' });
      db.createObjectStore('book', { keyPath: 'id' }).createIndex('notebook', 'notebook');
      const elements = db.createObjectStore('elements', { keyPath: 'id' });
      elements.createIndex('page', 'page');
      elements.createIndex('notebook', 'notebook');
      // Finding the text in a notebook shouldn't mean reading all of its ink.
      elements.createIndex('notebookKind', ['notebook', 'kind']);
      // Which pages have changes waiting to go up, so finding them doesn't mean reading every stroke.
      db.createObjectStore('dirty', { keyPath: 'page' });
      db.createObjectStore('files');
      db.createObjectStore('thumbs');
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

const prefix = (text: string) => IDBKeyRange.bound(text, `${text}￿`);

export const listLibrary = () => run<StoredLibrary[]>('library', 'readonly', (s) => s.getAll());
export const getLibraryRecord = (id: string) => run<StoredLibrary | undefined>('library', 'readonly', (s) => s.get(id));
export const putLibrary = (records: StoredLibrary[]) => run('library', 'readwrite', (s) => { for (const record of records) s.put(record); });

export const listBook = (notebook: string) => run<StoredBook[]>('book', 'readonly', (s) => s.index('notebook').getAll(notebook));
export const putBook = (records: StoredBook[]) => run('book', 'readwrite', (s) => { for (const record of records) s.put(record); });

export const getElements = (page: string) => run<StoredElement[]>('elements', 'readonly', (s) => s.index('page').getAll(page));
export const getNotebookElements = (notebook: string) => run<StoredElement[]>('elements', 'readonly', (s) => s.index('notebook').getAll(notebook));
export const getNotebookMarks = (notebook: string) => run<StoredElement[]>('elements', 'readonly', (s) => s.index('notebookKind').getAll([notebook, 'mark']));
export const getNotebookText = (notebook: string) => run<StoredElement[]>('elements', 'readonly', (s) => s.index('notebookKind').getAll([notebook, 'text']));

/** Keep elements, and if any are waiting to go up, say so in the same breath. */
export async function putElements(elements: StoredElement[]) {
  const db = await database();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction(['elements', 'dirty'], 'readwrite');
    const store = tx.objectStore('elements');
    const dirty = tx.objectStore('dirty');
    for (const element of elements) {
      store.put(element);
      if (element.dirty) dirty.put({ page: element.page, notebook: element.notebook });
    }
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export const listDirtyPages = () => run<{ page: string; notebook: string }[]>('dirty', 'readonly', (s) => s.getAll());
export const clearDirtyPage = (page: string) => run('dirty', 'readwrite', (s) => { s.delete(page); });

/**
 * Keep a file. A Blob is best, since it's read from disk a piece at a time, but Safari
 * refuses them in private windows, so there it goes in as plain bytes.
 */
export async function putFile(notebook: string, file: string, blob: Blob) {
  const key = `${notebook}:${file}`;
  try {
    await run('files', 'readwrite', (s) => { s.put(blob, key); });
  } catch {
    const bytes = await blob.arrayBuffer();
    await run('files', 'readwrite', (s) => { s.put(bytes, key); });
  }
}

/** A kept file, or nothing if it isn't here or its stored copy has gone bad. */
export async function getFile(notebook: string, file: string) {
  const held = await run<Blob | ArrayBuffer | undefined>('files', 'readonly', (s) => s.get(`${notebook}:${file}`));
  if (!held) return null;
  const blob = held instanceof ArrayBuffer ? new Blob([held]) : held;
  try {
    await blob.slice(0, 4).arrayBuffer();
    return blob;
  } catch {
    return null;
  }
}

export async function getThumb(notebook: string) {
  const held = await run<{ bytes: ArrayBuffer; type: string; stamp: number } | undefined>('thumbs', 'readonly', (s) => s.get(notebook));
  return held ? { blob: new Blob([held.bytes], { type: held.type }), stamp: held.stamp } : undefined;
}

/** As plain bytes: Safari refuses Blobs in private windows, and a little picture costs nothing either way. */
export async function putThumb(notebook: string, blob: Blob, stamp: number) {
  const bytes = await blob.arrayBuffer();
  await run('thumbs', 'readwrite', (s) => { s.put({ bytes, type: blob.type, stamp }, notebook); });
}

export const getKv = <T>(key: string) => run<T | undefined>('kv', 'readonly', (s) => s.get(key));
export const putKv = (key: string, value: unknown) => run('kv', 'readwrite', (s) => { s.put(value, key); });
export const deleteKv = (key: string) => run('kv', 'readwrite', (s) => { s.delete(key); });
export const kvValues = <T>(start: string) => run<T[]>('kv', 'readonly', (s) => s.getAll(prefix(start)));
export const kvKeys = async (start: string) => (await run<IDBValidKey[]>('kv', 'readonly', (s) => s.getAllKeys(prefix(start)))) as string[];

// Keys in kv, with the notebook's id right after the first colon, so they can all go with it.
export const cursorKey = (notebook: string, page: string) => `cursor:${notebook}:${page}`;
export const uploadKey = (notebook: string, file: string) => `upload:${notebook}:${file}`;
export const neededKey = (notebook: string, file: string) => `needed:${notebook}:${file}`;
export const pdfTextKey = (notebook: string, file: string) => `pdftext:${notebook}:${file}`;
export const placeKey = (notebook: string) => `place:${notebook}:`;
export const recordingKey = (notebook: string, id: string) => `recording:${notebook}:${id}`;
/** What the server read in a page's handwriting. */
export const inkTextKey = (notebook: string, page: string) => `inktext:${notebook}:${page}`;

const KV_KINDS = ['cursor', 'upload', 'needed', 'pdftext', 'place', 'recording', 'rev', 'inktext'];

/** Everything about one notebook on this device, except its tombstone, which still has to reach the others. */
export async function forgetNotebook(notebook: string) {
  const db = await database();
  const dirtyPages = (await listDirtyPages()).filter((entry) => entry.notebook === notebook);
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(['book', 'elements', 'dirty', 'files', 'thumbs', 'kv'], 'readwrite');
    tx.objectStore('thumbs').delete(notebook);
    tx.objectStore('files').delete(prefix(`${notebook}:`));
    for (const kind of KV_KINDS) tx.objectStore('kv').delete(prefix(`${kind}:${notebook}:`));
    for (const { page } of dirtyPages) tx.objectStore('dirty').delete(page);
    for (const name of ['book', 'elements'] as const) {
      const cursorRequest = tx.objectStore(name).index('notebook').openKeyCursor(notebook);
      cursorRequest.onsuccess = () => {
        const cursor = cursorRequest.result;
        if (!cursor) return;
        tx.objectStore(name).delete(cursor.primaryKey);
        cursor.continue();
      };
    }
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export const livePages = (records: StoredBook[]) => records.filter((record): record is PageRecord & StoredBook => record.kind === 'page' && !record.deleted).sort((a, b) => a.order - b.order);
export const liveRecordings = (records: StoredBook[]) => records.filter((record): record is RecordingRecord & StoredBook => record.kind === 'recording' && !record.deleted).sort((a, b) => a.startedAt - b.startedAt);
