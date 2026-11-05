import { addDays, isDateKey, type DateKey } from '@/lib/habits/dates';
import { MAX_TOPIC, MAX_TRANSCRIPT } from './talk';

// A private journal: one entry per calendar day, owned by a single account.
// Pure logic shared by the API route and the page; the route does the storage.

export const MAX_TEXT = 50_000;
export const MAX_TALKS = 20;
/** Mood 1 (rough) … 5 (great), shown as these faces. */
export const MOODS = ['😞', '😕', '😐', '🙂', '😄'] as const;
export type Mood = 1 | 2 | 3 | 4 | 5;

/** A conversation talked through with an AI, kept with the day its summary went into. */
export type JournalTalk = { id: string; topic: string; transcript: string; createdAt: string };
export type JournalEntry = { text: string; mood?: Mood; talks?: JournalTalk[]; createdAt: string; updatedAt: string };
export type JournalData = { entries: Record<DateKey, JournalEntry> };
/** What the entry list shows, without sending every entry's full text. */
export type JournalSummary = { date: DateKey; mood?: Mood; words: number; talks?: number; preview: string; updatedAt: string };

export class JournalInputError extends Error {}

export const emptyJournal = (): JournalData => ({ entries: {} });

const isMood = (value: unknown): value is Mood => typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 5;

function normalizeTalks(raw: unknown): JournalTalk[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((t) => t && typeof t.id === 'string' && typeof t.transcript === 'string')
    .slice(0, MAX_TALKS)
    .map((t) => ({ id: t.id, topic: typeof t.topic === 'string' ? t.topic.slice(0, MAX_TOPIC) : '', transcript: t.transcript.slice(0, MAX_TRANSCRIPT), createdAt: typeof t.createdAt === 'string' ? t.createdAt : '' }));
}

export function normalizeJournal(raw: unknown): JournalData {
  const data = emptyJournal();
  const entries = (raw as JournalData | null)?.entries;
  if (!entries || typeof entries !== 'object') return data;
  for (const [date, e] of Object.entries(entries)) {
    if (!isDateKey(date) || !e || typeof e.text !== 'string') continue;
    const talks = normalizeTalks(e.talks);
    data.entries[date] = {
      text: e.text.slice(0, MAX_TEXT),
      ...(isMood(e.mood) ? { mood: e.mood } : {}),
      ...(talks.length ? { talks } : {}),
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
    ...(entry.talks?.length ? { talks: entry.talks.length } : {}),
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
 * Write (or clear) the entry for a day. A day with no text, no mood and no kept
 * conversations is removed. Days after `today` are refused: a journal is about what happened.
 */
export function saveEntry(data: JournalData, date: unknown, text: unknown, mood: unknown, today: DateKey, now: string): JournalEntry | null {
  if (!isDateKey(date)) throw new JournalInputError('Invalid date');
  if (date > today) throw new JournalInputError('That day hasn’t happened yet');
  if (typeof text !== 'string') throw new JournalInputError('Missing text');
  if (text.length > MAX_TEXT) throw new JournalInputError(`Entries are limited to ${MAX_TEXT.toLocaleString()} characters`);
  if (mood !== undefined && mood !== null && !isMood(mood)) throw new JournalInputError('Invalid mood');

  const talks = data.entries[date]?.talks;
  if (!text.trim() && !mood && !talks?.length) {
    delete data.entries[date];
    return null;
  }
  const entry: JournalEntry = { text, ...(mood ? { mood } : {}), ...(talks?.length ? { talks } : {}), createdAt: data.entries[date]?.createdAt || now, updatedAt: now };
  data.entries[date] = entry;
  return entry;
}

/** Keep a conversation with the day, starting the day's entry if there isn't one yet. */
export function addTalk(data: JournalData, date: unknown, topic: unknown, transcript: unknown, today: DateKey, now: string, id: string): JournalTalk {
  if (!isDateKey(date)) throw new JournalInputError('Invalid date');
  if (date > today) throw new JournalInputError('That day hasn’t happened yet');
  if (typeof transcript !== 'string' || !transcript.trim()) throw new JournalInputError('Missing conversation');
  if (transcript.length > MAX_TRANSCRIPT) throw new JournalInputError('That conversation is too long to keep');
  const entry = data.entries[date] ?? { text: '', createdAt: now, updatedAt: now };
  const talks = entry.talks ?? [];
  if (talks.length >= MAX_TALKS) throw new JournalInputError(`A day keeps up to ${MAX_TALKS} conversations`);
  const talk: JournalTalk = { id, topic: typeof topic === 'string' ? topic.trim().slice(0, MAX_TOPIC) : '', transcript: transcript.trim(), createdAt: now };
  data.entries[date] = { ...entry, talks: [...talks, talk], updatedAt: now };
  return talk;
}

/** Let go of one kept conversation. The day goes too if nothing else is left in it. */
export function removeTalk(data: JournalData, date: DateKey, id: string): boolean {
  const entry = data.entries[date];
  if (!entry?.talks?.some((t) => t.id === id)) return false;
  const talks = entry.talks.filter((t) => t.id !== id);
  if (!entry.text.trim() && !entry.mood && !talks.length) delete data.entries[date];
  else if (talks.length) entry.talks = talks;
  else delete entry.talks;
  return true;
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
