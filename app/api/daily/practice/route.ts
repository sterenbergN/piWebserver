import { NextResponse } from 'next/server';
import { getAuthenticatedWorkoutUserId } from '@/lib/security/server-auth';
import { ApiError, handleApiError } from '@/lib/workout/api';
import { publicQuestion } from '@/lib/daily/grade';
import { scoreAttempt } from '@/lib/daily/progress';
import { answeredView, clampToday, questionIndex, readDay, readFeedback, readUserDaily } from '@/lib/daily/store';

// Practice: every question from past days (core and bonus) to work through as
// many as you like. Without `id`, the list to pick from (with how you did on
// each, signed in); with `id`, one question ready to answer. Answers go through
// /api/daily/answer like any other, so they count as catching up (half XP).

export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams;
    const today = clampToday(params.get('today'));
    const index = await questionIndex();
    const userId = await getAuthenticatedWorkoutUserId();
    const mine = userId ? await readUserDaily(userId) : null;
    const id = params.get('id');

    if (!id) {
      const questions = [...index.values()]
        .filter((at) => at.date <= today)
        .map((at) => {
          const attempt = mine?.attempts.find((a) => a.questionId === at.question.id);
          return {
            id: at.question.id, date: at.date, core: at.core, boss: at.boss,
            track: at.question.track, topic: at.question.topic, difficulty: at.question.difficulty, title: at.question.title,
            status: attempt ? scoreAttempt(attempt, at.question).result.status : null,
          };
        })
        .sort((a, b) => b.date.localeCompare(a.date) || Number(b.core) - Number(a.core));
      return NextResponse.json({ success: true, signedIn: !!userId, questions }, { headers: { 'Cache-Control': 'no-store' } });
    }

    const at = index.get(id);
    if (!at || at.date > today) throw new ApiError(404, 'Question not found');
    const day = await readDay(at.date);
    const used = new Set(at.question.formulas ?? []);
    const attempt = mine?.attempts.find((a) => a.questionId === id);
    const fb = attempt && userId ? (await readFeedback()).entries.find((e) => e.questionId === id && e.userId === userId) : undefined;
    return NextResponse.json({
      success: true,
      date: at.date,
      core: at.core,
      boss: at.boss,
      question: publicQuestion(at.question),
      formulas: (day?.formulas ?? []).filter((f) => used.has(f.id)),
      answered: attempt ? answeredView(at.question, attempt, fb) : null,
      tries: mine?.pending?.[id] ?? 0,
    }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return handleApiError(error, 'Load practice questions failed');
  }
}
