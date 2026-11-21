import { addDays, isDateKey, type DateKey } from '@/lib/habits/dates';
import { cleanTalkExtras, isTalkMode, MAX_TOPIC, MAX_TRANSCRIPT, type TalkExtras, type TalkMode } from './talk';

// A private journal: one entry per calendar day, owned by a single account.
// Pure logic shared by the API route and the page; the route does the storage.

export const MAX_TEXT = 50_000;
export const MAX_TALKS = 20;
export const MAX_SUMMARY = 20_000;
/** Mood 1 (rough) … 5 (great), shown as these faces. */
export const MOODS = ['😞', '😕', '😐', '🙂', '😄'] as const;
export const MOOD_NAMES = ['Rough', 'Meh', 'Okay', 'Good', 'Great'] as const;
export type Mood = 1 | 2 | 3 | 4 | 5;

/**
 * A conversation talked through with an AI, kept with the day in its own space. The
 * extras (headline, tags, follow-ups…) come from JSON replies; older talks have none.
 */
export type JournalTalk = TalkExtras & {
  id: string;
  topic: string;
  transcript: string;
  createdAt: string;
  mode?: TalkMode;
  summary?: string;
};
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
    .filter((t) => t && typeof t.id === 'string' && (typeof t.transcript === 'string' || typeof t.summary === 'string'))
    .slice(0, MAX_TALKS)
    .map((t) => {
      const summary = typeof t.summary === 'string' ? t.summary.slice(0, MAX_SUMMARY) : '';
      return {
        id: t.id,
        topic: typeof t.topic === 'string' ? t.topic.slice(0, MAX_TOPIC) : '',
        transcript: typeof t.transcript === 'string' ? t.transcript.slice(0, MAX_TRANSCRIPT) : '',
        createdAt: typeof t.createdAt === 'string' ? t.createdAt : '',
        ...(isTalkMode(t.mode) ? { mode: t.mode } : {}),
        ...(summary ? { summary } : {}),
        ...cleanTalkExtras(t),
      };
    });
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

/** Words written, not counting Markdown's marks (list bullets, "#", ">", "1."). */
export function wordCount(text: string) {
  return text.split(/\s+/).filter((w) => w && !/^(?:[-*+#>_[\]]+|\d+[.)]|\[[xX]\])$/.test(w)).length;
}

/**
 * An entry's Markdown as plain text, for one-line previews: no "**", "#", "> " or list
 * bullets, and links as their words.
 */
export function markdownToPlain(md: string) {
  return md
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^[ \t]*(?:#{1,6}[ \t]+|>[ \t]?|[-*+][ \t]+(?:\[[ xX]\][ \t]+)?|\d+[.)][ \t]+)/gm, '')
    .replace(/(\*\*|__)(.+?)\1/g, '$2')
    .replace(/(^|[^\w*])[*_]([^*_\n]+)[*_](?=[^\w*]|$)/g, '$1$2')
    .replace(/~~(.+?)~~/g, '$1')
    .replace(/`([^`]+)`/g, '$1');
}

function defaultPreview(entry: JournalEntry): string {
  if (entry.text.trim()) return entry.text;
  const first = entry.talks?.[0];
  if (!first) return '';
  const summaryPlain = first.summary ? markdownToPlain(first.summary) : '';
  return [first.topic, summaryPlain].filter(Boolean).join(' — ');
}

export function summarize(date: DateKey, entry: JournalEntry, preview = defaultPreview(entry)): JournalSummary {
  return {
    date,
    ...(entry.mood ? { mood: entry.mood } : {}),
    words: wordCount(entry.text),
    ...(entry.talks?.length ? { talks: entry.talks.length } : {}),
    preview: markdownToPlain(preview).replace(/\s+/g, ' ').trim().slice(0, 160),
    updatedAt: entry.updatedAt,
  };
}

/** Every entry, newest first. */
export function listEntries(data: JournalData): JournalSummary[] {
  return Object.keys(data.entries).sort().reverse().map((d) => summarize(d, data.entries[d]));
}

/** Entries containing every word of the query (in the entry body or kept talks), with the preview starting near the first match. */
export function searchEntries(data: JournalData, query: string): JournalSummary[] {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return listEntries(data);
  return listEntries(data).flatMap((s) => {
    const entry = data.entries[s.date];
    const talkTexts = (entry.talks ?? []).flatMap((t) => [
      t.topic, t.headline, t.summary, t.quote, ...(t.tags ?? []), ...(t.people ?? []), ...(t.followUps ?? []).map((f) => f.text), ...(t.questions ?? []), t.transcript,
    ]).filter((v): v is string => Boolean(v));
    const haystack = [entry.text, ...talkTexts].filter(Boolean).join('\n');
    const lower = haystack.toLowerCase();
    if (!terms.every((t) => lower.includes(t))) return [];
    const textLower = entry.text.toLowerCase();
    const atText = textLower.indexOf(terms[0]);
    const source = atText >= 0 ? entry.text : talkTexts.join('\n');
    const sourceLower = atText >= 0 ? textLower : source.toLowerCase();
    const at = atText >= 0 ? atText : sourceLower.indexOf(terms[0]);
    const start = at > 40 ? sourceLower.lastIndexOf(' ', at - 30) + 1 : 0;
    return [summarize(s.date, entry, `${start > 0 ? '…' : ''}${source.slice(start)}`)];
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

/** Keep a talked-through session with the day, starting the day's entry if there isn't one yet. */
export function addTalk(
  data: JournalData,
  date: unknown,
  topic: unknown,
  transcript: unknown,
  today: DateKey,
  now: string,
  id: string,
  opts?: { mode?: TalkMode; summary?: string; extras?: unknown },
): JournalTalk {
  if (!isDateKey(date)) throw new JournalInputError('Invalid date');
  if (date > today) throw new JournalInputError('That day hasn’t happened yet');
  const rawTranscript = transcript === undefined || transcript === null ? '' : transcript;
  if (typeof rawTranscript !== 'string') throw new JournalInputError('Invalid conversation');
  if (rawTranscript.length > MAX_TRANSCRIPT) throw new JournalInputError('That conversation is too long to keep');

  if (opts?.mode !== undefined && opts.mode !== null && !isTalkMode(opts.mode)) {
    throw new JournalInputError('Invalid talk mode');
  }
  if (opts?.summary !== undefined && opts.summary !== null && typeof opts.summary !== 'string') {
    throw new JournalInputError('Invalid summary');
  }
  const rawSummary = typeof opts?.summary === 'string' ? opts.summary : '';
  if (rawSummary.length > MAX_SUMMARY) {
    throw new JournalInputError(`Summaries are limited to ${MAX_SUMMARY.toLocaleString()} characters`);
  }

  const cleanTranscript = rawTranscript.trim();
  const cleanSummary = rawSummary.trim();
  if (!cleanTranscript && !cleanSummary) throw new JournalInputError('Missing conversation');

  const entry = data.entries[date] ?? { text: '', createdAt: now, updatedAt: now };
  const talks = entry.talks ?? [];
  if (talks.length >= MAX_TALKS) throw new JournalInputError(`A day keeps up to ${MAX_TALKS} conversations`);

  const talk: JournalTalk = {
    id,
    topic: typeof topic === 'string' ? topic.trim().slice(0, MAX_TOPIC) : '',
    transcript: cleanTranscript,
    createdAt: now,
    ...(isTalkMode(opts?.mode) ? { mode: opts.mode } : {}),
    ...(cleanSummary ? { summary: cleanSummary } : {}),
    ...cleanTalkExtras(opts?.extras),
  };
  data.entries[date] = { ...entry, talks: [...talks, talk], updatedAt: now };
  return talk;
}

/** Update a kept talk session's topic, summary or mode, or tick one of its follow-ups (by its place in the list). */
export function updateTalk(
  data: JournalData,
  date: unknown,
  talkId: unknown,
  patch: { topic?: unknown; summary?: unknown; mode?: unknown; followUp?: unknown; done?: unknown },
  now: string,
): JournalTalk {
  if (!isDateKey(date)) throw new JournalInputError('Invalid date');
  if (typeof talkId !== 'string' || !talkId) throw new JournalInputError('Conversation not found');
  const entry = data.entries[date];
  const talks = entry?.talks;
  const idx = talks?.findIndex((t) => t.id === talkId) ?? -1;
  if (!entry || !talks || idx < 0) throw new JournalInputError('That conversation isn’t there any more');

  const current = talks[idx];
  let nextTopic = current.topic;
  if (patch.topic !== undefined) {
    if (patch.topic === null) nextTopic = '';
    else if (typeof patch.topic === 'string') nextTopic = patch.topic.trim().slice(0, MAX_TOPIC);
    else throw new JournalInputError('Invalid topic');
  }

  let nextSummary = current.summary;
  if (patch.summary !== undefined) {
    if (patch.summary === null) {
      nextSummary = undefined;
    } else if (typeof patch.summary === 'string') {
      if (patch.summary.length > MAX_SUMMARY) {
        throw new JournalInputError(`Summaries are limited to ${MAX_SUMMARY.toLocaleString()} characters`);
      }
      const trimmed = patch.summary.trim();
      nextSummary = trimmed || undefined;
    } else {
      throw new JournalInputError('Invalid summary');
    }
  }
  if (!nextSummary && !current.transcript.trim()) {
    throw new JournalInputError('Missing summary or conversation');
  }

  let nextMode = current.mode;
  if (patch.mode !== undefined) {
    if (patch.mode === null || patch.mode === '') nextMode = undefined;
    else if (isTalkMode(patch.mode)) nextMode = patch.mode;
    else throw new JournalInputError('Invalid talk mode');
  }

  let followUps = current.followUps;
  if (patch.followUp !== undefined) {
    const at = patch.followUp;
    if (typeof at !== 'number' || !Number.isInteger(at) || !followUps?.[at]) throw new JournalInputError('That follow-up isn’t there any more');
    if (typeof patch.done !== 'boolean') throw new JournalInputError('Invalid follow-up');
    const done = patch.done;
    followUps = followUps.map((f, i) => (i !== at ? f : done ? { ...f, done: true } : { text: f.text, ...(f.when ? { when: f.when } : {}) }));
  }

  const { id, transcript, createdAt, mode: _mode, summary: _summary, topic: _topic, ...extras } = current;
  const updated: JournalTalk = {
    id,
    topic: nextTopic,
    transcript,
    createdAt,
    ...(nextMode ? { mode: nextMode } : {}),
    ...(nextSummary ? { summary: nextSummary } : {}),
    ...extras,
    ...(followUps ? { followUps } : {}),
  };
  const nextTalks = talks.map((t, i) => (i === idx ? updated : t));
  data.entries[date] = { ...entry, talks: nextTalks, updatedAt: now };
  return updated;
}

/** A follow-up not done yet, with the talk and day it came from. */
export type OpenFollowUp = { date: DateKey; talkId: string; index: number; text: string; when?: string; topic: string };

/** Follow-ups not yet done from the talks of the last `days` days (today included), newest day first. */
export function openFollowUps(data: JournalData, today: DateKey, days = 14): OpenFollowUp[] {
  const from = addDays(today, -(days - 1));
  return Object.keys(data.entries)
    .filter((d) => d >= from && d <= today)
    .sort()
    .reverse()
    .flatMap((date) => (data.entries[date].talks ?? []).flatMap((t) => (t.followUps ?? []).flatMap((f, index) => (
      f.done ? [] : [{ date, talkId: t.id, index, text: f.text, ...(f.when ? { when: f.when } : {}), topic: t.topic }]
    ))));
}

/** "Still thinking about" questions from the talks of the last `days` days, newest first, without repeats. */
export function recentQuestions(data: JournalData, today: DateKey, days = 14, max = 10): string[] {
  const from = addDays(today, -(days - 1));
  const seen = new Set<string>();
  return Object.keys(data.entries)
    .filter((d) => d >= from && d <= today)
    .sort()
    .reverse()
    .flatMap((date) => [...(data.entries[date].talks ?? [])].reverse().flatMap((t) => t.questions ?? []))
    .filter((q) => !seen.has(q.toLowerCase()) && !!seen.add(q.toLowerCase()))
    .slice(0, max);
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

// Things to think about on paper (ideas, opinions, decisions, what you learned),
// in the same spirit as talking it through: curious, not a counselling session.
const PROMPTS = [
  'What did you learn today, and how sure are you it’s true?',
  'What’s something you’ve changed your mind about?',
  'Pick something you believe. What’s the best argument against it?',
  'What problem are you chewing on, and what haven’t you tried yet?',
  'What decision is coming up, and what would make it easy?',
  'What did you make, fix or figure out today?',
  'What surprised you today?',
  'What’s an idea worth trying this week?',
  'What’s a question you’d like answered?',
  'What did you read or hear lately that stuck with you?',
  'What’s an opinion you hold that most people around you don’t?',
  'What happened today that’s worth remembering?',
];

/** A writing prompt for the empty page, the same all day. */
export function promptFor(date: DateKey) {
  const n = [...date].reduce((sum, c) => sum * 31 + c.charCodeAt(0), 7);
  return PROMPTS[Math.abs(n) % PROMPTS.length];
}
