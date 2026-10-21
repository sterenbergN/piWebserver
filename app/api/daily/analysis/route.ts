import { NextResponse } from 'next/server';
import { getAuthenticatedWorkoutUserId } from '@/lib/security/server-auth';
import { ApiError, handleApiError, readJsonObject } from '@/lib/workout/api';
import { isDateKey } from '@/lib/habits/dates';
import { analyze } from '@/lib/daily/analysis';
import { gradeQuestion, parseResponses } from '@/lib/daily/grade';
import { XP_RULES, attemptMeta, type Attempt } from '@/lib/daily/progress';
import { analysisAttempts, clampToday, findQuestion, readUserDaily } from '@/lib/daily/store';

// Your strengths and weaknesses across every question you've done.
//   GET   signed in: from your saved answers
//   POST  { attempts, today } signed out: answers kept on this device, graded
//         here (nothing is saved)

export async function GET(request: Request) {
  try {
    const userId = await getAuthenticatedWorkoutUserId();
    if (!userId) throw new ApiError(401, 'Sign in, or send the answers kept on this device.');
    const today = clampToday(new URL(request.url).searchParams.get('today'));
    const { attempts } = await readUserDaily(userId);
    return NextResponse.json({ success: true, signedIn: true, analysis: analyze(await analysisAttempts(attempts), today) }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return handleApiError(error, 'Analysis failed');
  }
}

export async function POST(request: Request) {
  try {
    const body = await readJsonObject(request);
    const today = clampToday(body.today);
    if (!Array.isArray(body.attempts) || body.attempts.length > 2000) throw new ApiError(400, 'No answers to look at');
    const attempts: Attempt[] = [];
    for (const raw of body.attempts) {
      const at = await findQuestion(raw?.questionId);
      if (!at) continue;
      // Only the answers come from the browser; grades are worked out here.
      const responses = raw.responses === null ? null : parseResponses(at.question, raw.responses);
      if (responses && !Object.keys(responses).length) continue;
      const result = gradeQuestion(at.question, responses);
      const answeredOn = isDateKey(raw.answeredOn) && raw.answeredOn <= today ? raw.answeredOn : today;
      attempts.push({
        questionId: at.question.id, date: at.date ?? answeredOn, answeredOn,
        at: typeof raw.at === 'string' && !Number.isNaN(Date.parse(raw.at)) ? raw.at : new Date().toISOString(),
        responses, hints: Math.min(at.question.hints?.length ?? 0, Math.max(0, Math.round(Number(raw.hints) || 0))),
        tries: Math.min(XP_RULES.maxTries, Math.max(1, Math.round(Number(raw.tries) || 1))),
        result: { correct: result.correct, total: result.total, status: result.status },
        meta: attemptMeta(at.question, at.core, at.boss, at.practice),
      });
    }
    return NextResponse.json({ success: true, signedIn: false, analysis: analyze(await analysisAttempts(attempts), today) });
  } catch (error) {
    return handleApiError(error, 'Analysis failed');
  }
}
