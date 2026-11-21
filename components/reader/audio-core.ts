'use client';

import type { AudioChapter } from '@/lib/reader/audio';
import { listenPlace, listenOrder } from '@/lib/reader/audio-player';
import type { BookMeta, Progress } from '@/lib/reader/items';
import { getCover, getFile, getProgress, listBooks, listFileIds, selectAccount } from './db';
import { applyShelf, fetchShelf, flushNow, ReaderSignedOut, saveProgressHere } from './sync';

// What the Reader's full audio player and the workout's mini player both need that isn't
// on screen: the speeds, where a book plays from, and saving where you are. One copy, so
// a position saved in either reaches the Reader, Skills and your other devices the same way.

export const SPEEDS = [0.75, 1, 1.25, 1.5, 1.75, 2];
export const SPEED_KEY = 'reader-audio-speed';
export const SAVE_EVERY_MS = 10_000;

export function readSpeed() {
  try { const v = Number(localStorage.getItem(SPEED_KEY)); return SPEEDS.includes(v) ? v : 1; } catch { return 1; }
}

export function writeSpeed(speed: number) {
  try { localStorage.setItem(SPEED_KEY, String(speed)); } catch { /* Just for now, then. */ }
}

/** Where a book not kept on this device streams from. */
export const streamUrl = (id: string) => `/api/reader/file?book=${encodeURIComponent(id)}`;

/** Save `t` seconds in as the place in the book (sent up soon, or at once with `now`). */
export async function saveListenPosition(book: string, t: number, total: number, chapters: AudioChapter[], now = false) {
  if (!total) return;
  await saveProgressHere(book, listenPlace(t, total, chapters)).catch(() => {});
  if (now) void flushNow().catch(() => {});
}

export type ListenShelf = { books: BookMeta[]; progress: Record<string, Progress | undefined>; /** Ids of the books whose sound is kept on this device. */ kept: string[]; signedOut: boolean };

async function readLocal(): Promise<Omit<ListenShelf, 'signedOut'>> {
  const books = (await listBooks()).filter((b) => b.format === 'audio');
  const progress: Record<string, Progress | undefined> = {};
  await Promise.all(books.map(async (b) => { progress[b.id] = await getProgress(b.id); }));
  const kept: string[] = await listFileIds().catch(() => []);
  return { books: listenOrder(books, progress), progress, kept };
}

/**
 * The account's audio books, from this device straight away, then brought up to date from the Pi
 * when there's a connection (the Reader may not have been opened lately). `signedOut` says the
 * server doesn't know this account, and nothing was kept here either.
 */
export async function loadListenShelf(userId: string, onUpdate: (shelf: ListenShelf) => void): Promise<void> {
  selectAccount(userId);
  const first = await readLocal();
  onUpdate({ ...first, signedOut: false });
  if (typeof navigator !== 'undefined' && !navigator.onLine) return;
  try {
    const shelf = await fetchShelf();
    selectAccount(shelf.userId);
    await applyShelf(shelf);
    onUpdate({ ...(await readLocal()), signedOut: false });
  } catch (e) {
    // 401: not signed in to the Reader. Anything else (no connection) leaves what's kept here.
    if (e instanceof ReaderSignedOut) onUpdate({ ...first, signedOut: first.books.length === 0 });
  }
}

/** What a book needs to start: its saved place, its cover and a copy kept on this device, if any. */
export async function readBookStart(book: BookMeta) {
  const [file, progress, cover] = await Promise.all([getFile(book.id), getProgress(book.id), book.hasCover ? getCover(book.id) : null]);
  return { file, progress, cover };
}
