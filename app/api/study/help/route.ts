import fs from 'fs/promises';
import { NextResponse } from 'next/server';
import { readJson, updateJson, writeJsonAtomic } from '@/lib/json-store';
import { ApiError, handleApiError, readJsonObject, requireWorkoutUserId } from '@/lib/workout/api';
import { clampToday } from '@/lib/daily/store';
import { emptyChoresData, normalizeChoresData, type ChoresData } from '@/lib/chores/chores';
import { endHelp, startHelp, type ExamHelp } from '@/lib/chores/exam-help';
import { choresFile, describeHousehold, examHelpFile, findHousehold, type Household } from '@/lib/chores/households';
import { readPlan } from '@/lib/study/store';

// Exam-week help, shared by the household: she turns it on, everyone sees it, and
// anyone can end it. It also ends by itself once the exam has passed, the next
// time someone in the household looks.

const PRIVATE = { 'Cache-Control': 'no-store, private' };

const readHelp = (household: Household) => readJson<ExamHelp | null>(examHelpFile(household.id), null);

function changeChores(household: Household, today: string, mutate: (data: ChoresData) => void) {
  return updateJson<ChoresData, void>(choresFile(household.id), emptyChoresData(), (stored) => {
    const next = normalizeChoresData(stored, today);
    mutate(next);
    Object.assign(stored, next);
  });
}

async function finish(household: Household, help: ExamHelp, today: string) {
  await changeChores(household, today, (data) => endHelp(data, help));
  await fs.rm(examHelpFile(household.id), { force: true });
}

async function answer(userId: string, today: string) {
  const household = await findHousehold(userId);
  if (!household) return NextResponse.json({ success: true, help: null, canAsk: false }, { headers: PRIVATE });
  let help = await readHelp(household);
  if (help && help.until < today) {
    await finish(household, help, today);
    help = null;
  }
  const { members } = await describeHousehold(household, userId);
  const nameOf = (id: string | null) => members.find((m) => m.id === id)?.name ?? 'Someone';
  return NextResponse.json({
    success: true,
    canAsk: members.length > 1,
    help: help && {
      title: help.title,
      until: help.until,
      name: nameOf(help.by),
      mine: help.by === userId,
      moved: help.moved.length,
      movedTo: help.moved[0]?.to ? nameOf(help.moved[0].to) : null,
      movedToMe: help.moved[0]?.to === userId,
    },
  }, { headers: PRIVATE });
}

export async function GET(request: Request) {
  try {
    const userId = await requireWorkoutUserId();
    return await answer(userId, clampToday(new URL(request.url).searchParams.get('today')));
  } catch (error) {
    return handleApiError(error, 'Load exam help failed');
  }
}

export async function POST(request: Request) {
  try {
    const userId = await requireWorkoutUserId();
    const body = await readJsonObject(request);
    const today = clampToday(body.today);
    const household = await findHousehold(userId);
    if (!household) throw new ApiError(400, 'Share a household first, from Chores.');
    const current = await readHelp(household);

    if (body.action === 'end') {
      if (current) await finish(household, current, today);
    } else if (body.action === 'start') {
      if (household.members.length < 2) throw new ApiError(400, 'There’s nobody else in your household yet.');
      const deadline = (await readPlan(userId)).deadlines.find((d) => d.id === body.deadlineId);
      if (!deadline || deadline.dueOn < today) throw new ApiError(404, 'That date isn’t coming up any more.');
      if (current) await finish(household, current, today);
      let help: ExamHelp | null = null;
      await changeChores(household, today, (data) => { help = startHelp(data, userId, household.members, deadline.title, deadline.dueOn); });
      await writeJsonAtomic(examHelpFile(household.id), help);
    } else {
      throw new ApiError(400, 'Unknown action');
    }
    return await answer(userId, today);
  } catch (error) {
    return handleApiError(error, 'Exam help failed');
  }
}
