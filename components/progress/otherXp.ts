'use client';

import { localToday } from '@/lib/habits/dates';
import { normalizeHabitsData } from '@/lib/habits/habits';
import { habitXp } from '@/lib/habits/stats';
import { questionStats, scoreAll, type Attempt } from '@/lib/daily/progress';
import { normalizeChoresData } from '@/lib/chores/chores';
import { choreXp } from '@/lib/chores/stats';

// The profile level adds up XP from habits, daily questions and chores. Each
// page works out its own XP and fetches the others' here: from the account when
// signed in, from this device otherwise.

function fromStorage<T>(key: string): T | null {
  try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch { return null; }
}

export async function habitsXpElsewhere(): Promise<number> {
  const today = localToday();
  try {
    const res = await fetch(`/api/habits?today=${today}`, { cache: 'no-store' });
    if (res.ok) {
      const body = await res.json();
      return body.success ? habitXp(normalizeHabitsData(body.data, today), today) : 0;
    }
    if (res.status !== 401) return 0;
  } catch {
    return 0;
  }
  return habitXp(normalizeHabitsData(fromStorage('habits:device'), today), today);
}

export async function questionsXpElsewhere(): Promise<number> {
  const today = localToday();
  try {
    const res = await fetch(`/api/daily/progress?today=${today}`, { cache: 'no-store' });
    if (res.ok) {
      const body = await res.json();
      return body.success ? body.stats.total.xp : 0;
    }
    if (res.status !== 401) return 0;
  } catch {
    return 0;
  }
  const attempts = fromStorage<{ attempts: Attempt[] }>('daily:device')?.attempts ?? [];
  return questionStats(scoreAll(Array.isArray(attempts) ? attempts : [], new Map()), today).total.xp;
}

/** XP for the chores you did (in a shared household, only your own). */
export async function choresXpElsewhere(): Promise<number> {
  const today = localToday();
  try {
    const res = await fetch(`/api/chores?today=${today}`, { cache: 'no-store' });
    if (res.ok) {
      const body = await res.json();
      return body.success ? choreXp(normalizeChoresData(body.data, today), body.household?.me ?? null) : 0;
    }
    if (res.status !== 401) return 0;
  } catch {
    return 0;
  }
  return choreXp(normalizeChoresData(fromStorage('chores:device'), today), null);
}
