import crypto from 'crypto';
import { NextResponse } from 'next/server';
import { ApiError, handleApiError, readJsonObject, requireWorkoutUserId } from '@/lib/workout/api';
import { clampToday } from '@/lib/daily/store';
import { afterStudying, readPlan, readProgress, readTests, updateProgress, updateTests } from '@/lib/study/store';
import { findWorkoutUser, updateUsersData } from '@/lib/workout/users';
import {
  addTest, answerReview, cleanAnswer, dueMisses, finishAttempt, fixQuestion, parseTestReply, removeQuestion, removeTest, renameTest,
  saveAttempt, startAttempt, StudyInputError, studyDays, studySummary, withQuestions,
} from '@/lib/study/study';

// The signed-in account's tests and miss bank. Every request reads or writes
// only the caller's own folder; signed out there's nothing to see (401), and
// nothing is kept on the device.

const PRIVATE = { 'Cache-Control': 'no-store, private' };
const newId = () => crypto.randomBytes(9).toString('base64url');
const isId = (value: unknown): value is string => typeof value === 'string' && /^[\w-]{1,64}$/.test(value);

/** `?test=` one test in full, with its attempts; `?review=1` what's due today; otherwise the overview. */
export async function GET(request: Request) {
  try {
    const userId = await requireWorkoutUserId();
    const params = new URL(request.url).searchParams;
    const today = clampToday(params.get('today'));
    const [tests, progress] = await Promise.all([readTests(userId), readProgress(userId)]);

    const testId = params.get('test');
    if (testId !== null) {
      const test = tests.tests.find((t) => t.id === testId);
      if (!test) throw new ApiError(404, 'That test isn’t here any more.');
      return NextResponse.json({ success: true, test, attempts: progress.attempts.filter((a) => a.testId === testId) }, { headers: PRIVATE });
    }
    if (params.get('review') !== null) {
      return NextResponse.json({ success: true, items: withQuestions(tests, dueMisses(progress, today)) }, { headers: PRIVATE });
    }
    const [user, plan] = await Promise.all([findWorkoutUser(userId), readPlan(userId)]);
    const days = [...new Set([...studyDays(progress), ...Object.keys(plan.eatenOn)])];
    return NextResponse.json({ success: true, summary: studySummary(tests, progress, today), studyDays: days, home: user?.studyHome === true }, { headers: PRIVATE });
  } catch (error) {
    return handleApiError(error, 'Load study failed');
  }
}

/** Find a test or say it's gone. */
function testFrom<T extends { id: string }>(list: T[], id: unknown) {
  const test = isId(id) ? list.find((t) => t.id === id) : undefined;
  if (!test) throw new ApiError(404, 'That test isn’t here any more.');
  return test;
}

export async function POST(request: Request) {
  try {
    const userId = await requireWorkoutUserId();
    const body = await readJsonObject(request);
    const today = clampToday(body.today);
    const now = new Date().toISOString();

    switch (body.action) {
      case 'set-home': {
        await updateUsersData((data) => {
          const user = data.users.find((u) => u.id === userId);
          if (!user) throw new ApiError(404, 'Account not found');
          if (body.on === true) user.studyHome = true;
          else delete user.studyHome;
        });
        return NextResponse.json({ success: true }, { headers: PRIVATE });
      }
      case 'add-test': {
        const pack = parseTestReply(body.text);
        const test = await updateTests(userId, (data) => addTest(data, pack, body, newId, now));
        return NextResponse.json({ success: true, id: test.id, count: test.questions.length }, { headers: PRIVATE });
      }
      case 'update-test': {
        await updateTests(userId, (data) => renameTest(testFrom(data.tests, body.testId), body));
        return NextResponse.json({ success: true }, { headers: PRIVATE });
      }
      case 'delete-test': {
        await updateTests(userId, (data) => updateProgress(userId, (progress) => removeTest(data, progress, String(body.testId))));
        return NextResponse.json({ success: true }, { headers: PRIVATE });
      }
      case 'start': {
        const test = testFrom((await readTests(userId)).tests, body.testId);
        const attempt = await updateProgress(userId, (progress) => startAttempt(progress, test, body, newId, crypto.randomInt(2 ** 31), now));
        return NextResponse.json({ success: true, attempt }, { headers: PRIVATE });
      }
      case 'save':
      case 'finish': {
        const tests = await readTests(userId);
        const attempt = await updateProgress(userId, (progress) => {
          const found = progress.attempts.find((a) => a.id === body.attemptId);
          if (!found) throw new ApiError(404, 'That attempt isn’t here any more.');
          const test = testFrom(tests.tests, found.testId);
          // A late save from a closing tab can't change a test already handed in.
          if (!found.finishedAt) saveAttempt(found, test, body);
          if (body.action === 'finish') finishAttempt(progress, found, test, today, now);
          return found;
        });
        if (body.action === 'finish') await afterStudying(userId, today, attempt.testId);
        return NextResponse.json({ success: true, attempt }, { headers: PRIVATE });
      }
      case 'discard': {
        await updateProgress(userId, (progress) => {
          progress.attempts = progress.attempts.filter((a) => a.id !== body.attemptId || a.finishedAt);
        });
        return NextResponse.json({ success: true }, { headers: PRIVATE });
      }
      case 'review': {
        const tests = await readTests(userId);
        const result = await updateProgress(userId, (progress) => {
          const miss = isId(body.questionId) ? progress.misses[body.questionId] : undefined;
          const found = miss ? withQuestions(tests, [miss])[0] : undefined;
          if (!found) throw new ApiError(404, 'That question isn’t waiting for review.');
          return answerReview(progress, found.question, cleanAnswer(found.question, body.answer), today);
        });
        await afterStudying(userId, today);
        return NextResponse.json({ success: true, right: result.right, miss: result.miss }, { headers: PRIVATE });
      }
      case 'fix-question': {
        const question = await updateTests(userId, (data) => updateProgress(userId, (progress) => fixQuestion(testFrom(data.tests, body.testId), progress, String(body.questionId), body, today)));
        return NextResponse.json({ success: true, question }, { headers: PRIVATE });
      }
      case 'remove-question': {
        await updateTests(userId, (data) => updateProgress(userId, (progress) => removeQuestion(testFrom(data.tests, body.testId), progress, String(body.questionId))));
        return NextResponse.json({ success: true }, { headers: PRIVATE });
      }
      default:
        throw new ApiError(400, 'Unknown action');
    }
  } catch (error) {
    if (error instanceof StudyInputError) return handleApiError(new ApiError(error.kind === 'missing' ? 404 : 400, error.message));
    return handleApiError(error, 'Study update failed');
  }
}
