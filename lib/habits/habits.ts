// Habit data and every change to it. The same reducer runs on the server (for
// signed-in users) and in the browser (signed out, saved on the device), so
// both behave identically. Only habits and the day log are stored; streaks,
// freezes, XP and garden growth are all worked out from them (see stats.ts).

import { addDays, isDateKey, type DateKey } from './dates';

export type HabitKind = 'check' | 'count' | 'duration' | 'avoid';
export type HabitSchedule =
  | { type: 'daily' }
  | { type: 'weekdays'; days: number[] } // 0 = Sunday … 6 = Saturday
  | { type: 'weekly'; times: number }; // any days, this many times a week
/** Habits that tick themselves off from another part of the site. */
export const HABIT_LINKS = ['workout', 'daily-question', 'journal'] as const;
export type HabitLink = (typeof HABIT_LINKS)[number];

export type Habit = {
  id: string;
  name: string;
  emoji: string;
  /** Palette slot 1–8 (colors live in CSS so light and dark mode each get their own). */
  color: number;
  kind: HabitKind;
  /** What counts as done: 1 for check/avoid, a count, or minutes. */
  target: number;
  unit: string;
  schedule: HabitSchedule;
  link?: HabitLink;
  createdOn: DateKey;
  archivedOn?: DateKey;
};

/**
 * Logged values per day and habit. check: 1 = done. avoid: 1 = stayed clean,
 * -1 = slipped. count / duration: the amount. Missing means nothing logged.
 */
export type HabitLog = Record<DateKey, Record<string, number>>;

export type HabitsData = { version: 1; habits: Habit[]; log: HabitLog };

export type HabitInput = Partial<Omit<Habit, 'createdOn' | 'archivedOn'>>;

export type HabitAction =
  | { type: 'log'; habitId: string; date: DateKey; value: number }
  /** `newId` lets the browser name a new habit so later changes can refer to it before the server answers. */
  | { type: 'save'; habit: HabitInput; newId?: string }
  | { type: 'archive'; id: string; archived: boolean }
  | { type: 'delete'; id: string }
  | { type: 'move'; id: string; direction: -1 | 1 }
  /** Mark linked habits done on these days (e.g. days you worked out). */
  | { type: 'link-done'; link: HabitLink; dates: DateKey[] }
  /** Bring habits kept on this device into the account. */
  | { type: 'import'; data: HabitsData };

export const MAX_HABITS = 40;
/** How far back a day can still be filled in. */
export const EDIT_WINDOW_DAYS = 7;
export const COLOR_SLOTS = 8;
const KINDS: HabitKind[] = ['check', 'count', 'duration', 'avoid'];

/** A change that can't be applied, with a message fit to show the user. */
export class HabitInputError extends Error {}

export function emptyHabitsData(): HabitsData {
  return { version: 1, habits: [], log: {} };
}

export function isActive(habit: Habit) {
  return !habit.archivedOn;
}

/** The logged value that means "done" for a habit. */
export function isDone(habit: Habit, value: number | undefined) {
  return typeof value === 'number' && value >= habit.target;
}

function clampInt(value: unknown, min: number, max: number, fallback: number) {
  const n = Math.round(Number(value));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
}

function text(value: unknown, max: number) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function normalizeSchedule(value: any): HabitSchedule {
  if (value?.type === 'weekdays' && Array.isArray(value.days)) {
    const days = [...new Set(value.days.map(Number).filter((d: number) => Number.isInteger(d) && d >= 0 && d <= 6))].sort() as number[];
    if (days.length === 7) return { type: 'daily' };
    if (days.length) return { type: 'weekdays', days };
  }
  if (value?.type === 'weekly') return { type: 'weekly', times: clampInt(value.times, 1, 7, 3) };
  return { type: 'daily' };
}

/** A clean habit from user input, keeping `id` and the dates of an existing one. */
export function normalizeHabit(input: HabitInput, existing: Habit | undefined, id: string, today: DateKey, usedColors: number[] = []): Habit {
  const name = text(input.name, 60);
  if (!name) throw new HabitInputError('Give the habit a name.');
  const kind = KINDS.includes(input.kind as HabitKind) ? (input.kind as HabitKind) : 'check';
  const target = kind === 'count' ? clampInt(input.target, 1, 1000, 1)
    : kind === 'duration' ? clampInt(input.target, 1, 1440, 15)
    : 1;
  const unit = kind === 'count' ? text(input.unit, 20) || 'times' : kind === 'duration' ? 'min' : '';
  const freeColor = Array.from({ length: COLOR_SLOTS }, (_, i) => i + 1).find((c) => !usedColors.includes(c)) ?? 1;
  return {
    id,
    name,
    emoji: text(input.emoji, 8) || '✅',
    color: clampInt(input.color, 1, COLOR_SLOTS, existing?.color ?? freeColor),
    kind,
    target,
    unit,
    schedule: normalizeSchedule(input.schedule),
    ...(HABIT_LINKS.includes(input.link as HabitLink) && kind === 'check' ? { link: input.link as HabitLink } : {}),
    createdOn: existing?.createdOn ?? today,
    ...(existing?.archivedOn ? { archivedOn: existing.archivedOn } : {}),
  };
}

/** Accept a value for a habit: whole numbers, slips only for avoid habits. */
function normalizeValue(habit: Habit, value: unknown) {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) throw new HabitInputError('That isn’t a number.');
  if (habit.kind === 'check') return n > 0 ? 1 : 0;
  if (habit.kind === 'avoid') return n > 0 ? 1 : n < 0 ? -1 : 0;
  return Math.min(100_000, Math.max(0, n));
}

function setValue(log: HabitLog, date: DateKey, habitId: string, value: number) {
  if (value === 0) {
    if (log[date]) {
      delete log[date][habitId];
      if (!Object.keys(log[date]).length) delete log[date];
    }
    return;
  }
  (log[date] ||= {})[habitId] = value;
}

function canEdit(date: unknown, today: DateKey): date is DateKey {
  return isDateKey(date) && date <= today && date >= addDays(today, -EDIT_WINDOW_DAYS);
}

/** Make loaded or imported data safe to use: drop anything malformed. */
export function normalizeHabitsData(raw: unknown, today: DateKey): HabitsData {
  const data = emptyHabitsData();
  const source = raw && typeof raw === 'object' ? (raw as any) : {};
  const seen = new Set<string>();
  for (const h of Array.isArray(source.habits) ? source.habits : []) {
    if (!h || typeof h.id !== 'string' || !/^[\w-]{1,40}$/.test(h.id) || seen.has(h.id)) continue;
    try {
      const habit = normalizeHabit(h, undefined, h.id, today);
      if (isDateKey(h.createdOn) && h.createdOn <= today) habit.createdOn = h.createdOn;
      if (isDateKey(h.archivedOn)) habit.archivedOn = h.archivedOn;
      data.habits.push(habit);
      seen.add(h.id);
    } catch { /* skip a nameless habit */ }
    if (data.habits.length >= MAX_HABITS * 2) break;
  }
  const byId = new Map(data.habits.map((h) => [h.id, h]));
  const log = source.log && typeof source.log === 'object' ? source.log : {};
  for (const [date, day] of Object.entries<any>(log)) {
    if (!isDateKey(date) || date > addDays(today, 1) || !day || typeof day !== 'object') continue;
    for (const [id, value] of Object.entries(day)) {
      const habit = byId.get(id);
      if (!habit) continue;
      try { setValue(data.log, date, id, normalizeValue(habit, value)); } catch { /* skip */ }
    }
  }
  return data;
}

/**
 * Apply one change. Mutates and returns `data`; throws HabitInputError for a
 * change that isn't allowed. `today` is the user's local day.
 */
export function applyHabitAction(data: HabitsData, action: HabitAction, today: DateKey, newId: () => string): HabitsData {
  const find = (id: unknown) => data.habits.find((h) => h.id === id);

  switch (action?.type) {
    case 'log': {
      const habit = find(action.habitId);
      if (!habit) throw new HabitInputError('That habit no longer exists.');
      if (!canEdit(action.date, today)) throw new HabitInputError(`Only the last ${EDIT_WINDOW_DAYS} days can be changed.`);
      setValue(data.log, action.date, habit.id, normalizeValue(habit, action.value));
      return data;
    }
    case 'save': {
      const existing = action.habit?.id ? find(action.habit.id) : undefined;
      if (action.habit?.id && !existing) throw new HabitInputError('That habit no longer exists.');
      if (!existing && data.habits.filter(isActive).length >= MAX_HABITS) {
        throw new HabitInputError(`You can track up to ${MAX_HABITS} habits at once.`);
      }
      const usedColors = data.habits.filter(isActive).map((h) => h.color);
      const suggested = typeof action.newId === 'string' && /^[\w-]{1,40}$/.test(action.newId) && !find(action.newId) ? action.newId : undefined;
      const habit = normalizeHabit(action.habit || {}, existing, existing?.id ?? suggested ?? newId(), today, usedColors);
      if (existing) {
        // A new target or kind changes what old values mean; clear values that no longer fit.
        if (existing.kind !== habit.kind) {
          for (const date of Object.keys(data.log)) setValue(data.log, date, habit.id, 0);
        }
        data.habits[data.habits.indexOf(existing)] = habit;
      } else {
        data.habits.push(habit);
      }
      return data;
    }
    case 'archive': {
      const habit = find(action.id);
      if (!habit) throw new HabitInputError('That habit no longer exists.');
      if (action.archived) habit.archivedOn = today;
      else {
        if (data.habits.filter(isActive).length >= MAX_HABITS) throw new HabitInputError(`You can track up to ${MAX_HABITS} habits at once.`);
        delete habit.archivedOn;
      }
      return data;
    }
    case 'delete': {
      const habit = find(action.id);
      if (!habit) return data;
      data.habits.splice(data.habits.indexOf(habit), 1);
      for (const date of Object.keys(data.log)) setValue(data.log, date, habit.id, 0);
      return data;
    }
    case 'move': {
      const habit = find(action.id);
      if (!habit) return data;
      const from = data.habits.indexOf(habit);
      const to = from + (action.direction < 0 ? -1 : 1);
      if (to < 0 || to >= data.habits.length) return data;
      data.habits.splice(from, 1);
      data.habits.splice(to, 0, habit);
      return data;
    }
    case 'link-done': {
      const linked = data.habits.filter((h) => isActive(h) && h.link === action.link);
      if (!HABIT_LINKS.includes(action.link)) return data;
      for (const date of Array.isArray(action.dates) ? action.dates.slice(0, 31) : []) {
        if (!canEdit(date, today)) continue;
        // Days before the habit was made count too, so a new link picks up the past week.
        for (const habit of linked) {
          if (!data.log[date]?.[habit.id]) setValue(data.log, date, habit.id, 1);
        }
      }
      return data;
    }
    case 'import': {
      const incoming = normalizeHabitsData(action.data, today);
      for (const habit of incoming.habits) {
        if (data.habits.filter(isActive).length >= MAX_HABITS && isActive(habit)) break;
        // Device ids are random, but never let an import overwrite an account habit.
        const id = find(habit.id) ? newId() : habit.id;
        data.habits.push({ ...habit, id });
        for (const [date, day] of Object.entries(incoming.log)) {
          if (day[habit.id] && !data.log[date]?.[id]) setValue(data.log, date, id, day[habit.id]);
        }
      }
      return data;
    }
    default:
      throw new HabitInputError('Unknown change.');
  }
}
