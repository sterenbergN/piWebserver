// Everything worked out from chores + their log: what's due, XP (for whoever
// did each one), on-time streaks, the week's household scoreboard and how each
// chore's plant is doing. Nothing here is stored.

import { addDays, daysBetween, weekStart, type DateKey } from '../habits/dates';
import { PLANT_STAGES } from '../habits/stats';
import { isOpen, repeatDays, type Chore, type ChoreEntry, type ChoresData } from './chores';

export const CHORE_XP = {
  /** By effort: quick, medium, big. */
  effort: [0, 10, 20, 35] as const,
  /** Extra for getting it done by its due date. */
  onTime: 5,
  /** Bonus when a chore is done on time this many times in a row. */
  milestones: [[4, 25], [12, 75], [26, 150], [52, 300]] as [number, number][],
};

export const EFFORT_LABEL = ['', 'Quick', 'Medium', 'Big'] as const;

export type DueStatus = 'overdue' | 'today' | 'soon' | 'later' | 'anytime' | 'done';

/** Where a chore stands today, and by how many days (late is negative). */
export function dueStatus(chore: Chore, today: DateKey): { status: DueStatus; days: number } {
  if (!isOpen(chore)) return { status: 'done', days: 0 };
  if (!chore.due) return { status: 'anytime', days: 0 };
  const days = daysBetween(today, chore.due);
  return { status: days < 0 ? 'overdue' : days === 0 ? 'today' : days <= 6 ? 'soon' : 'later', days };
}

/** "3 days overdue", "Due today", "Due Thursday", "Due Nov 4". */
export function dueText(chore: Chore, today: DateKey) {
  const { status, days } = dueStatus(chore, today);
  if (status === 'done') return 'Done';
  if (status === 'anytime') return 'Whenever';
  if (status === 'overdue') return days === -1 ? 'Due yesterday' : `${-days} days overdue`;
  if (status === 'today') return 'Due today';
  if (days === 1) return 'Due tomorrow';
  const date = new Date(`${chore.due}T12:00:00`);
  return `Due ${date.toLocaleDateString(undefined, status === 'soon' ? { weekday: 'long' } : { month: 'short', day: 'numeric' })}`;
}

export function repeatText(chore: Pick<Chore, 'repeat'>) {
  if (!chore.repeat) return 'One time';
  const { every, unit } = chore.repeat;
  if (every === 1) return unit === 'day' ? 'Every day' : unit === 'week' ? 'Every week' : 'Every month';
  return `Every ${every} ${unit}s`;
}

const onTime = (e: ChoreEntry) => !e.due || e.date <= e.due;

/** XP for each entry (skips earn nothing), with streak bonuses on the entry that reached them. */
function scoredEntries(data: ChoresData) {
  const byChore = new Map(data.chores.map((c) => [c.id, c]));
  const runs = new Map<string, number>();
  return data.log.map((entry) => {
    const chore = byChore.get(entry.choreId);
    if (!chore || entry.skipped) return { entry, xp: 0 };
    let xp = CHORE_XP.effort[chore.effort];
    if (onTime(entry)) {
      xp += CHORE_XP.onTime;
      const run = (runs.get(chore.id) ?? 0) + 1;
      runs.set(chore.id, run);
      for (const [length, bonus] of CHORE_XP.milestones) if (run === length) xp += bonus;
    } else runs.set(chore.id, 0);
    return { entry, xp };
  });
}

/** XP from chores for one member (or everyone, with `member` null: a device with no account). */
export function choreXp(data: ChoresData, member: string | null) {
  let xp = 0;
  for (const { entry, xp: earned } of scoredEntries(data)) if (member === null || entry.by === member) xp += earned;
  return xp;
}

/** XP an entry earned, for "+20 XP" next to it. */
export function entryXp(data: ChoresData, entryId: string) {
  return scoredEntries(data).find((s) => s.entry.id === entryId)?.xp ?? 0;
}

/** The current run of on-time completions for a chore (skips neither count nor break it). */
export function choreStreak(data: ChoresData, choreId: string) {
  let run = 0;
  for (const e of data.log) {
    if (e.choreId !== choreId || e.skipped) continue;
    run = onTime(e) ? run + 1 : 0;
  }
  return run;
}

/** This week's XP and chore count per member, best first. */
export function weekBoard(data: ChoresData, today: DateKey, members: string[]) {
  const from = weekStart(today);
  const board = new Map(members.map((m) => [m, { member: m, xp: 0, count: 0 }]));
  for (const { entry, xp } of scoredEntries(data)) {
    if (entry.date < from || entry.date > today || entry.skipped || !entry.by || !board.has(entry.by)) continue;
    const row = board.get(entry.by)!;
    row.xp += xp;
    row.count++;
  }
  return [...board.values()].sort((a, b) => b.xp - a.xp);
}

/** Recent done/skipped entries, newest first. */
export function recentEntries(data: ChoresData, today: DateKey, days = 14) {
  const from = addDays(today, -days);
  return data.log.filter((e) => e.date >= from).reverse();
}

/** Chores done less often than habits, so their plants grow on fewer check-ins. */
const CHORE_STAGE_AT = [0, 1, 3, 6, 12, 24, 48];

/** A repeating chore's plant: grows with every time it's done, wilts while it's overdue. */
export function chorePlant(chore: Chore, data: ChoresData, today: DateKey) {
  const total = data.log.filter((e) => e.choreId === chore.id && !e.skipped).length;
  let stage = 0;
  CHORE_STAGE_AT.forEach((at, i) => { if (total >= at) stage = i; });
  const late = chore.due ? daysBetween(chore.due, today) : 0;
  const mood = late <= 0 ? 'thriving' as const : late <= Math.max(1, repeatDays(chore.repeat) / 2) ? 'okay' as const : 'wilting' as const;
  return {
    total,
    stage,
    stageName: PLANT_STAGES[stage].name,
    nextAt: CHORE_STAGE_AT[stage + 1] ?? null,
    stageAt: CHORE_STAGE_AT[stage],
    mood,
    wateredToday: data.log.some((e) => e.choreId === chore.id && e.date === today && !e.skipped),
  };
}

/** Open chores in the order they need doing: most overdue first, whenever-chores last. */
export function byUrgency(chores: Chore[]) {
  return [...chores].sort((a, b) => (a.due ?? '9999').localeCompare(b.due ?? '9999') || a.name.localeCompare(b.name));
}
