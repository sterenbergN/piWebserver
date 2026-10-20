import { NextResponse } from 'next/server';
import { getAuthenticatedWorkoutUserId } from '@/lib/security/server-auth';
import { ApiError, handleApiError, readJsonObject } from '@/lib/workout/api';
import { isDateKey } from '@/lib/habits/dates';
import { gradeQuestion, parseResponses, revealedQuestion } from '@/lib/daily/grade';
import { attemptMeta, attemptXp, type Attempt } from '@/lib/daily/progress';
import { clampToday, readDay, updateUserDaily } from '@/lib/daily/store';

// Answer a question (or open its worked solution without answering: reveal).
// One go per question; signed-in answers are saved, signed-out ones are only
// graded and kept in the browser.

export async function POST(request: Request) {
  try {
    const body = await readJsonObject(request);
    const today = clampToday(body.today);
    if (!isDateKey(body.date) || body.date > today) throw new ApiError(400, 'That day’s questions aren’t out yet.');
    const day = await readDay(body.date);
    const question = day && [day.core, ...day.bonus].find((q) => q.id === body.questionId);
    if (!day || !question) throw new ApiError(404, 'Question not found');

    const reveal = body.reveal === true;
    const responses = reveal ? null : parseResponses(question, body.responses);
    if (responses && !Object.keys(responses).length) throw new ApiError(400, 'Enter an answer first.');
    const hints = Math.min(question.hints?.length ?? 0, Math.max(0, Math.round(Number(body.hints) || 0)));
    const attempt: Attempt = {
      questionId: question.id,
      date: day.date,
      answeredOn: today,
      at: new Date().toISOString(),
      responses,
      hints,
      result: { correct: 0, total: question.parts.length, status: 'studied' },
      meta: attemptMeta(question, question.id === day.core.id, !!day.boss),
    };
    const graded = gradeQuestion(question, responses);
    attempt.result = { correct: graded.correct, total: graded.total, status: graded.status };

    let saved = attempt;
    const userId = await getAuthenticatedWorkoutUserId();
    if (userId) {
      // A second try (another tab, a double tap) gets the first answer back.
      saved = await updateUserDaily(userId, (data) => {
        const existing = data.attempts.find((a) => a.questionId === question.id);
        if (existing) return existing;
        data.attempts.push(attempt);
        return attempt;
      });
    }
    const result = gradeQuestion(question, saved.responses);
    return NextResponse.json({
      success: true,
      saved: !!userId,
      attempt: saved,
      ...result,
      responses: saved.responses,
      hints: saved.hints,
      late: saved.answeredOn > saved.date,
      xp: attemptXp(saved, result),
      question: revealedQuestion(question),
    });
  } catch (error) {
    return handleApiError(error, 'Answer failed');
  }
}
