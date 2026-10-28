import { addDays, isDateKey, type DateKey } from '@/lib/habits/dates';

// A private journal: one entry per calendar day, owned by a single account.
// Pure logic shared by the API route and the page; the route does the storage.

export const MAX_TEXT = 50_000;
/** Mood 1 (rough) … 5 (great), shown as these faces. */
export const MOODS = ['😞', '😕', '😐', '🙂', '😄'] as const;
export type Mood = 1 | 2 | 3 | 4 | 5;

export type JournalEntry = { text: string; mood?: Mood; createdAt: string; updatedAt: string };
export type JournalData = { entries: Record<DateKey, JournalEntry> };
/** What the entry list shows, without sending every entry's full text. */
export type JournalSummary = { date: DateKey; mood?: Mood; words: number; preview: string; updatedAt: string };

export class JournalInputError extends Error {}

export const emptyJournal = (): JournalData => ({ entries: {} });

const isMood = (value: unknown): value is Mood => typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 5;

export function normalizeJournal(raw: unknown): JournalData {
  const data = emptyJournal();
  const entries = (raw as JournalData | null)?.entries;
  if (!entries || typeof entries !== 'object') return data;
  for (const [date, e] of Object.entries(entries)) {
    if (!isDateKey(date) || !e || typeof e.text !== 'string') continue;
    data.entries[date] = {
      text: e.text.slice(0, MAX_TEXT),
      ...(isMood(e.mood) ? { mood: e.mood } : {}),
      createdAt: typeof e.createdAt === 'string' ? e.createdAt : '',
      updatedAt: typeof e.updatedAt === 'string' ? e.updatedAt : '',
    };
  }
  return data;
}

export function wordCount(text: string) {
  return text.trim() ? text.trim().split(/\s+/).length : 0;
}

export function summarize(date: DateKey, entry: JournalEntry, preview = entry.text): JournalSummary {
  return {
    date,
    ...(entry.mood ? { mood: entry.mood } : {}),
    words: wordCount(entry.text),
    preview: preview.replace(/\s+/g, ' ').trim().slice(0, 160),
    updatedAt: entry.updatedAt,
  };
}

/** Every entry, newest first. */
export function listEntries(data: JournalData): JournalSummary[] {
  return Object.keys(data.entries).sort().reverse().map((d) => summarize(d, data.entries[d]));
}

/** Entries containing every word of the query, with the preview starting near the first match. */
export function searchEntries(data: JournalData, query: string): JournalSummary[] {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return listEntries(data);
  return listEntries(data).flatMap((s) => {
    const text = data.entries[s.date].text;
    const lower = text.toLowerCase();
    if (!terms.every((t) => lower.includes(t))) return [];
    const at = lower.indexOf(terms[0]);
    const start = at > 40 ? lower.lastIndexOf(' ', at - 30) + 1 : 0;
    return [summarize(s.date, data.entries[s.date], `${start > 0 ? '…' : ''}${text.slice(start)}`)];
  });
}

/**
 * Write (or clear) the entry for a day. A day with no text and no mood is
 * removed. Days after `today` are refused: a journal is about what happened.
 */
export function saveEntry(data: JournalData, date: unknown, text: unknown, mood: unknown, today: DateKey, now: string): JournalEntry | null {
  if (!isDateKey(date)) throw new JournalInputError('Invalid date');
  if (date > today) throw new JournalInputError('That day hasn’t happened yet');
  if (typeof text !== 'string') throw new JournalInputError('Missing text');
  if (text.length > MAX_TEXT) throw new JournalInputError(`Entries are limited to ${MAX_TEXT.toLocaleString()} characters`);
  if (mood !== undefined && mood !== null && !isMood(mood)) throw new JournalInputError('Invalid mood');

  if (!text.trim() && !mood) {
    delete data.entries[date];
    return null;
  }
  const entry: JournalEntry = { text, ...(mood ? { mood } : {}), createdAt: data.entries[date]?.createdAt || now, updatedAt: now };
  data.entries[date] = entry;
  return entry;
}

/** Days in a row with an entry, ending today (or yesterday, if today isn't written yet). */
export function writingStreak(dates: Iterable<DateKey>, today: DateKey) {
  const written = new Set(dates);
  let day = written.has(today) ? today : addDays(today, -1);
  let streak = 0;
  while (written.has(day)) {
    streak++;
    day = addDays(day, -1);
  }
  return streak;
}

const PROMPTS = [
  'What’s on your mind?',
  'What went well today?',
  'What’s one thing you’d do differently?',
  'What are you looking forward to?',
  'What took most of your energy today?',
  'What did you learn today?',
  'Who made today better?',
  'What’s been bothering you lately?',
  'What would make tomorrow good?',
  'What are you grateful for right now?',
];

/** A writing prompt for the empty page, the same all day. */
export function promptFor(date: DateKey) {
  const n = [...date].reduce((sum, c) => sum * 31 + c.charCodeAt(0), 7);
  return PROMPTS[Math.abs(n) % PROMPTS.length];
}
