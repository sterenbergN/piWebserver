'use client';

import { localToday } from '@/lib/habits/dates';
import { normalizeHabitsData } from '@/lib/habits/habits';
import { habitXp } from '@/lib/habits/stats';
import { questionStats, scoreAll, type Attempt } from '@/lib/daily/progress';

// The profile level adds up XP from habits and daily questions. Each page works
// out its own XP and fetches the other's here: from the account when signed in,
// from this device otherwise.

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
