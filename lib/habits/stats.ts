// Everything worked out from habits + the day log: what's due, streaks (with
// freezes), completion rates, XP and garden growth. Nothing here is stored, so
// filling in a missed day later fixes every number that depended on it.

import { addDays, dayOfWeek, daysBetween, eachDay, weekStart, type DateKey } from './dates';
import { isDone, type Habit, type HabitLog, type HabitsData } from './habits';

/** Streak freezes are earned for every 7 perfect days in a row, holding at most this many. */
export const MAX_FREEZES = 2;
export const FREEZE_EVERY = 7;

export const XP = {
  habit: 10,
  perfectDay: 20,
  weeklyGoal: 30,
  /** Bonus when a habit's streak reaches each length (days, or weeks for weekly habits). */
  milestones: [[7, 50], [30, 150], [100, 400], [365, 1000]] as [number, number][],
};

export const isWeekly = (h: Habit) => h.schedule.type === 'weekly';

/** The first day a habit counts from: when it was made, or its earliest logged day. */
export function habitStart(habit: Habit, log: HabitLog): DateKey {
  let start = habit.createdOn;
  for (const date of Object.keys(log)) if (date < start && log[date][habit.id] !== undefined) start = date;
  return start;
}

/** Whether the habit existed (and wasn't archived) on `date`. */
function alive(habit: Habit, start: DateKey, date: DateKey) {
  return date >= start && (!habit.archivedOn || date < habit.archivedOn);
}

/** Whether a daily/weekday habit is due on `date` (weekly habits are never "due" on a given day). */
export function isDueOn(habit: Habit, date: DateKey) {
  if (habit.schedule.type === 'daily') return true;
  if (habit.schedule.type === 'weekdays') return habit.schedule.days.includes(dayOfWeek(date));
  return false;
}

export const valueOn = (log: HabitLog, date: DateKey, habit: Habit) => log[date]?.[habit.id];
export const doneOn = (log: HabitLog, date: DateKey, habit: Habit) => isDone(habit, valueOn(log, date, habit));

/** Completions of a weekly habit in the week holding `date`. */
export function weekCount(log: HabitLog, habit: Habit, date: DateKey) {
  const start = weekStart(date);
  let count = 0;
  for (let i = 0; i < 7; i++) if (doneOn(log, addDays(start, i), habit)) count++;
  return count;
}

type Starts = Map<string, DateKey>;
const startsOf = (data: HabitsData): Starts => habitStarts(data.habits, data.log);

/** Daily/weekday habits due on `date`. */
function dueHabits(data: HabitsData, starts: Starts, date: DateKey) {
  return data.habits.filter((h) => !isWeekly(h) && alive(h, starts.get(h.id)!, date) && isDueOn(h, date));
}

function earliest(data: HabitsData, starts: Starts, today: DateKey) {
  let first = today;
  for (const s of starts.values()) if (s < first) first = s;
  return first;
}

/** Whether everything due on `date` was done (and something was due). */
export function isPerfectDay(data: HabitsData, date: DateKey) {
  const due = dueHabits(data, startsOf(data), date);
  return due.length > 0 && due.every((h) => doneOn(data.log, date, h));
}

/**
 * Freezes: walk every finished day. A perfect day (everything due was done)
 * extends the run, and every 7th one earns a freeze. A missed day spends a
 * freeze if there is one (the run carries on), otherwise the run resets.
 */
export function freezeState(data: HabitsData, today: DateKey) {
  const starts = startsOf(data);
  const frozen = new Set<DateKey>();
  let available = 0;
  let run = 0;
  const yesterday = addDays(today, -1);
  for (const date of eachDay(earliest(data, starts, today), yesterday)) {
    const due = dueHabits(data, starts, date);
    if (!due.length) continue;
    if (due.every((h) => doneOn(data.log, date, h))) {
      run++;
      if (run % FREEZE_EVERY === 0 && available < MAX_FREEZES) available++;
    } else if (available > 0) {
      available--;
      frozen.add(date);
    } else {
      run = 0;
    }
  }
  return { available, frozen, perfectRun: run };
}

export type DayStatus = 'done' | 'missed' | 'frozen' | 'slipped' | 'pending' | 'off';

/** How a habit stands on one day. `pending` is today, not done yet. */
export function dayStatus(habit: Habit, log: HabitLog, date: DateKey, today: DateKey, frozen: Set<DateKey>, start = habitStart(habit, log)): DayStatus {
  if (!alive(habit, start, date) || date > today) return 'off';
  const value = valueOn(log, date, habit);
  if (habit.kind === 'avoid' && value === -1) return 'slipped';
  if (isDone(habit, value)) return 'done';
  if (isWeekly(habit) || !isDueOn(habit, date)) return 'off';
  if (date === today) return 'pending';
  return frozen.has(date) ? 'frozen' : 'missed';
}

/** A habit's current and best streak, in days (weeks for weekly habits). */
export function habitStreak(habit: Habit, log: HabitLog, today: DateKey, frozen: Set<DateKey>) {
  const start = habitStart(habit, log);
  if (isWeekly(habit)) return weeklyStreak(habit, log, today, start);

  let best = 0;
  let run = 0;
  for (const date of eachDay(start, today)) {
    const status = dayStatus(habit, log, date, today, frozen, start);
    if (status === 'done') best = Math.max(best, ++run);
    else if (status === 'missed' || status === 'slipped') run = 0;
  }
  // A run still open today is the current streak; today not done yet doesn't break it.
  return { current: run, best, unit: 'day' as const };
}

function weeklyStreak(habit: Habit, log: HabitLog, today: DateKey, start: DateKey) {
  const times = habit.schedule.type === 'weekly' ? habit.schedule.times : 1;
  const thisWeek = weekStart(today);
  let best = 0;
  let run = 0;
  for (let week = weekStart(start); week <= thisWeek; week = addDays(week, 7)) {
    const met = weekCount(log, habit, week) >= times;
    if (met) best = Math.max(best, ++run);
    else if (week !== thisWeek) run = 0; // this week can still be met
  }
  return { current: run, best, unit: 'week' as const };
}

/** Consecutive perfect days up to today (freezes keep it alive; today pending doesn't break it). */
export function perfectStreak(data: HabitsData, today: DateKey, frozen: Set<DateKey>) {
  const starts = startsOf(data);
  let best = 0;
  let run = 0;
  for (const date of eachDay(earliest(data, starts, today), today)) {
    const due = dueHabits(data, starts, date);
    if (!due.length) continue;
    if (due.every((h) => doneOn(data.log, date, h))) best = Math.max(best, ++run);
    else if (date !== today && !frozen.has(date)) run = 0;
  }
  return { current: run, best };
}

/**
 * Done / due over a range for some habits. Weekly habits count each finished
 * week (or this week once met) as one occasion. Frozen days and today (until
 * done) don't count against you.
 */
export function completion(habits: Habit[], log: HabitLog, from: DateKey, to: DateKey, today: DateKey, frozen: Set<DateKey>) {
  let done = 0;
  let due = 0;
  for (const habit of habits) {
    const start = habitStart(habit, log);
    if (isWeekly(habit)) {
      const times = habit.schedule.type === 'weekly' ? habit.schedule.times : 1;
      for (let week = weekStart(from); week <= to; week = addDays(week, 7)) {
        if (addDays(week, 6) < start || (habit.archivedOn && week >= habit.archivedOn)) continue;
        const met = weekCount(log, habit, week) >= times;
        if (met) { done++; due++; } else if (addDays(week, 6) < today) due++;
      }
      continue;
    }
    for (const date of eachDay(from < start ? start : from, to)) {
      const status = dayStatus(habit, log, date, today, frozen, start);
      if (status === 'done') { done++; due++; }
      else if (status === 'missed' || status === 'slipped') due++;
    }
  }
  return { done, due, rate: due ? done / due : null };
}

/** Each habit's start day (see habitStart), worked out once for loops over many days. */
export function habitStarts(habits: Habit[], log: HabitLog) {
  return new Map(habits.map((h) => [h.id, habitStart(h, log)]));
}

/** Share of the day's habits done, for the calendar heatmap (null = nothing to do that day). */
export function dayScore(habits: Habit[], log: HabitLog, date: DateKey, today: DateKey, frozen: Set<DateKey>, starts: Map<string, DateKey>) {
  let done = 0;
  let total = 0;
  for (const habit of habits) {
    const status = dayStatus(habit, log, date, today, frozen, starts.get(habit.id));
    if (status === 'done') { done++; total++; }
    else if (status === 'missed' || status === 'slipped' || status === 'pending') total++;
  }
  return total ? done / total : null;
}

/** Done rate by weekday (Monday first) for daily/weekday habits. */
export function weekdayRates(habits: Habit[], log: HabitLog, from: DateKey, today: DateKey, frozen: Set<DateKey>) {
  const done = Array(7).fill(0);
  const due = Array(7).fill(0);
  for (const habit of habits.filter((h) => !isWeekly(h))) {
    const start = habitStart(habit, log);
    for (const date of eachDay(from, today)) {
      const status = dayStatus(habit, log, date, today, frozen, start);
      const i = (dayOfWeek(date) + 6) % 7;
      if (status === 'done') { done[i]++; due[i]++; }
      else if (status === 'missed' || status === 'slipped') due[i]++;
    }
  }
  return ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((day, i) => ({ day, done: done[i], due: due[i], rate: due[i] ? done[i] / due[i] : null }));
}

/** XP earned from habits, all worked out from the log. */
export function habitXp(data: HabitsData, today: DateKey) {
  const { frozen } = freezeState(data, today);
  const starts = startsOf(data);
  let xp = 0;

  for (const habit of data.habits) {
    const start = starts.get(habit.id)!;
    let run = 0;
    if (isWeekly(habit)) {
      const times = habit.schedule.type === 'weekly' ? habit.schedule.times : 1;
      for (let week = weekStart(start); week <= today; week = addDays(week, 7)) {
        const count = weekCount(data.log, habit, week);
        xp += count * XP.habit;
        if (count >= times) {
          xp += XP.weeklyGoal;
          run++;
          for (const [length, bonus] of XP.milestones) if (run === length) xp += bonus;
        } else if (week !== weekStart(today)) run = 0;
      }
      continue;
    }
    for (const date of eachDay(start, today)) {
      const status = dayStatus(habit, data.log, date, today, frozen, start);
      if (status === 'done') {
        xp += XP.habit;
        run++;
        for (const [length, bonus] of XP.milestones) if (run === length) xp += bonus;
      } else if (status === 'missed' || status === 'slipped') run = 0;
    }
  }

  for (const date of eachDay(earliest(data, starts, today), today)) {
    const due = dueHabits(data, starts, date);
    if (due.length && due.every((h) => doneOn(data.log, date, h))) xp += XP.perfectDay;
  }
  return xp;
}

/** The status line under a habit on a given day: "2 of 3 this week · 🔥 4-day streak". */
export function habitMeta(habit: Habit, log: HabitLog, day: DateKey, today: DateKey, frozen: Set<DateKey>) {
  const value = Math.max(0, log[day]?.[habit.id] ?? 0);
  const streak = habitStreak(habit, log, today, frozen);
  const parts: string[] = [];
  if (habit.schedule.type === 'weekly') parts.push(`${weekCount(log, habit, day)} of ${habit.schedule.times} this week`);
  if (habit.kind === 'count' || habit.kind === 'duration') parts.push(`${value} / ${habit.target} ${habit.kind === 'duration' ? 'min' : habit.unit}`);
  if (streak.current > 0) parts.push(`🔥 ${streak.current}-${streak.unit} streak`);
  else if (!parts.length && day === today) parts.push('Start a streak today');
  if (habit.link === 'workout') parts.push('auto from workouts');
  if (habit.link === 'daily-question') parts.push('auto from daily questions');
  if (habit.link === 'journal') parts.push('auto from journal');
  return parts.join(' · ');
}

/** Garden: a plant grows with every completion and wilts when recent days are missed. */
export const PLANT_STAGES = [
  { at: 0, name: 'Seed' },
  { at: 1, name: 'Sprout' },
  { at: 5, name: 'Seedling' },
  { at: 15, name: 'Young plant' },
  { at: 35, name: 'Bush' },
  { at: 70, name: 'In bloom' },
  { at: 120, name: 'Grand tree' },
];

export function plantState(habit: Habit, log: HabitLog, today: DateKey, frozen: Set<DateKey>) {
  let total = 0;
  for (const day of Object.values(log)) if (isDone(habit, day[habit.id])) total++;
  let stage = 0;
  PLANT_STAGES.forEach((s, i) => { if (total >= s.at) stage = i; });
  const next = PLANT_STAGES[stage + 1];

  // Health from the last two weeks; a brand-new habit gets the benefit of the doubt.
  const recent = completion([habit], log, addDays(today, -13), today, today, frozen);
  const age = daysBetween(habitStart(habit, log), today);
  const health = recent.rate === null || age < 3 ? 1 : recent.rate;
  return {
    total,
    stage,
    stageName: PLANT_STAGES[stage].name,
    toNext: next ? next.at - total : 0,
    health,
    mood: health >= 0.8 ? 'thriving' as const : health >= 0.4 ? 'okay' as const : 'wilting' as const,
    wateredToday: isDone(habit, log[today]?.[habit.id]),
  };
}
