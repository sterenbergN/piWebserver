// Chore data and every change to it. Like habits, the same reducer runs on the
// server (for a signed-in household, shared by everyone in it) and in the
// browser (signed out, saved on the device). Chores and the log of what was
// done are stored; XP, streaks and garden growth are worked out from them
// (see stats.ts).

import { addDays, daysBetween, isDateKey, type DateKey } from '../habits/dates';

export type RepeatUnit = 'day' | 'week' | 'month';
/** How often a chore comes back; null is a one-off (a vet visit, a repair). */
export type ChoreRepeat = { every: number; unit: RepeatUnit } | null;
/** Size of the job, which sets its XP. */
export type ChoreEffort = 1 | 2 | 3;

export type Chore = {
  id: string;
  name: string;
  emoji: string;
  /** Palette slot 1–8, shared with habits. */
  color: number;
  repeat: ChoreRepeat;
  /** When it's next due. Only a one-off can have none ("whenever"). */
  due: DateKey | null;
  /**
   * Repeating chores: true counts the next due date from the day it was done
   * (vacuum a week after the last time), false keeps a fixed calendar
   * (bins every Monday, however late they went out).
   */
  fromDone: boolean;
  effort: ChoreEffort;
  /** The household member it's for; null means anyone. */
  assignee: string | null;
  notes: string;
  createdOn: DateKey;
  /** A one-off that's been done (or a chore put away) leaves the list on this day. */
  archivedOn?: DateKey;
};

/** One time a chore was done (or skipped). `due` is what it was due before, so it can be undone. */
export type ChoreEntry = {
  id: string;
  choreId: string;
  date: DateKey;
  /** The member who did it; null on a device with no account. */
  by: string | null;
  due: DateKey | null;
  skipped?: true;
};

export type ChoresData = { version: 1; chores: Chore[]; log: ChoreEntry[] };

export type ChoreInput = Partial<Omit<Chore, 'createdOn' | 'archivedOn'>>;

export type ChoreAction =
  /** `newId` lets the browser name a new chore so later changes can refer to it before the server answers. */
  | { type: 'save'; chore: ChoreInput; newId?: string }
  | { type: 'done'; id: string; date: DateKey; by?: string | null; entryId?: string }
  /** Not this time: move the due date on without doing it (no XP). */
  | { type: 'skip'; id: string; date: DateKey; by?: string | null; entryId?: string }
  /** Take back a done or skip (the chore's latest one only). */
  | { type: 'undo'; entryId: string }
  | { type: 'archive'; id: string; archived: boolean }
  | { type: 'delete'; id: string }
  /** Bring chores kept on this device into the household; `by` is who did the device's ones. */
  | { type: 'import'; data: ChoresData; by?: string | null };

export const MAX_CHORES = 80;
export const MAX_LOG = 5000;
/** How far back a chore can be marked done. */
export const DONE_WINDOW_DAYS = 7;
const COLOR_SLOTS = 8;
const UNITS: RepeatUnit[] = ['day', 'week', 'month'];
const ID = /^[\w-]{1,40}$/;

/** A change that can't be applied, with a message fit to show the user. */
export class ChoreInputError extends Error {}

export function emptyChoresData(): ChoresData {
  return { version: 1, chores: [], log: [] };
}

export const isOpen = (chore: Chore) => !chore.archivedOn;

function clampInt(value: unknown, min: number, max: number, fallback: number) {
  const n = Math.round(Number(value));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
}

function text(value: unknown, max: number) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

/** A date key no more than ten years either side of today. */
function reasonableDate(value: unknown, today: DateKey): DateKey | null {
  return isDateKey(value) && Math.abs(daysBetween(today, value)) <= 3660 ? value : null;
}

/** `months` calendar months after `key`, held to the month's last day (Jan 31 → Feb 28). */
export function addMonths(key: DateKey, months: number): DateKey {
  const [y, m, d] = key.split('-').map(Number);
  const index = y * 12 + (m - 1) + months;
  const year = Math.floor(index / 12);
  const month = index - year * 12 + 1;
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(Math.min(d, last)).padStart(2, '0')}`;
}

/** One repeat after `key`. */
export function advance(key: DateKey, repeat: NonNullable<ChoreRepeat>, times = 1): DateKey {
  if (repeat.unit === 'month') return addMonths(key, repeat.every * times);
  return addDays(key, repeat.every * times * (repeat.unit === 'week' ? 7 : 1));
}

/** Rough length of a repeat in days, for "how overdue is this, really". */
export function repeatDays(repeat: ChoreRepeat) {
  if (!repeat) return 7;
  return repeat.every * (repeat.unit === 'month' ? 30 : repeat.unit === 'week' ? 7 : 1);
}

/** When a chore is next due once it's been done (or skipped) on `date`. */
export function nextDue(chore: Chore, date: DateKey): DateKey | null {
  if (!chore.repeat) return null;
  if (chore.fromDone || !chore.due) return advance(date, chore.repeat);
  // Fixed calendar: the first scheduled day after this one. Done early still moves it on once.
  // Counted from the original due date each time, so month ends don't drift (Jan 31 → Feb 28 → Mar 31).
  let times = 1;
  let due = advance(chore.due, chore.repeat);
  while (due <= date && times < 5000) due = advance(chore.due, chore.repeat, ++times);
  return due;
}

function normalizeRepeat(value: any): ChoreRepeat {
  if (!value || typeof value !== 'object') return null;
  const unit = UNITS.includes(value.unit) ? (value.unit as RepeatUnit) : 'week';
  return { every: clampInt(value.every, 1, unit === 'day' ? 365 : unit === 'week' ? 52 : 24, 1), unit };
}

/** A clean chore from user input, keeping `id` and the dates of an existing one. */
export function normalizeChore(input: ChoreInput, existing: Chore | undefined, id: string, today: DateKey, usedColors: number[] = []): Chore {
  const name = text(input.name, 60);
  if (!name) throw new ChoreInputError('Give the chore a name.');
  const repeat = normalizeRepeat(input.repeat);
  const freeColor = Array.from({ length: COLOR_SLOTS }, (_, i) => i + 1).find((c) => !usedColors.includes(c)) ?? 1;
  // A repeating chore always has a due date; with none given it's due today.
  const due = reasonableDate(input.due, today) ?? (repeat ? existing?.due ?? today : null);
  return {
    id,
    name,
    emoji: text(input.emoji, 8) || '🧹',
    color: clampInt(input.color, 1, COLOR_SLOTS, existing?.color ?? freeColor),
    repeat,
    due,
    fromDone: input.fromDone !== false,
    effort: clampInt(input.effort, 1, 3, 2) as ChoreEffort,
    assignee: typeof input.assignee === 'string' && ID.test(input.assignee) ? input.assignee : null,
    notes: text(input.notes, 300),
    createdOn: existing?.createdOn ?? today,
    ...(existing?.archivedOn ? { archivedOn: existing.archivedOn } : {}),
  };
}

/** Make loaded or imported data safe to use: drop anything malformed. */
export function normalizeChoresData(raw: unknown, today: DateKey): ChoresData {
  const data = emptyChoresData();
  const source = raw && typeof raw === 'object' ? (raw as any) : {};
  const seen = new Set<string>();
  for (const c of Array.isArray(source.chores) ? source.chores : []) {
    if (!c || typeof c.id !== 'string' || !ID.test(c.id) || seen.has(c.id)) continue;
    try {
      const chore = normalizeChore(c, undefined, c.id, today);
      if (isDateKey(c.createdOn) && c.createdOn <= today) chore.createdOn = c.createdOn;
      if (isDateKey(c.archivedOn)) chore.archivedOn = c.archivedOn;
      data.chores.push(chore);
      seen.add(c.id);
    } catch { /* skip a nameless chore */ }
    if (data.chores.length >= MAX_CHORES * 2) break;
  }
  const ids = new Set<string>();
  for (const e of Array.isArray(source.log) ? source.log : []) {
    if (!e || typeof e.id !== 'string' || !ID.test(e.id) || ids.has(e.id) || !seen.has(e.choreId) || !isDateKey(e.date) || e.date > addDays(today, 1)) continue;
    ids.add(e.id);
    data.log.push({
      id: e.id,
      choreId: e.choreId,
      date: e.date,
      by: typeof e.by === 'string' && ID.test(e.by) ? e.by : null,
      due: isDateKey(e.due) ? e.due : null,
      ...(e.skipped === true ? { skipped: true as const } : {}),
    });
  }
  data.log.sort((a, b) => a.date.localeCompare(b.date));
  if (data.log.length > MAX_LOG) data.log = data.log.slice(-MAX_LOG);
  return data;
}

/** The chore's most recent done/skip, which is the only one that can be undone. */
export function latestEntry(data: ChoresData, choreId: string): ChoreEntry | undefined {
  for (let i = data.log.length - 1; i >= 0; i--) if (data.log[i].choreId === choreId) return data.log[i];
  return undefined;
}

/**
 * Apply one change. Mutates and returns `data`; throws ChoreInputError for a
 * change that isn't allowed. `today` is the user's local day.
 */
export function applyChoreAction(data: ChoresData, action: ChoreAction, today: DateKey, newId: () => string): ChoresData {
  const find = (id: unknown) => data.chores.find((c) => c.id === id);
  const freshId = (suggested: unknown, taken: (id: string) => boolean) =>
    typeof suggested === 'string' && ID.test(suggested) && !taken(suggested) ? suggested : newId();

  switch (action?.type) {
    case 'save': {
      const existing = action.chore?.id ? find(action.chore.id) : undefined;
      if (action.chore?.id && !existing) throw new ChoreInputError('That chore no longer exists.');
      if (!existing && data.chores.filter(isOpen).length >= MAX_CHORES) {
        throw new ChoreInputError(`You can have up to ${MAX_CHORES} chores at once.`);
      }
      const usedColors = data.chores.filter(isOpen).map((c) => c.color);
      const id = existing?.id ?? freshId(action.newId, (x) => !!find(x));
      const chore = normalizeChore(action.chore || {}, existing, id, today, usedColors);
      if (existing) data.chores[data.chores.indexOf(existing)] = chore;
      else data.chores.push(chore);
      return data;
    }
    case 'done':
    case 'skip': {
      const chore = find(action.id);
      if (!chore) throw new ChoreInputError('That chore no longer exists.');
      if (!isOpen(chore)) throw new ChoreInputError('That one’s already done.');
      if (!isDateKey(action.date) || action.date > today || action.date < addDays(today, -DONE_WINDOW_DAYS)) {
        throw new ChoreInputError(`Pick a day in the last ${DONE_WINDOW_DAYS} days.`);
      }
      if (action.type === 'skip' && !chore.repeat) throw new ChoreInputError('A one-off can’t be skipped; change its date instead.');
      data.log.push({
        id: freshId(action.entryId, (x) => data.log.some((e) => e.id === x)),
        choreId: chore.id,
        date: action.date,
        by: typeof action.by === 'string' && ID.test(action.by) ? action.by : null,
        due: chore.due,
        ...(action.type === 'skip' ? { skipped: true as const } : {}),
      });
      data.log.sort((a, b) => a.date.localeCompare(b.date));
      if (data.log.length > MAX_LOG) data.log.splice(0, data.log.length - MAX_LOG);
      if (chore.repeat) chore.due = nextDue(chore, action.date);
      else chore.archivedOn = action.date;
      return data;
    }
    case 'undo': {
      const entry = data.log.find((e) => e.id === action.entryId);
      if (!entry) return data;
      const chore = find(entry.choreId);
      if (chore && latestEntry(data, chore.id) !== entry) throw new ChoreInputError('Only the latest time can be undone.');
      data.log.splice(data.log.indexOf(entry), 1);
      if (chore) {
        chore.due = entry.due;
        if (!chore.repeat) delete chore.archivedOn;
      }
      return data;
    }
    case 'archive': {
      const chore = find(action.id);
      if (!chore) throw new ChoreInputError('That chore no longer exists.');
      if (action.archived) chore.archivedOn = today;
      else {
        if (data.chores.filter(isOpen).length >= MAX_CHORES) throw new ChoreInputError(`You can have up to ${MAX_CHORES} chores at once.`);
        delete chore.archivedOn;
        if (chore.repeat && (!chore.due || chore.due < today)) chore.due = today;
      }
      return data;
    }
    case 'delete': {
      const chore = find(action.id);
      if (!chore) return data;
      data.chores.splice(data.chores.indexOf(chore), 1);
      data.log = data.log.filter((e) => e.choreId !== chore.id);
      return data;
    }
    case 'import': {
      const incoming = normalizeChoresData(action.data, today);
      for (const chore of incoming.chores) {
        if (isOpen(chore) && data.chores.filter(isOpen).length >= MAX_CHORES) break;
        // Never let an import overwrite a chore that's already here.
        const id = find(chore.id) ? newId() : chore.id;
        data.chores.push({ ...chore, id, assignee: null });
        for (const e of incoming.log) {
          if (e.choreId !== chore.id) continue;
          const entryId = data.log.some((x) => x.id === e.id) ? newId() : e.id;
          data.log.push({ ...e, id: entryId, choreId: id, by: e.by ?? (typeof action.by === 'string' && ID.test(action.by) ? action.by : null) });
        }
      }
      data.log.sort((a, b) => a.date.localeCompare(b.date));
      if (data.log.length > MAX_LOG) data.log.splice(0, data.log.length - MAX_LOG);
      return data;
    }
    default:
      throw new ChoreInputError('Unknown change.');
  }
}
