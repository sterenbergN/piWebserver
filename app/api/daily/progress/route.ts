import { NextResponse } from 'next/server';
import { ApiError, handleApiError, readJsonObject, requireWorkoutUserId } from '@/lib/workout/api';
import { isDateKey } from '@/lib/habits/dates';
import { gradeQuestion, parseResponses } from '@/lib/daily/grade';
import { XP_RULES, attemptMeta, questionStats, scoreAll, type Attempt } from '@/lib/daily/progress';
import { clampToday, questionIndex, readUserDaily, updateUserDaily } from '@/lib/daily/store';

// Your question history and stats (signed in). POST changes leaderboard
// opt-in, or brings in answers made on this device before signing in.

export async function GET(request: Request) {
  try {
    const userId = await requireWorkoutUserId();
    const today = clampToday(new URL(request.url).searchParams.get('today'));
    const [{ attempts, leaderboard }, index] = await Promise.all([readUserDaily(userId), questionIndex()]);
    const scored = scoreAll(attempts, new Map([...index].map(([id, at]) => [id, at.question])));
    const history = scored
      .sort((a, b) => b.date.localeCompare(a.date) || Number(b.meta.core) - Number(a.meta.core))
      .map(({ responses, ...rest }) => rest);
    return NextResponse.json({ success: true, today, leaderboard: !!leaderboard, stats: questionStats(scored, today), history }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return handleApiError(error, 'Load question progress failed');
  }
}

export async function POST(request: Request) {
  try {
    const userId = await requireWorkoutUserId();
    const body = await readJsonObject(request);
    const today = clampToday(body.today);

    if (body.action === 'leaderboard') {
      await updateUserDaily(userId, (data) => { data.leaderboard = body.on === true; });
      return NextResponse.json({ success: true, leaderboard: body.on === true });
    }

    if (body.action === 'import') {
      if (!Array.isArray(body.attempts) || body.attempts.length > 2000) throw new ApiError(400, 'Nothing to import');
      const index = await questionIndex();
      const added = await updateUserDaily(userId, (data) => {
        const have = new Set(data.attempts.map((a) => a.questionId));
        let count = 0;
        for (const raw of body.attempts) {
          const at = index.get(raw?.questionId);
          if (!at || have.has(at.question.id)) continue;
          // Graded again here: only the answers themselves are taken from the browser.
          const answeredOn = isDateKey(raw.answeredOn) && raw.answeredOn >= at.date && raw.answeredOn <= today ? raw.answeredOn : today;
          const responses = raw.responses === null ? null : parseResponses(at.question, raw.responses);
          if (responses && !Object.keys(responses).length) continue;
          const result = gradeQuestion(at.question, responses);
          const attempt: Attempt = {
            questionId: at.question.id,
            date: at.date,
            answeredOn,
            at: typeof raw.at === 'string' && !Number.isNaN(Date.parse(raw.at)) ? raw.at : new Date().toISOString(),
            responses,
            hints: Math.min(at.question.hints?.length ?? 0, Math.max(0, Math.round(Number(raw.hints) || 0))),
            tries: Math.min(XP_RULES.maxTries, Math.max(1, Math.round(Number(raw.tries) || 1))),
            result: { correct: result.correct, total: result.total, status: result.status },
            meta: attemptMeta(at.question, at.core, at.boss),
          };
          data.attempts.push(attempt);
          have.add(attempt.questionId);
          count++;
        }
        return count;
      });
      return NextResponse.json({ success: true, added });
    }

    throw new ApiError(400, 'Unknown action');
  } catch (error) {
    return handleApiError(error, 'Update question progress failed');
  }
}
