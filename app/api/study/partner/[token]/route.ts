import { NextResponse } from 'next/server';
import { clampToday } from '@/lib/daily/store';
import { ApiError, handleApiError, readJsonObject } from '@/lib/workout/api';
import { recordGameAnswer } from '@/lib/study/games';
import { isToken, markQuestion, partnerCaseView, partnerQuizView, setTicked, type PartnerSession } from '@/lib/study/partner';
import { recordCaseRun } from '@/lib/study/practice';
import { noteStudied, readPractice, readSession, readTests, updatePractice, updateProgress, updateSession } from '@/lib/study/store';

// The one study route that needs no account: the private link is the key. It only
// ever answers about that one sitting, and only until it's over or a day has passed.

const PRIVATE = { 'Cache-Control': 'no-store, private' };
const GONE = 'This link has ended. Ask for a new one.';

async function open(params: Promise<{ token: string }>) {
  const { token } = await params;
  if (!isToken(token)) throw new ApiError(404, GONE);
  const session = await readSession(token);
  if (!session) throw new ApiError(404, GONE);
  return session;
}

async function view(session: PartnerSession) {
  if (session.kind === 'quiz') {
    const tests = await readTests(session.ownerId);
    const id = session.questionIds[session.index];
    const question = tests.tests.flatMap((t) => t.questions).find((q) => q.id === id) ?? null;
    return partnerQuizView(session, question);
  }
  const item = (await readPractice(session.ownerId)).cases.find((c) => c.id === session.caseId);
  if (!item) throw new ApiError(404, GONE);
  return partnerCaseView(session, item);
}

export async function GET(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  try {
    const session = await open(params);
    return NextResponse.json({ success: true, view: await view(session) }, { headers: PRIVATE });
  } catch (error) {
    return handleApiError(error, 'Load link failed');
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await params;
    const opened = await open(params);
    const body = await readJsonObject(request);
    const today = clampToday(body.today);
    const now = new Date();

    switch (body.action) {
      case 'mark': {
        const marked = await updateSession(token, (session) => markQuestion(session, body.index, body.right, now));
        if (marked && marked.verdict !== null) {
          const tests = await readTests(opened.ownerId);
          const test = tests.tests.find((t) => t.questions.some((q) => q.id === marked.id));
          const question = test?.questions.find((q) => q.id === marked.id);
          if (test && question) {
            await updateProgress(opened.ownerId, (progress) => ({ right: recordGameAnswer(progress, question, test.id, marked.verdict ? question.correct : [], today, now.toISOString()) }));
          }
        }
        const fresh = await open(params);
        if (marked && fresh.finishedAt) await noteStudied(opened.ownerId, today);
        return NextResponse.json({ success: true, view: await view(fresh) }, { headers: PRIVATE });
      }
      case 'start-clock':
        await updateSession(token, (session) => { session.startedAt ??= now.toISOString(); });
        return NextResponse.json({ success: true, view: await view(await open(params)) }, { headers: PRIVATE });
      case 'tick': {
        const item = (await readPractice(opened.ownerId)).cases.find((c) => c.id === opened.caseId);
        if (!item) throw new ApiError(404, GONE);
        await updateSession(token, (session) => setTicked(session, body.ticked, item.checklist.length));
        return NextResponse.json({ success: true }, { headers: PRIVATE });
      }
      case 'finish': {
        // Claimed first, so a double tap can't save the run twice.
        const claimed = await updateSession(token, (session) => {
          if (session.kind !== 'patient' || session.finishedAt) return { first: false };
          session.finishedAt = now.toISOString();
          return { first: true };
        });
        if (!claimed?.first) return NextResponse.json({ success: true, view: await view(await open(params)) }, { headers: PRIVATE });
        const seconds = opened.startedAt ? (now.getTime() - new Date(opened.startedAt).getTime()) / 1000 : 0;
        const run = await updatePractice(opened.ownerId, (data) => {
          const item = data.cases.find((c) => c.id === opened.caseId);
          if (!item) throw new ApiError(404, GONE);
          return recordCaseRun(item, body.ticked ?? opened.ticked, seconds, today);
        });
        await updateSession(token, (session) => { session.run = run; });
        await noteStudied(opened.ownerId, today);
        return NextResponse.json({ success: true, view: await view(await open(params)) }, { headers: PRIVATE });
      }
      default:
        throw new ApiError(400, 'Unknown action');
    }
  } catch (error) {
    return handleApiError(error, 'Link failed');
  }
}
