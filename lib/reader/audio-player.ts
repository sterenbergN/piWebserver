// The small decisions behind listening to an audio book in two places (the Reader's
// full player and the workout's mini player): which book to offer first, where to start,
// and the place that gets saved. Pure, so both use the same answers; tested in
// audio-player.test.ts.

import { chapterAt, type AudioChapter } from './audio';
import type { Anchor, BookMeta, Progress } from './items';

/** The book last played in the workout tracker, per device: {u: account, b: book}. */
export const LISTEN_LAST_KEY = 'workout:audioBook';

/** This close to the end counts as finished. */
export const END_SECONDS = 30;

/**
 * The audio books to offer, the one you were last listening to first. Books you've started come
 * before ones you haven't, and finished ones go last. They're what you'd pick between sets,
 * and nobody wants the book they just finished at the top.
 */
export function listenOrder<T extends Pick<BookMeta, 'id' | 'format' | 'addedAt'>>(books: T[], progress: Record<string, Progress | undefined>): T[] {
  const group = (book: T) => {
    const p = progress[book.id];
    if (p?.finishedAt) return 2;
    return p && (p.startedAt || p.pct > 0) ? 0 : 1;
  };
  const added = (book: T) => Date.parse(book.addedAt) || 0;
  return books
    .filter((book) => book.format === 'audio')
    .sort((a, b) => group(a) - group(b)
      || (group(a) === 1 ? added(b) - added(a) : (progress[b.id]?.at ?? 0) - (progress[a.id]?.at ?? 0))
      || a.id.localeCompare(b.id));
}

/** The second to start from: the saved one, or the top again if it's finished or right at the end. */
export function resumeSeconds(progress: Progress | undefined, total: number, startAt?: number) {
  const saved = startAt ?? progress?.anchor.page ?? 0;
  return progress?.finishedAt || (total && saved > total - END_SECONDS) ? 0 : saved;
}

/** What to save for being `t` seconds into a book `total` seconds long. */
export function listenPlace(t: number, total: number, chapters: AudioChapter[]): { anchor: Anchor; pct: number; total: number; atEnd: boolean } {
  const at = chapterAt(chapters, t);
  return {
    anchor: { page: Math.max(1, Math.floor(t)), ...(at >= 0 ? { chapter: chapters[at].title } : {}) },
    pct: Math.min(1, t / total), total: Math.ceil(total), atEnd: total - t <= END_SECONDS,
  };
}

/** What the mini player calls what's playing: the chapter, else the book. */
export function nowPlayingLabel(chapters: AudioChapter[], t: number, title: string) {
  const at = chapterAt(chapters, t);
  return at >= 0 ? chapters[at].title : title;
}

/** How far through, 0 to 1, for a progress line. */
export const fractionDone = (t: number, total: number) => (total > 0 ? Math.max(0, Math.min(1, t / total)) : 0);
