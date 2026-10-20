import { NextResponse } from 'next/server';
import { getAuthenticatedWorkoutUserId } from '@/lib/security/server-auth';
import { handleApiError } from '@/lib/workout/api';
import { loadUsersData } from '@/lib/workout/users';
import { questionStats, scoreAll } from '@/lib/daily/progress';
import { clampToday, listUserIds, questionIndex, readUserDaily } from '@/lib/daily/store';

// Only people who switched the leaderboard on appear here.

export async function GET(request: Request) {
  try {
    const today = clampToday(new URL(request.url).searchParams.get('today'));
    const [ids, index, users, me] = await Promise.all([listUserIds(), questionIndex(), loadUsersData(), getAuthenticatedWorkoutUserId()]);
    const questions = new Map([...index].map(([id, at]) => [id, at.question]));
    const names = new Map(users.users.map((u) => [u.id, String(u.username || '')]));
    const rows = [];
    for (const id of ids) {
      const data = await readUserDaily(id);
      if (!data.leaderboard || !names.get(id)) continue;
      const stats = questionStats(scoreAll(data.attempts, questions), today);
      rows.push({ name: names.get(id)!, me: id === me, xp: stats.total.xp, week: stats.xpThisWeek, streak: stats.streak.current, solved: stats.total.solved });
    }
    rows.sort((a, b) => b.week - a.week || b.xp - a.xp);
    return NextResponse.json({ success: true, rows }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return handleApiError(error, 'Load leaderboard failed');
  }
}
