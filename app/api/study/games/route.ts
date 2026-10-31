import { NextResponse } from 'next/server';
import { ApiError, handleApiError, readJsonObject, requireWorkoutUserId } from '@/lib/workout/api';
import { clampToday } from '@/lib/daily/store';
import { createRoom, setStudyDeck } from '@/lib/party/engine';
import { ankiQuestions, emptyGameStats, gamePool, MIN_TRIVIA_QUESTIONS, rankFor, recordGameAnswer, recordRun, triviaDeck, weakestSystem } from '@/lib/study/games';
import { eatGame } from '@/lib/study/plan';
import { afterStudying, readAnki, readProgress, readTests, updatePlan, updateProgress } from '@/lib/study/store';
import { cleanAnswer } from '@/lib/study/study';

// The study games. Questions go only to their own account, or into a room that
// account chose to host. An answer for a question this account doesn't have is
// ignored, which is what lets every phone in a party room send its answers here:
// only the owner's get saved.

const PRIVATE = { 'Cache-Control': 'no-store, private' };
const TRIVIA_SECONDS = [30, 45, 60, 90];

/** `?options=1` what she can play with; otherwise the questions for a run, narrowed by class, system or misses. */
export async function GET(request: Request) {
  try {
    const userId = await requireWorkoutUserId();
    const params = new URL(request.url).searchParams;
    const today = clampToday(params.get('today'));
    const [tests, progress] = await Promise.all([readTests(userId), readProgress(userId)]);

    if (params.get('options') !== null) {
      const all = gamePool(tests, progress, {}, today);
      const systems = [...new Set(all.flatMap((q) => (q.system ? [q.system] : [])))].sort();
      const anki = await readAnki(userId);
      const stats = progress.games ?? emptyGameStats();
      return NextResponse.json({
        success: true,
        total: all.length,
        misses: all.filter((q) => q.priority > 1).length,
        courses: [...new Set(tests.tests.map((t) => t.course).filter(Boolean))].sort(),
        systems,
        ankiCards: ankiQuestions(anki).length,
        stats,
        rank: rankFor(stats.best),
      }, { headers: PRIVATE });
    }

    const filter = { course: params.get('course') ?? '', system: params.get('system') ?? '', missesOnly: params.get('misses') === '1' };
    const pool = gamePool(tests, progress, filter, today);
    const anki = params.get('anki') === '1' ? ankiQuestions(await readAnki(userId)) : [];
    return NextResponse.json({ success: true, questions: [...pool, ...anki], bossSystem: weakestSystem(pool, tests, progress) }, { headers: PRIVATE });
  } catch (error) {
    return handleApiError(error, 'Load games failed');
  }
}

export async function POST(request: Request) {
  try {
    const userId = await requireWorkoutUserId();
    const body = await readJsonObject(request);
    const today = clampToday(body.today);

    switch (body.action) {
      case 'answer': {
        const tests = await readTests(userId);
        const test = tests.tests.find((t) => t.questions.some((q) => q.id === body.questionId));
        const question = test?.questions.find((q) => q.id === body.questionId);
        if (!test || !question) return NextResponse.json({ success: true, saved: false }, { headers: PRIVATE });
        const right = await updateProgress(userId, (progress) => ({ right: recordGameAnswer(progress, question, test.id, cleanAnswer(question, body.answer), today, new Date().toISOString()) }));
        await afterStudying(userId, today);
        return NextResponse.json({ success: true, saved: true, right: right.right }, { headers: PRIVATE });
      }
      case 'run-end': {
        const result = await updateProgress(userId, (progress) => recordRun(progress, body, today));
        const eaten = await updatePlan(userId, (plan) => ({ count: eatGame(plan, today) }));
        await afterStudying(userId, today);
        return NextResponse.json({ success: true, ...result, rank: rankFor(result.stats.best), eaten: eaten.count }, { headers: PRIVATE });
      }
      case 'host-trivia': {
        const [tests, progress] = await Promise.all([readTests(userId), readProgress(userId)]);
        const pool = gamePool(tests, progress, { course: body.course, system: body.system, missesOnly: body.missesOnly === true }, today);
        const deck = triviaDeck(pool);
        const different = new Set(deck.map((c) => c.studyId)).size;
        if (different < MIN_TRIVIA_QUESTIONS) {
          throw new ApiError(400, `A game needs at least ${MIN_TRIVIA_QUESTIONS} questions with one right answer, and that selection has ${different}. Pick something wider, or add a test.`);
        }
        const seconds = TRIVIA_SECONDS.includes(Number(body.seconds)) ? Number(body.seconds) : 45;
        const { roomCode, hostId } = await createRoom('trivia-death', { phonesOnly: body.mode === 'phones' });
        await setStudyDeck(roomCode, deck, { count: different, seconds });
        return NextResponse.json({ success: true, roomCode, hostId }, { headers: PRIVATE });
      }
      default:
        throw new ApiError(400, 'Unknown action');
    }
  } catch (error) {
    return handleApiError(error, 'Study game failed');
  }
}
