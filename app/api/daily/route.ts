import { NextResponse } from 'next/server';
import { getAuthenticatedWorkoutUserId } from '@/lib/security/server-auth';
import { handleApiError } from '@/lib/workout/api';
import { isDateKey } from '@/lib/habits/dates';
import { publicDay, revealedQuestion, gradeQuestion } from '@/lib/daily/grade';
import { scoreAttempt } from '@/lib/daily/progress';
import { clampToday, questionIndex, readDay, readFeedback, readUserDaily } from '@/lib/daily/store';

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
    if (day && userId) {
      const [{ attempts }, { entries }] = await Promise.all([readUserDaily(userId), readFeedback()]);
      for (const q of [day.core, ...day.bonus]) {
        const attempt = attempts.find((a) => a.questionId === q.id);
        if (!attempt) continue;
        const { result, regraded, xp } = scoreAttempt(attempt, q);
        const fb = entries.find((e) => e.questionId === q.id && e.userId === userId);
        answered[q.id] = {
          ...result, parts: gradeQuestion(q, attempt.responses).parts, responses: attempt.responses, hints: attempt.hints, xp, regraded,
          late: attempt.answeredOn > attempt.date, question: revealedQuestion(q),
          feedback: { rating: fb?.rating ?? null, difficulty: fb?.difficulty ?? null, report: fb?.report ?? null },
        };
      }
    }
    return NextResponse.json(
      { success: true, date, today, archive, signedIn: !!userId, day: day ? publicDay(day) : null, answered },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    return handleApiError(error, 'Load daily questions failed');
  }
}
