// The reader's data, shared by the server and the browser: what a book, a place in
// a book, a note and a pen stroke look like, and how two devices' copies merge.
//
// Every note and every pen stroke is its own item with its own id. Devices work
// offline and send what changed when they can, and the newest edit of an item wins,
// so writing on the phone and the iPad on the same flight loses nothing. A deleted
// item stays as a small tombstone, so the delete reaches the other devices too.

import { spoken, type AudioInfo } from './audio';

/** `audio`: a listening book (AAC in an .m4a from YouTube, or an uploaded audio file). */
export type BookFormat = 'epub' | 'pdf' | 'cbz' | 'txt' | 'md' | 'html' | 'audio';

export type BookMeta = {
  id: string;
  title: string;
  author: string;
  format: BookFormat;
  size: number;
  addedAt: string;
  hasCover: boolean;
  /** The folder it's in, if any. A book is in one place, like a book on a shelf. */
  folder?: string;
  /** The public Library entry it was copied from. The copy is independent from then on. */
  source?: string;
  /** An audio book's length and chapters (for `audio` books). */
  audio?: AudioInfo;
  /** Where an audio book came from (its YouTube video). */
  link?: string;
  /** The same book in another form (the EPUB and its audio book) shares this, and the shelf shows them as one. */
  work?: string;
  /**
   * Set only on a device, never stored: a book read straight from the public Library by
   * someone with no account. Its file comes from there, and nothing about it goes up.
   */
  publicUrl?: string;
  /** The series it's part of, by name, and its place in it (1, 2, 3…). */
  series?: string;
  seriesIndex?: number;
};

export type Folder = { id: string; name: string };

/**
 * A place in a book. `page` is what people see, and it's the same on every device.
 * For a PDF or comic it's the real page. Flowing text (EPUB and so on) re-pages with
 * the screen and the font, so its page numbers count characters from the start of the
 * book instead, and `s` + `o` (section, character offset) say exactly where. `col` is
 * set only when ink was drawn where there's no text to hold on to, like a full-page image.
 */
export type Anchor = { page: number; s?: number; o?: number; col?: number; chapter?: string };

export type InkTool = 'pen' | 'marker';
export const INK_COLORS = ['ink', 'red', 'blue', 'green', 'yellow', 'pink', 'mint'] as const;
export type InkColor = (typeof INK_COLORS)[number];

/**
 * One pen stroke. `pts` is x, y, pressure, repeated, and `width` is in the same unit.
 * That unit is the page's width on a PDF, and the font's size, measured from the word
 * under the stroke, in flowing text, so a mark follows its word when the text re-flows.
 */
export type Stroke = { tool: InkTool; color: InkColor; width: number; pts: number[] };

export type ReaderItem = {
  id: string;
  kind: 'note' | 'sketch' | 'ink';
  anchor: Anchor;
  createdAt: number;
  updatedAt: number;
  deleted?: boolean;
  /** Set by the server: the order changes reached it in. */
  seq?: number;
  /** A typed note. */
  text?: string;
  /** A handwritten note: strokes on a blank card, in card widths, `aspect` tall. Its `text` is what the server read in it. */
  strokes?: Stroke[];
  aspect?: number;
  /** A mark on the page. */
  stroke?: Stroke;
};

export type NotesFile = { seq: number; items: Record<string, ReaderItem> };
export const emptyNotes = (): NotesFile => ({ seq: 0, items: {} });

const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

export type Progress = {
  anchor: Anchor;
  pct: number;
  /** When this was last read. */
  at: number;
  /** Pages in the book, as this device counted them. */
  total?: number;
  startedAt?: number;
  finishedAt?: number;
  /** When it was taken off Continue reading. Reading it again (a later `at`) puts it back. */
  hiddenAt?: number;
};

export type ReadingState = 'new' | 'reading' | 'finished';

export function readingState(progress: Progress | undefined): ReadingState {
  if (!progress) return 'new';
  if (progress.finishedAt) return 'finished';
  return progress.startedAt || progress.pct > 0 ? 'reading' : 'new';
}

/** How far through a book you are, in words. An audio book's position is in seconds (its anchor's page). */
export function progressText(progress: Progress | undefined, format?: BookFormat) {
  const state = readingState(progress);
  if (state === 'new' || !progress) return format === 'audio' ? 'Not started listening' : 'Not started';
  if (state === 'finished') return `Finished ${new Date(progress.finishedAt!).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}`;
  const percent = Math.round(progress.pct * 100);
  if (format === 'audio') return progress.total ? `${percent}% · ${spoken(Math.max(0, progress.total - progress.anchor.page))} left` : `${percent}%`;
  if (!percent) return 'Just started';
  return progress.total ? `${percent}% · p. ${progress.anchor.page} of ${progress.total}` : `${percent}%`;
}

/** Whether a book you're partway through was taken off Continue reading, and not opened since. */
export const setAside = (progress: Progress | undefined) => !!progress?.hiddenAt && progress.hiddenAt >= progress.at;

/** The books you're partway through, latest first, without the ones taken off the list. */
export function booksInProgress<T extends { id: string }>(books: T[], progress: Record<string, Progress | undefined>) {
  return books
    .filter((book) => readingState(progress[book.id]) === 'reading' && !setAside(progress[book.id]))
    .sort((a, b) => (progress[b.id]?.at ?? 0) - (progress[a.id]?.at ?? 0));
}

/** Whether `a` is the later word on a book: read more recently, or the same reading taken off the list since. */
export function progressNewer(a: Progress, b: Progress | undefined) {
  if (!b || a.at > b.at) return true;
  return a.at === b.at && (a.hiddenAt ?? 0) > (b.hiddenAt ?? 0);
}

/** Take a book off Continue reading, keeping your place in it. */
export function withSetAside(previous: Progress, now: number): Progress {
  return { ...previous, hiddenAt: Math.max(now, previous.at) };
}

/** How near the end you have to have been already for reaching it to count as finishing, not a look ahead. */
const FINISHING_FROM = 0.7;

/** Where you are now, on top of what's known about this book. */
export function nextProgress(previous: Progress | undefined, place: { anchor: Anchor; pct: number; total: number; atEnd: boolean }, now: number): Progress {
  const reachedEnd = place.atEnd && place.total > 2 && (previous?.pct ?? 0) >= FINISHING_FROM;
  const finishedAt = previous?.finishedAt ?? (reachedEnd ? now : undefined);
  return {
    anchor: place.anchor, pct: place.pct, at: now, total: place.total,
    startedAt: previous?.startedAt ?? now,
    ...(finishedAt ? { finishedAt } : {}),
  };
}

/** Say by hand that a book is finished, or that it isn't. */
export function withFinished(previous: Progress | undefined, finished: boolean, now: number): Progress {
  const { finishedAt: _old, ...rest } = previous ?? { anchor: { page: 1 }, pct: 0, at: now } as Progress;
  return { ...rest, at: now, ...(finished ? { finishedAt: now } : {}) };
}

/** A reading position from a device, checked. */
export function cleanProgress(raw: { anchor?: unknown; pct?: unknown; at?: unknown; total?: unknown; startedAt?: unknown; finishedAt?: unknown; hiddenAt?: unknown }, now: number): Progress | null {
  const anchor = cleanAnchor(raw.anchor);
  if (!anchor || !finite(raw.pct) || !finite(raw.at)) return null;
  const when = (value: unknown) => (finite(value) && value > 0 ? Math.min(value, now) : undefined);
  const startedAt = when(raw.startedAt);
  const finishedAt = when(raw.finishedAt);
  const hiddenAt = when(raw.hiddenAt);
  return {
    anchor,
    pct: Math.max(0, Math.min(1, raw.pct)),
    at: Math.min(raw.at, now),
    ...(finite(raw.total) && raw.total > 0 ? { total: Math.floor(raw.total) } : {}),
    ...(startedAt ? { startedAt } : {}),
    ...(finishedAt ? { finishedAt } : {}),
    ...(hiddenAt ? { hiddenAt } : {}),
  };
}

export const MAX_FOLDERS = 200;
export const cleanFolderName = (value: unknown) => (typeof value === 'string' ? value.trim().replace(/\s+/g, ' ').slice(0, 80) : '');
export const cleanSeriesName = cleanFolderName;

// ── The shelf: one card for a book in two forms, and series in order ────────

/** A book as the shelf shows it: every form of it you have, the text before the audio. */
export type ShelfEntry<T> = { key: string; books: T[] };

type Shelved = Pick<BookMeta, 'id' | 'format' | 'work' | 'series' | 'seriesIndex' | 'title'>;

/** Books gathered into shelf entries, in the order their first form comes in. */
export function shelfEntries<T extends Shelved>(books: T[]): ShelfEntry<T>[] {
  const byKey = new Map<string, ShelfEntry<T>>();
  for (const book of books) {
    const key = book.work ? `work:${book.work}` : book.id;
    const held = byKey.get(key);
    if (held) held.books.push(book);
    else byKey.set(key, { key, books: [book] });
  }
  for (const entry of byKey.values()) {
    entry.books.sort((a, b) => Number(a.format === 'audio') - Number(b.format === 'audio'));
  }
  return [...byKey.values()];
}

/** The series an entry is in (any of its forms may carry it), and its place there. */
export function entrySeries<T extends Shelved>(entry: ShelfEntry<T>) {
  const book = entry.books.find((b) => b.series);
  return book?.series ? { name: book.series, index: book.seriesIndex ?? Number.MAX_SAFE_INTEGER } : null;
}

/** Entries in the order a series is read: by number, then by title for any without one. */
export function inSeriesOrder<T extends Shelved>(entries: ShelfEntry<T>[]) {
  return [...entries].sort((a, b) => (entrySeries(a)?.index ?? 0) - (entrySeries(b)?.index ?? 0) || a.books[0].title.localeCompare(b.books[0].title, undefined, { numeric: true }));
}

/** Every series on the shelf with how many books it has, by name. */
export function seriesOnShelf<T extends Shelved>(books: T[]) {
  const counts = new Map<string, number>();
  for (const entry of shelfEntries(books)) {
    const series = entrySeries(entry);
    if (series) counts.set(series.name, (counts.get(series.name) ?? 0) + 1);
  }
  return [...counts].map(([name, count]) => ({ name, count })).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
}

/** The public Library's address for a file, turned into just its file name, or null if it isn't one. */
export function publicLibraryFile(url: unknown) {
  if (typeof url !== 'string') return null;
  const match = /^\/api\/media\/uploads\/library\/([^/\\]+)$/.exec(url);
  if (!match || match[1] === '..' || match[1] === '.' || match[1] === 'library.json') return null;
  return match[1];
}

export const MAX_BOOK_BYTES = 1024 * 1024 * 1024;
/** Cloudflare turns away requests over 100 MB, so big books go up in pieces. */
export const UPLOAD_CHUNK_BYTES = 32 * 1024 * 1024;
export const MAX_NOTE_CHARS = 20_000;
const MAX_POINTS = 12_000;
const MAX_SKETCH_STROKES = 400;
export const MAX_CHANGES = 500;

export const isId = (value: unknown): value is string => typeof value === 'string' && /^[\w-]{1,64}$/.test(value);

const FORMAT_BY_EXTENSION: Record<string, BookFormat> = {
  epub: 'epub', pdf: 'pdf', cbz: 'cbz', txt: 'txt', text: 'txt', md: 'md', markdown: 'md', html: 'html', htm: 'html', xhtml: 'html',
  mp3: 'audio', m4a: 'audio', m4b: 'audio', ogg: 'audio', wav: 'audio', flac: 'audio', aac: 'audio',
};

export function formatFromName(name: string): BookFormat | null {
  return FORMAT_BY_EXTENSION[name.split('.').pop()?.toLowerCase() ?? ''] ?? null;
}

/** Whether the first bytes of a file are what its name says it is. */
export function matchesFormat(format: BookFormat, head: Uint8Array) {
  const text = String.fromCharCode(...head.subarray(0, 1024));
  if (format === 'pdf') return text.includes('%PDF-');
  if (format === 'epub' || format === 'cbz') return text.startsWith('PK');
  if (format === 'audio') {
    if (head.length < 3) return false;
    if (text.startsWith('ID3') || text.startsWith('OggS') || text.startsWith('fLaC') || text.startsWith('ADIF')) return true;
    if (head.length >= 8 && text.slice(4, 8) === 'ftyp') return true;
    if (head.length >= 12 && text.startsWith('RIFF') && text.slice(8, 12) === 'WAVE') return true;
    return head[0] === 0xff && (head[1] & 0xe0) === 0xe0;
  }
  return !head.includes(0);
}

/** A file name as a readable title: "the_long_way-home.epub" → "the long way home". */
export function titleFromName(name: string) {
  return name.replace(/\.[^.]+$/, '').replace(/[_]+/g, ' ').replace(/\s+/g, ' ').trim() || 'Untitled';
}

export const cleanTitle = (value: unknown, fallback: string) => (typeof value === 'string' && value.trim() ? value.trim().slice(0, 300) : fallback);

export function cleanAnchor(raw: unknown): Anchor | null {
  if (!raw || typeof raw !== 'object') return null;
  const a = raw as Record<string, unknown>;
  if (!finite(a.page) || a.page < 1 || a.page > 10_000_000) return null;
  const anchor: Anchor = { page: Math.floor(a.page) };
  if (finite(a.s) && a.s >= 0) anchor.s = Math.floor(a.s);
  if (finite(a.o) && a.o >= 0) anchor.o = Math.floor(a.o);
  if (finite(a.col) && a.col >= 0) anchor.col = Math.floor(a.col);
  if (typeof a.chapter === 'string' && a.chapter.trim()) anchor.chapter = a.chapter.trim().slice(0, 200);
  return anchor;
}

export function cleanStroke(raw: unknown): Stroke | null {
  if (!raw || typeof raw !== 'object') return null;
  const s = raw as Record<string, unknown>;
  if (s.tool !== 'pen' && s.tool !== 'marker') return null;
  if (!INK_COLORS.includes(s.color as InkColor)) return null;
  if (!finite(s.width) || s.width <= 0 || s.width > 100) return null;
  if (!Array.isArray(s.pts) || s.pts.length < 3 || s.pts.length % 3 !== 0 || s.pts.length > MAX_POINTS * 3 || !s.pts.every(finite)) return null;
  return { tool: s.tool, color: s.color as InkColor, width: s.width, pts: s.pts as number[] };
}

/** One item from a device, checked and trimmed to what's allowed, or null. */
export function cleanItem(raw: unknown, now: number): ReaderItem | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (!isId(r.id) || (r.kind !== 'note' && r.kind !== 'sketch' && r.kind !== 'ink')) return null;
  const anchor = cleanAnchor(r.anchor);
  if (!anchor || !finite(r.updatedAt) || !finite(r.createdAt)) return null;
  // A phone with its clock set wrong shouldn't win every argument for years.
  const base = { id: r.id, kind: r.kind as ReaderItem['kind'], anchor, createdAt: r.createdAt, updatedAt: Math.min(r.updatedAt, now) };
  if (r.deleted === true) return { ...base, deleted: true };
  if (r.kind === 'note') {
    if (typeof r.text !== 'string' || !r.text.trim()) return null;
    return { ...base, text: r.text.slice(0, MAX_NOTE_CHARS) };
  }
  if (r.kind === 'ink') {
    const stroke = cleanStroke(r.stroke);
    return stroke && { ...base, stroke };
  }
  if (!Array.isArray(r.strokes) || r.strokes.length > MAX_SKETCH_STROKES || !finite(r.aspect) || r.aspect <= 0 || r.aspect > 10) return null;
  const strokes = r.strokes.map(cleanStroke);
  if (strokes.includes(null)) return null;
  const text = typeof r.text === 'string' ? r.text.trim().slice(0, MAX_NOTE_CHARS) : '';
  return { ...base, strokes: strokes as Stroke[], aspect: r.aspect, ...(text ? { text } : {}) };
}

/** Bring a device's changes into the stored notes, newest edit of each item winning. */
export function mergeChanges(notes: NotesFile, changes: unknown[], now: number) {
  let changed = false;
  for (const raw of changes) {
    const item = cleanItem(raw, now);
    if (!item) continue;
    const held = notes.items[item.id];
    if (held && held.updatedAt >= item.updatedAt) continue;
    notes.seq += 1;
    notes.items[item.id] = { ...item, seq: notes.seq };
    changed = true;
  }
  return changed;
}

/** What a device that's seen everything up to `cursor` hasn't seen yet. */
export const itemsSince = (notes: NotesFile, cursor: number) => Object.values(notes.items).filter((item) => (item.seq ?? 0) > cursor);

/** Where an item sits in the book, for putting notes in reading order. */
export function compareAnchors(a: Anchor, b: Anchor) {
  return a.page - b.page || (a.s ?? 0) - (b.s ?? 0) || (a.o ?? 0) - (b.o ?? 0);
}

/** A book's typed and handwritten notes, in reading order, under the chapter they came from. */
export function notesByChapter(items: ReaderItem[]) {
  const notes = items.filter((i) => !i.deleted && (i.kind === 'note' || i.kind === 'sketch'));
  notes.sort((a, b) => compareAnchors(a.anchor, b.anchor) || a.createdAt - b.createdAt);
  const groups: { chapter: string; notes: ReaderItem[] }[] = [];
  for (const note of notes) {
    const chapter = note.anchor.chapter ?? '';
    const last = groups[groups.length - 1];
    if (last && last.chapter === chapter) last.notes.push(note);
    else groups.push({ chapter, notes: [note] });
  }
  return groups;
}

/** The pages with pen marks on them, in order. */
export function markedPages(items: ReaderItem[]) {
  const pages = new Map<number, Anchor>();
  for (const item of items) {
    if (item.kind === 'ink' && !item.deleted && !pages.has(item.anchor.page)) pages.set(item.anchor.page, item.anchor);
  }
  return [...pages.values()].sort(compareAnchors);
}

export const BOOKMARK_PREFIX = '🔖 Bookmark';

export function isBookmarkItem(item: Pick<ReaderItem, 'kind' | 'deleted' | 'text'>): boolean {
  if (item.deleted || item.kind !== 'note' || !item.text) return false;
  const trimmed = item.text.trim();
  return trimmed.startsWith(BOOKMARK_PREFIX) || /^Bookmark(?:\s*·|\b)/i.test(trimmed);
}

export function formatBookmarkText(anchor: Anchor): string {
  return anchor.chapter
    ? `${BOOKMARK_PREFIX} · p. ${anchor.page} · ${anchor.chapter}`
    : `${BOOKMARK_PREFIX} · p. ${anchor.page}`;
}

/** Seconds for an audio note/progress anchor (stored in `o` ms if set, else `page` seconds). */
export function audioTimeSeconds(anchor: Pick<Anchor, 'page' | 'o'>): number {
  return anchor.o !== undefined ? anchor.o / 1000 : anchor.page;
}

export type TextSnippetHit = { offset: number; before: string; match: string; after: string };

/** Find case-insensitive occurrences of `query` in `text` with surrounding snippet context. */
export function findTextSnippets(text: string, query: string, maxHits = 50): TextSnippetHit[] {
  const needle = query.trim().toLowerCase();
  if (!needle || !text || maxHits <= 0) return [];
  const lower = text.toLowerCase();
  const hits: TextSnippetHit[] = [];
  let pos = 0;
  while (hits.length < maxHits) {
    const idx = lower.indexOf(needle, pos);
    if (idx < 0) break;
    const end = idx + needle.length;
    const startCtx = Math.max(0, idx - 42);
    const endCtx = Math.min(text.length, end + 72);
    const before = `${startCtx > 0 ? '…' : ''}${text.slice(startCtx, idx).replace(/\s+/g, ' ')}`;
    const match = text.slice(idx, end).replace(/\s+/g, ' ');
    const after = `${text.slice(end, endCtx).replace(/\s+/g, ' ')}${endCtx < text.length ? '…' : ''}`;
    hits.push({ offset: idx, before, match, after });
    pos = end;
  }
  return hits;
}

/** One screen's worth of characters: how flowing books get page numbers every device agrees on. */
export const CHARS_PER_PAGE = 1500;

/** Page number of a character counted from the start of the book. */
export const flowPage = (charsBefore: number) => Math.floor(Math.max(0, charsBefore) / CHARS_PER_PAGE) + 1;

/**
 * Plain text as HTML sections small enough to lay out quickly. Long books as one
 * giant page make turning pages slow on a phone.
 */
export function splitParagraphs(paragraphs: string[], limit = 60_000) {
  const sections: string[][] = [[]];
  let size = 0;
  for (const paragraph of paragraphs) {
    if (size + paragraph.length > limit && size > 0) {
      sections.push([]);
      size = 0;
    }
    sections[sections.length - 1].push(paragraph);
    size += paragraph.length;
  }
  return sections;
}

export const escapeHtml = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** A plain text file as paragraphs of HTML. A blank line starts a new paragraph. */
export function textToParagraphs(text: string) {
  return text.replace(/\r\n?/g, '\n').split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean)
    .map((p) => `<p>${escapeHtml(p).replace(/\n/g, '<br>')}</p>`);
}

/** Roughly how many characters of reading are in a chapter's markup: the same answer on every device. */
export function markupLength(markup: string) {
  const body = markup.replace(/<head[\s>][\s\S]*?<\/head>/i, '').replace(/<(script|style)[\s>][\s\S]*?<\/\1>/gi, '');
  return Math.max(1, body.replace(/<[^>]*>/g, '').length);
}

/** Resolve a link inside a book's zip against the file it's written in. */
export function resolveZipPath(from: string, href: string) {
  const clean = decodeURIComponentSafe(href.split('#')[0].split('?')[0]);
  const parts = clean.startsWith('/') ? [] : from.split('/').slice(0, -1);
  for (const part of clean.split('/')) {
    if (part === '..') parts.pop();
    else if (part && part !== '.') parts.push(part);
  }
  return parts.join('/');
}

function decodeURIComponentSafe(value: string) {
  try { return decodeURIComponent(value); } catch { return value; }
}

/** Keep only the precision a stroke needs, since a long stroke is thousands of numbers. */
export function roundStroke(pts: number[]) {
  return pts.map((value, i) => (i % 3 === 2 ? Math.round(value * 100) / 100 : Math.round(value * 10000) / 10000));
}

/** The squared distance from a point to a line segment. */
function distanceToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number) {
  const dx = bx - ax;
  const dy = by - ay;
  const t = dx || dy ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy))) : 0;
  return (px - ax - t * dx) ** 2 + (py - ay - t * dy) ** 2;
}

/** Whether a point (in the stroke's own units) touches a stroke, for the eraser. */
export function strokeTouches(pts: number[], x: number, y: number, radius: number) {
  const limit = radius * radius;
  if (pts.length === 3) return distanceToSegment(x, y, pts[0], pts[1], pts[0], pts[1]) <= limit;
  for (let i = 3; i < pts.length; i += 3) {
    if (distanceToSegment(x, y, pts[i - 3], pts[i - 2], pts[i], pts[i + 1]) <= limit) return true;
  }
  return false;
}
