import fs from 'fs/promises';
import path from 'path';
import { updateJson } from '@/lib/json-store';
import { generateId } from '@/lib/workout/data';
import { addDays, isDateKey } from '@/lib/habits/dates';
import { applyHabitAction, emptyHabitsData, isActive, normalizeHabitsData, type HabitsData } from '@/lib/habits/habits';

export function habitsFileForUser(userId: string, baseDir = process.cwd()): string | null {
  if (!/^[\w-]{1,64}$/.test(userId)) return null;
  return path.join(baseDir, '.data', 'habits', `${userId}.json`);
}

export function resolveWorkoutHabitDate(localDate: unknown, fallbackTimestamp?: string): string {
  const parsed = fallbackTimestamp ? Date.parse(fallbackTimestamp) : NaN;
  const serverDay = Number.isFinite(parsed)
    ? new Date(parsed).toISOString().slice(0, 10)
    : new Date().toISOString().slice(0, 10);
  if (isDateKey(localDate) && localDate >= addDays(serverDay, -1) && localDate <= addDays(serverDay, 1)) {
    return localDate;
  }
  return serverDay;
}

/**
 * Best-effort auto-tick of any active habit with `link === 'workout'` when a workout is saved.
 * Does not create a habits file if the user does not already have one on disk.
 */
export async function syncWorkoutHabitForDate(
  userId: string,
  workoutDate: string,
  baseDir = process.cwd(),
): Promise<boolean> {
  const file = habitsFileForUser(userId, baseDir);
  if (!file || !isDateKey(workoutDate)) return false;

  try {
    await fs.access(file);
  } catch {
    return false;
  }

  return updateJson<HabitsData, boolean>(file, emptyHabitsData(), (stored) => {
    const normalized = normalizeHabitsData(stored, workoutDate);
    const hasPending = normalized.habits.some(
      (habit) => isActive(habit) && habit.link === 'workout' && !normalized.log[workoutDate]?.[habit.id],
    );
    if (!hasPending) return false;

    applyHabitAction(normalized, { type: 'link-done', link: 'workout', dates: [workoutDate] }, workoutDate, generateId);
    stored.habits = normalized.habits;
    stored.log = normalized.log;
    return true;
  });
}
