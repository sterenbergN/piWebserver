import { randomBytes, randomUUID } from 'crypto';
import { NextResponse } from 'next/server';
import { clampToday } from '@/lib/daily/store';
import { ApiError, handleApiError, readJsonObject, requireWorkoutUserId } from '@/lib/workout/api';
import { gamePool } from '@/lib/study/games';
import { newSession, ownerView, quizPick, QUIZ_SIZES, type PartnerSession } from '@/lib/study/partner';
import {
  addCases, addGrids, addPuzzles, caseForHer, diffOptions, diffStats, editCase, editGrid, editPuzzle, finishPuzzle, gridSummary, nextPuzzle, parseCaseReply, parseDiffReply, parseGridReply, recordGrid, todaysPuzzle, type DiffCase, type PracticeData,
} from '@/lib/study/practice';
import { endSessionsOf, liveSessionOf, noteStudied, readPractice, readProgress, readTests, updatePractice, writeNewSession } from '@/lib/study/store';
import { StudyInputError } from '@/lib/study/study';

// Grids, mock patient cases, Differential, and opening a private link for someone
// to quiz her. Patient cases come back without their script or diagnosis, so her
// own screen can't spoil them.

const PRIVATE = { 'Cache-Control': 'no-store, private' };
const makeId = () => randomUUID().slice(0, 12);
const json = (body: Record<string, unknown>) => NextResponse.json({ success: true, ...body }, { headers: PRIVATE });

const puzzleView = (puzzle: DiffCase) => ({ ...puzzle, options: diffOptions(puzzle) });

function differential(data: PracticeData, today: string, another: boolean) {
  const current = another ? nextPuzzle(data) : todaysPuzzle(data, today);
  return {
    puzzle: current ? puzzleView(current.puzzle) : null,
    play: current?.play ?? null,
    stats: diffStats(data, today),
    used: [...new Set(data.puzzles.map((p) => p.answer))],
  };
}

async function sessionView(session: PartnerSession) {
  if (session.kind === 'patient') {
    const item = (await readPractice(session.ownerId)).cases.find((c) => c.id === session.caseId) ?? null;
    return ownerView(session, item, []);
  }
  let stems: string[] = [];
  if (session.finishedAt && session.missedIds.length) {
    const tests = await readTests(session.ownerId);
    const byId = new Map(tests.tests.flatMap((t) => t.questions.map((q) => [q.id, q.stem] as const)));
    stems = session.missedIds.flatMap((id) => byId.get(id) ?? []);
  }
  return ownerView(session, null, stems);
}

export async function GET(request: Request) {
  try {
    const userId = await requireWorkoutUserId();
    const params = new URL(request.url).searchParams;
    const today = clampToday(params.get('today'));

    if (params.get('session') !== null) {
      const session = await liveSessionOf(userId);
      return json({ session: session ? await sessionView(session) : null });
    }
    const data = await readPractice(userId);
    if (params.get('grid')) {
      const grid = data.grids.find((g) => g.id === params.get('grid'));
      if (!grid) throw new ApiError(404, 'That grid isn’t here any more.');
      return json({ grid });
    }
    if (params.get('case')) {
      const item = data.cases.find((c) => c.id === params.get('case'));
      if (!item) throw new ApiError(404, 'That case isn’t here any more.');
      // The whole case, answers and all, only when she's asked to edit it.
      return json({ case: params.get('full') === '1' ? item : caseForHer(item) });
    }
    if (params.get('puzzles') !== null) return json({ puzzles: data.puzzles, plays: data.plays });
    if (params.get('differential') !== null) return json(differential(data, today, params.get('another') === '1'));
    return json({
      grids: data.grids.map(gridSummary),
      cases: data.cases.map(caseForHer),
      courses: [...new Set([...data.grids.map((g) => g.course), ...data.cases.map((c) => c.course)].filter(Boolean))].sort(),
    });
  } catch (error) {
    return handleApiError(error, 'Load practice failed');
  }
}

export async function POST(request: Request) {
  try {
    const userId = await requireWorkoutUserId();
    const body = await readJsonObject(request);
    const today = clampToday(body.today);
    const now = new Date();
    const stamp = now.toISOString();

    switch (body.action) {
      case 'add-grids': {
        const { items, problems } = parseGridReply(body.text);
        const made = await updatePractice(userId, (data) => addGrids(data, items, makeId, stamp));
        return json({ id: made[0].id, added: made.length, problems });
      }
      case 'add-cases': {
        const { items, problems } = parseCaseReply(body.text);
        const made = await updatePractice(userId, (data) => addCases(data, items, makeId, stamp));
        return json({ added: made.length, problems });
      }
      case 'add-puzzles': {
        const { items, problems } = parseDiffReply(body.text);
        const made = await updatePractice(userId, (data) => addPuzzles(data, items, makeId, stamp));
        return json({ added: made.length, problems });
      }
      case 'delete-grid':
        await updatePractice(userId, (data) => { data.grids = data.grids.filter((g) => g.id !== body.id); });
        return json({});
      case 'delete-case':
        await updatePractice(userId, (data) => { data.cases = data.cases.filter((c) => c.id !== body.id); });
        return json({});
      case 'edit-grid':
        await updatePractice(userId, (data) => {
          const grid = data.grids.find((g) => g.id === body.id);
          if (!grid) throw new ApiError(404, 'That grid isn’t here any more.');
          editGrid(grid, body);
        });
        return json({});
      case 'edit-case': {
        const live = await liveSessionOf(userId);
        if (live && live.caseId === body.id && !live.finishedAt) throw new ApiError(400, 'Someone’s using this case right now. End that sitting first.');
        await updatePractice(userId, (data) => {
          const item = data.cases.find((c) => c.id === body.id);
          if (!item) throw new ApiError(404, 'That case isn’t here any more.');
          editCase(item, body);
        });
        return json({});
      }
      case 'edit-puzzle':
        await updatePractice(userId, (data) => { editPuzzle(data, body.id, body); });
        return json({});
      case 'delete-puzzle':
        await updatePractice(userId, (data) => { data.puzzles = data.puzzles.filter((p) => p.id !== body.id); });
        return json({});
      case 'grid-result': {
        const result = await updatePractice(userId, (data) => {
          const grid = data.grids.find((g) => g.id === body.id);
          if (!grid) throw new ApiError(404, 'That grid isn’t here any more.');
          return recordGrid(grid, body.results, today);
        });
        if (result.total) await noteStudied(userId, today);
        return json({ result });
      }
      case 'finish-puzzle': {
        const play = await updatePractice(userId, (data) => finishPuzzle(data, body.id, body, today));
        await noteStudied(userId, today);
        return json({ play, stats: diffStats(await readPractice(userId), today) });
      }
      case 'start-quiz': {
        const [tests, progress] = await Promise.all([readTests(userId), readProgress(userId)]);
        const pool = gamePool(tests, progress, { course: body.course, system: body.system, missesOnly: body.missesOnly === true }, today);
        if (!pool.length) throw new ApiError(400, 'That selection has no questions. Pick something wider.');
        const size = QUIZ_SIZES.includes(Number(body.size)) ? Number(body.size) : QUIZ_SIZES[0];
        const session = newSession({ token: randomBytes(24).toString('base64url'), ownerId: userId, kind: 'quiz', questionIds: quizPick(pool, size) }, now);
        await endSessionsOf(userId, now);
        await writeNewSession(session);
        return json({ session: await sessionView(session) });
      }
      case 'start-patient': {
        const item = (await readPractice(userId)).cases.find((c) => c.id === body.id);
        if (!item) throw new ApiError(404, 'That case isn’t here any more.');
        const session = newSession({ token: randomBytes(24).toString('base64url'), ownerId: userId, kind: 'patient', caseId: item.id }, now);
        await endSessionsOf(userId, now);
        await writeNewSession(session);
        return json({ session: await sessionView(session) });
      }
      case 'end-session':
        await endSessionsOf(userId, now);
        return json({});
      default:
        throw new ApiError(400, 'Unknown action');
    }
  } catch (error) {
    if (error instanceof StudyInputError) return handleApiError(new ApiError(error.kind === 'missing' ? 404 : 400, error.message), 'Practice failed');
    return handleApiError(error, 'Practice failed');
  }
}
