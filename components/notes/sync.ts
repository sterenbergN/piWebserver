'use client';

import { MAX_CHANGES, UPLOAD_CHUNK_BYTES, type BookRecord, type InkText, type LibraryRecord, type PageElement } from '@/lib/notes/items';
import {
  clearDirtyPage, cursorKey, deleteKv, inkTextKey, forgetNotebook, getElements, getFile, getKv, kvKeys, listBook, listDirtyPages, listLibrary, neededKey, putBook, putElements, putFile, putKv, putLibrary, uploadKey,
  type StoredBook, type StoredElement, type StoredLibrary,
} from './db';

// Keeping this device and the server in step. Everything is saved here first and sent when
// there's a connection, so a dead zone never loses a page. Nothing here throws for being
// offline: it tries again on the next change, or when the connection comes back. It works
// down the levels (library, notebook, page), and only goes into a notebook or page that has
// something to send or that the level above says has moved on, so with nothing new it's one
// small request however many notebooks there are.

export const USER_KEY = 'notes-user';

export class NotesSignedOut extends Error {}
class NotebookIsGone extends Error {}

export type SyncState = 'idle' | 'syncing' | 'offline' | 'signed-out';

const stateListeners = new Set<(state: SyncState) => void>();
/** What arrived from other devices, so an open notebook can show it. */
const newsListeners = new Set<(news: { library: boolean; notebook?: string; pages?: string[] }) => void>();
let state: SyncState = 'idle';

function setState(next: SyncState) {
  if (state === next) return;
  state = next;
  for (const listener of stateListeners) listener(next);
}

export function watchSync(listener: (state: SyncState) => void) {
  stateListeners.add(listener);
  listener(state);
  return () => { stateListeners.delete(listener); };
}

export function watchNews(listener: (news: { library: boolean; notebook?: string; pages?: string[] }) => void) {
  newsListeners.add(listener);
  return () => { newsListeners.delete(listener); };
}

const tell = (news: { library: boolean; notebook?: string; pages?: string[] }) => { for (const listener of newsListeners) listener(news); };

async function readJson<T>(res: Response): Promise<T> {
  if (res.status === 401) throw new NotesSignedOut();
  if (res.status === 410) throw new NotebookIsGone();
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.success) throw new Error(body.message || 'Something went wrong. Try again.');
  return body as T;
}

const LOOKS_OFFLINE = 8000;

const post = async <T>(payload: Record<string, unknown>) => readJson<T>(await fetch('/api/notes/sync', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(payload),
}));

/** Who's signed in, asked for nothing else. Gives up quickly: a dead connection shouldn't hold up your notes. */
export async function fetchAccount() {
  const giveUp = new AbortController();
  const timer = setTimeout(() => giveUp.abort(), LOOKS_OFFLINE);
  try {
    return await readJson<{ userId: string }>(await fetch('/api/notes/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ level: 'library', cursor: Number.MAX_SAFE_INTEGER, changes: [] }),
      signal: giveUp.signal,
    }));
  } finally {
    clearTimeout(timer);
  }
}

type Stamped = { id: string; updatedAt: number; dirty?: boolean };

/**
 * One level's round trip, repeated while there's more to send. Returns what was new. A change
 * made while a request was out is looked at again afterwards, so it isn't marked as sent.
 */
async function syncLevel<S extends Stamped, R extends { id: string; updatedAt: number }, Extra>(options: {
  load: () => Promise<S[]>;
  save: (records: S[]) => Promise<unknown>;
  strip: (record: S) => unknown;
  adopt: (incoming: R, mine?: S) => S;
  send: (cursor: number, changes: unknown[]) => Promise<{ cursor: number; items: R[] } & Extra>;
  cursorName: string;
}) {
  const news: R[] = [];
  let last: ({ cursor: number; items: R[] } & Extra) | null = null;
  for (let round = 0; round < 200; round++) {
    const changes = (await options.load()).filter((record) => record.dirty).slice(0, MAX_CHANGES);
    const cursor = (await getKv<number>(options.cursorName)) ?? 0;
    const body = await options.send(cursor, changes.map(options.strip));
    last = body;

    const latest = new Map((await options.load()).map((record) => [record.id, record]));
    const save = new Map<string, S>();
    for (const incoming of body.items) {
      const mine = latest.get(incoming.id);
      if (mine && mine.updatedAt > incoming.updatedAt) continue;
      if (!mine || mine.updatedAt < incoming.updatedAt) news.push(incoming);
      save.set(incoming.id, options.adopt(incoming, mine));
    }
    // Anything sent and not changed since is done, whether or not the server's copy won.
    for (const change of changes) {
      const mine = latest.get(change.id);
      if (mine && mine.updatedAt === change.updatedAt && !save.has(change.id)) save.set(change.id, { ...mine, dirty: false });
    }
    if (save.size) await options.save([...save.values()]);
    await putKv(options.cursorName, body.cursor);
    if (changes.length < MAX_CHANGES) break;
  }
  return { news, last: last! };
}

const fileIn = (record: { kind: string; file?: string; pdf?: { file: string } }) => record.pdf?.file ?? record.file;

async function syncLibraryLevel() {
  return syncLevel<StoredLibrary, LibraryRecord, { revs: Record<string, number> }>({
    load: listLibrary,
    save: putLibrary,
    strip: ({ dirty: _dirty, seq: _seq, ...record }) => record,
    adopt: (incoming) => ({ ...incoming, dirty: false }),
    send: (cursor, changes) => post({ level: 'library', cursor, changes }),
    cursorName: 'cursor:library',
  });
}

async function syncBookLevel(notebook: string) {
  const out = await syncLevel<StoredBook, BookRecord, { pageSeqs: Record<string, number>; textSeq?: number }>({
    load: () => listBook(notebook),
    save: putBook,
    strip: ({ dirty: _dirty, notebook: _notebook, seq: _seq, ...record }) => record,
    adopt: (incoming) => ({ ...incoming, notebook, dirty: false }),
    send: (cursor, changes) => post({ level: 'book', notebook, cursor, changes }),
    cursorName: cursorKey(notebook, ''),
  });
  for (const record of out.news) {
    const file = fileIn(record as { kind: string; file?: string; pdf?: { file: string } });
    if (file && !record.deleted && !(await getFile(notebook, file))) await putKv(neededKey(notebook, file), true);
  }
  return out;
}

async function syncPageLevel(notebook: string, page: string) {
  const out = await syncLevel<StoredElement, PageElement, object>({
    load: () => getElements(page),
    save: putElements,
    strip: ({ dirty: _dirty, notebook: _notebook, page: _page, seq: _seq, ...element }) => element,
    adopt: (incoming) => ({ ...incoming, notebook, page, dirty: false }),
    send: (cursor, changes) => post({ level: 'page', notebook, page, cursor, changes }),
    cursorName: cursorKey(notebook, page),
  });
  for (const element of out.news) {
    if (element.kind === 'image' && !element.deleted && !(await getFile(notebook, element.file))) await putKv(neededKey(notebook, element.file), true);
  }
  // Nothing was marked dirty while that ran: this page is level with the server.
  if (!(await getElements(page)).some((element) => element.dirty)) await clearDirtyPage(page);
  return out.news.length > 0;
}

/** What the server has read in the handwriting since last time, kept here so search works offline. */
async function syncInkText(notebook: string) {
  const name = cursorKey(notebook, '#text');
  const cursor = (await getKv<number>(name)) ?? 0;
  const body = await post<{ cursor: number; items: InkText[] }>({ level: 'text', notebook, cursor, changes: [] });
  for (const record of body.items) await putKv(inkTextKey(notebook, record.page), record);
  await putKv(name, body.cursor);
  return body.items.length > 0;
}

async function syncNotebook(notebook: string, alsoPages: string[]) {
  const book = await syncBookLevel(notebook);
  if ((book.last.textSeq ?? 0) > ((await getKv<number>(cursorKey(notebook, '#text'))) ?? 0)) await syncInkText(notebook);
  const changed: string[] = [];
  const pages = new Set(alsoPages);
  for (const [page, seq] of Object.entries(book.last.pageSeqs)) {
    if (seq > ((await getKv<number>(cursorKey(notebook, page))) ?? 0)) pages.add(page);
  }
  for (const page of pages) {
    if (await syncPageLevel(notebook, page)) changed.push(page);
  }
  if (changed.length || book.news.length) tell({ library: false, notebook, pages: changed });
}

const newId = () => Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => b.toString(16).padStart(2, '0')).join('');
export { newId as newFileId };

/** Send a file up in pieces, each one retried if the connection blips. */
async function uploadFile(notebook: string, file: string) {
  const blob = await getFile(notebook, file);
  if (!blob) return;
  const address = `/api/notes/file?notebook=${encodeURIComponent(notebook)}&file=${encodeURIComponent(file)}`;
  let offset = 0;
  do {
    const piece = blob.slice(offset, offset + UPLOAD_CHUNK_BYTES);
    const res = await fetch(`${address}&offset=${offset}`, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: piece });
    offset = (await readJson<{ received: number }>(res)).received;
  } while (offset < blob.size);
  await readJson(await fetch(`${address}&done=1`, { method: 'POST' }));
}

async function moveFiles() {
  for (const key of await kvKeys('upload:')) {
    const [, notebook, file] = key.split(':');
    try {
      await uploadFile(notebook, file);
      await deleteKv(key);
    } catch (error) {
      if (error instanceof NotebookIsGone) await deleteKv(key);
      else throw error;
    }
  }
  for (const key of await kvKeys('needed:')) {
    const [, notebook, file] = key.split(':');
    const blob = await fetchFile(notebook, file);
    if (blob) {
      await deleteKv(key);
      tell({ library: false, notebook, pages: [] });
    }
  }
}

/** A file from the server, kept here for next time. Nothing if the device that has it hasn't sent it yet. */
export async function fetchFile(notebook: string, file: string) {
  const res = await fetch(`/api/notes/file?notebook=${encodeURIComponent(notebook)}&file=${encodeURIComponent(file)}`);
  if (res.status === 401) throw new NotesSignedOut();
  if (!res.ok) return null;
  const blob = await res.blob();
  await putFile(notebook, file, blob);
  return blob;
}

/** A new file made on this device: kept here now, and sent up when it can be. */
export async function keepNewFile(notebook: string, file: string, blob: Blob) {
  await putFile(notebook, file, blob);
  await putKv(uploadKey(notebook, file), true);
  scheduleSync();
}

async function syncOnce() {
  const library = await syncLibraryLevel();
  for (const record of library.news) {
    if (record.kind === 'notebook' && record.deleted) await forgetNotebook(record.id);
  }
  if (library.news.length) tell({ library: true });

  const dirtyPages = await listDirtyPages();
  const notebooks = (await listLibrary()).filter((record) => record.kind === 'notebook' && !record.deleted);
  for (const { id } of notebooks) {
    const rev = library.last.revs[id] ?? 0;
    const seen = (await getKv<number>(`rev:${id}:`)) ?? -1;
    const dirtyBook = (await listBook(id)).some((record) => record.dirty);
    const pages = dirtyPages.filter((entry) => entry.notebook === id).map((entry) => entry.page);
    if (rev === seen && !dirtyBook && !pages.length) continue;
    try {
      await syncNotebook(id, pages);
      // Taken before this round, so a change from elsewhere during it still counts as news next time.
      if (!pages.length && !dirtyBook) await putKv(`rev:${id}:`, rev);
    } catch (error) {
      if (!(error instanceof NotebookIsGone)) throw error;
    }
  }
  await moveFiles();
}

let running: Promise<void> | null = null;
let runAgain = false;

/** Bring everything level. Only one at a time; asking during one runs another straight after it. */
export function syncNow(): Promise<void> {
  if (running) {
    runAgain = true;
    return running;
  }
  running = (async () => {
    do {
      runAgain = false;
      setState('syncing');
      try {
        await syncOnce();
        setState('idle');
      } catch (error) {
        setState(error instanceof NotesSignedOut ? 'signed-out' : 'offline');
        break;
      }
    } while (runAgain);
  })().finally(() => { running = null; });
  return running;
}

let timer: ReturnType<typeof setTimeout> | null = null;

export function scheduleSync(delay = 2500) {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => { timer = null; void syncNow(); }, delay);
}

export function cancelScheduledSync() {
  if (timer) clearTimeout(timer);
  timer = null;
}
