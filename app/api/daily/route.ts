import { NextResponse } from 'next/server';
import { getAuthenticatedWorkoutUserId } from '@/lib/security/server-auth';
import { handleApiError } from '@/lib/workout/api';
import { isDateKey } from '@/lib/habits/dates';
import { publicDay } from '@/lib/daily/grade';
import { answeredView, clampToday, questionIndex, readDay, readFeedback, readUserDaily } from '@/lib/daily/store';

// A day's questions as anyone may see them. Questions you've already answered
// (or given up on) come with their answer key, worked solution and your grade.

export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams;
    const today = clampToday(params.get('today'));
    const asked = params.get('date');
    const date = isDateKey(asked) && asked <= today ? asked : today;
    // Past days for the archive, newest first: the core question's title and track.
    const index = await questionIndex();
    const archive = [...index.values()].filter((at) => at.core && at.date <= today)
      .map((at) => ({ date: at.date, title: at.question.title, track: at.question.track, topic: at.question.topic, boss: at.boss }))
      .sort((a, b) => b.date.localeCompare(a.date));

    const day = await readDay(date);
    const userId = await getAuthenticatedWorkoutUserId();
    const answered: Record<string, unknown> = {};
    /** Checks already used on questions not finished yet. */
    const tries: Record<string, number> = {};
    if (day && userId) {
      const [{ attempts, pending }, { entries }] = await Promise.all([readUserDaily(userId), readFeedback()]);
      for (const q of [day.core, ...day.bonus]) if (pending?.[q.id]) tries[q.id] = pending[q.id];
      for (const q of [day.core, ...day.bonus]) {
        const attempt = attempts.find((a) => a.questionId === q.id);
        if (attempt) answered[q.id] = answeredView(q, attempt, entries.find((e) => e.questionId === q.id && e.userId === userId));
      }
    }
    return NextResponse.json(
      { success: true, date, today, archive, signedIn: !!userId, day: day ? publicDay(day) : null, answered, tries },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    return handleApiError(error, 'Load daily questions failed');
  }
}
