import { NextResponse } from 'next/server';
import { readJson, updateJson } from '@/lib/json-store';
import { ApiError, handleApiError, readJsonObject, requireWorkoutUserId } from '@/lib/workout/api';
import { generateId } from '@/lib/workout/data';
import { addDays, isDateKey } from '@/lib/habits/dates';
import { applyChoreAction, ChoreInputError, emptyChoresData, normalizeChoresData, type ChoreAction, type ChoresData } from '@/lib/chores/chores';
import { choresFile, describeHousehold, householdFor } from '@/lib/chores/households';

// Chores for the signed-in account's household (see lib/chores/households.ts).
// Signed-out visitors get a 401 and keep their chores on the device.

function userToday(value: unknown) {
  const serverDay = new Date().toISOString().slice(0, 10);
  return isDateKey(value) && value >= addDays(serverDay, -1) && value <= addDays(serverDay, 1) ? value : serverDay;
}

export async function GET(request: Request) {
  try {
    const userId = await requireWorkoutUserId();
    const today = userToday(new URL(request.url).searchParams.get('today'));
    const household = await householdFor(userId);
    const data = normalizeChoresData(await readJson(choresFile(household.id), emptyChoresData()), today);
    return NextResponse.json({ success: true, data, household: await describeHousehold(household, userId) }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return handleApiError(error, 'Load chores failed');
  }
}

export async function POST(request: Request) {
  try {
    const userId = await requireWorkoutUserId();
    const body = await readJsonObject(request);
    const today = userToday(body.today);
    let action = body.action as ChoreAction;
    if (!action || typeof action !== 'object') throw new ApiError(400, 'Missing change');
    // Whoever is signed in did it, whatever the browser says.
    if (action.type === 'done' || action.type === 'skip' || action.type === 'import') action = { ...action, by: userId };

    const household = await householdFor(userId);
    const data = await updateJson<ChoresData, ChoresData>(choresFile(household.id), emptyChoresData(), (stored) => {
      const next = normalizeChoresData(stored, today);
      try {
        applyChoreAction(next, action, today, generateId);
      } catch (error) {
        if (error instanceof ChoreInputError) throw new ApiError(400, error.message);
        throw error;
      }
      // Assigning to someone outside the household falls back to "anyone".
      for (const chore of next.chores) if (chore.assignee && !household.members.includes(chore.assignee)) chore.assignee = null;
      Object.assign(stored, next);
      return next;
    });
    return NextResponse.json({ success: true, data });
  } catch (error) {
    return handleApiError(error, 'Save chores failed');
  }
}
