import { NextResponse } from 'next/server';
import path from 'path';
import { getAuthenticatedWorkoutUserId } from '@/lib/security/server-auth';
import { handleApiError } from '@/lib/workout/api';
import { loadUsersData } from '@/lib/workout/users';
import { readJson } from '@/lib/json-store';
import { questionStats, scoreAll } from '@/lib/daily/progress';
import { clampToday, listUserIds, questionIndex, readUserDaily } from '@/lib/daily/store';
import { emptyHabitsData, normalizeHabitsData } from '@/lib/habits/habits';
import { freezeState, habitXp, perfectStreak } from '@/lib/habits/stats';
import { emptyChoresData, normalizeChoresData, type ChoresData } from '@/lib/chores/chores';
import { choreXp, weekBoard } from '@/lib/chores/stats';
import { choresFile, findHousehold } from '@/lib/chores/households';
import { levelFromXp } from '@/lib/progress/levels';

// Only people who switched the leaderboard on appear here. Each row has their
// question, habit and chore XP, so the page can rank by any of them or by level.

async function habitsFor(userId: string, today: string) {
  if (!/^[\w-]{1,64}$/.test(userId)) return { xp: 0, streak: 0 };
  const data = normalizeHabitsData(await readJson(path.join(process.cwd(), '.data', 'habits', `${userId}.json`), emptyHabitsData()), today);
  return { xp: habitXp(data, today), streak: perfectStreak(data, today, freezeState(data, today).frozen).current };
}

async function choresFor(userId: string, today: string, households: Map<string, ChoresData>) {
  const household = await findHousehold(userId);
  if (!household) return { xp: 0, week: 0 };
  if (!households.has(household.id)) households.set(household.id, normalizeChoresData(await readJson(choresFile(household.id), emptyChoresData()), today));
  const data = households.get(household.id)!;
  return { xp: choreXp(data, userId), week: weekBoard(data, today, [userId])[0]?.xp ?? 0 };
}

export async function GET(request: Request) {
  try {
    const today = clampToday(new URL(request.url).searchParams.get('today'));
    const [ids, index, users, me] = await Promise.all([listUserIds(), questionIndex(), loadUsersData(), getAuthenticatedWorkoutUserId()]);
    const questions = new Map([...index].map(([id, at]) => [id, at.question]));
    const names = new Map(users.users.map((u) => [u.id, String(u.username || '')]));
    const households = new Map<string, ChoresData>();
    const rows = [];
    for (const id of ids) {
      const data = await readUserDaily(id);
      if (!data.leaderboard || !names.get(id)) continue;
      const stats = questionStats(scoreAll(data.attempts, questions), today);
      const [habits, chores] = await Promise.all([habitsFor(id, today), choresFor(id, today, households)]);
      const total = stats.total.xp + habits.xp + chores.xp;
      const level = levelFromXp(total);
      rows.push({
        name: names.get(id)!, me: id === me, xp: stats.total.xp, week: stats.xpThisWeek, streak: stats.streak.current, solved: stats.total.solved,
        habits, chores, total, level: level.level, title: level.title,
      });
    }
    rows.sort((a, b) => b.week - a.week || b.xp - a.xp);
    return NextResponse.json({ success: true, rows }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return handleApiError(error, 'Load leaderboard failed');
  }
}
