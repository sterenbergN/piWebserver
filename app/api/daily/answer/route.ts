import { NextResponse } from 'next/server';
import { getAuthenticatedWorkoutUserId } from '@/lib/security/server-auth';
import { ApiError, handleApiError, readJsonObject } from '@/lib/workout/api';
import { isDateKey } from '@/lib/habits/dates';
import { gradeQuestion, parseResponses, revealedQuestion } from '@/lib/daily/grade';
import { XP_RULES, attemptMeta, attemptXp, type Attempt } from '@/lib/daily/progress';
import { clampToday, findQuestion, updateUserDaily } from '@/lib/daily/store';

// Check an answer, or open the worked solution without answering (reveal).
// Up to three checks per question: a check that isn't fully right says which
// parts are wrong (not the answers) and lets you try again, for a little less
// XP each time. The question locks on a full solve, the third check, or a
// reveal. Signed-in answers are saved; signed-out ones are only graded and
// kept in the browser (`final` regrades one of those for its solution).
// Practice-only and generated questions have no day: they count on today.

export async function POST(request: Request) {
  try {
    const body = await readJsonObject(request);
    const today = clampToday(body.today);
    const found = await findQuestion(body.questionId);
    if (!found) throw new ApiError(404, 'Question not found');
    if (found.date && found.date > today) throw new ApiError(400, 'That day’s questions aren’t out yet.');
    const { question } = found;
    const date = found.date ?? (isDateKey(body.date) && body.date <= today ? body.date : today);

    const reveal = body.reveal === true;
    const responses = reveal ? null : parseResponses(question, body.responses);
    if (responses && !Object.keys(responses).length) throw new ApiError(400, 'Enter an answer first.');
    const hints = Math.min(question.hints?.length ?? 0, Math.max(0, Math.round(Number(body.hints) || 0)));
    const graded = gradeQuestion(question, responses);
    const claimedTries = Math.max(0, Math.round(Number(body.tries) || 0));
    const attempt = (tries: number): Attempt => ({
      questionId: question.id,
      date,
      answeredOn: today,
      at: new Date().toISOString(),
      responses,
      hints,
      tries: Math.min(XP_RULES.maxTries, Math.max(1, tries)),
      result: { correct: graded.correct, total: graded.total, status: graded.status },
      meta: attemptMeta(question, found.core, found.boss, found.practice),
    });
    /** Whether this check ends the question: a reveal, a full solve, the last try, or told to. */
    const ends = (tries: number) => reveal || body.final === true || graded.status === 'solved' || tries >= XP_RULES.maxTries;

    let saved: Attempt | null;
    let tries: number;
    const userId = await getAuthenticatedWorkoutUserId();
    if (userId) {
      ({ saved, tries } = await updateUserDaily(userId, (data) => {
        // Already finished (another tab, a double tap): that answer stands.
        const existing = data.attempts.find((a) => a.questionId === question.id);
        if (existing) return { saved: existing, tries: existing.tries ?? 1 };
        data.pending ??= {};
        const used = data.pending[question.id] ?? 0;
        const n = reveal ? Math.max(1, used) : used + 1;
        if (!ends(n)) {
          data.pending[question.id] = n;
          return { saved: null, tries: n };
        }
        delete data.pending[question.id];
        const made = attempt(n);
        data.attempts.push(made);
        return { saved: made, tries: n };
      }));
    } else {
      // Signed out: the browser says how many checks it has used (with `final`, how many the kept answer took).
      tries = reveal || body.final === true ? Math.max(1, claimedTries) : claimedTries + 1;
      saved = ends(tries) ? attempt(tries) : null;
    }

    if (!saved) {
      return NextResponse.json({
        success: true, final: false, tries, triesLeft: XP_RULES.maxTries - tries,
        parts: graded.parts, correct: graded.correct, total: graded.total,
      });
    }
    const result = gradeQuestion(question, saved.responses);
    return NextResponse.json({
      success: true,
      final: true,
      saved: !!userId,
      attempt: saved,
      ...result,
      responses: saved.responses,
      hints: saved.hints,
      tries: saved.tries ?? 1,
      late: saved.answeredOn > saved.date,
      xp: attemptXp(saved, result),
      question: revealedQuestion(question),
    });
  } catch (error) {
    return handleApiError(error, 'Answer failed');
  }
}
