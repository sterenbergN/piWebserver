import { NextResponse } from 'next/server';
import path from 'path';
import { readJson, updateJson } from '@/lib/json-store';
import { ApiError, handleApiError, readJsonObject, requireWorkoutUserId } from '@/lib/workout/api';
import { generateId } from '@/lib/workout/data';
import { addDays, isDateKey } from '@/lib/habits/dates';
import { applyHabitAction, emptyHabitsData, HabitInputError, normalizeHabitsData, type HabitAction, type HabitsData } from '@/lib/habits/habits';

// Habits for the signed-in account, one file per user in .data/habits (kept by
// backups). Signed-out visitors get a 401 and keep their habits on the device.

function habitsFile(userId: string) {
  if (!/^[\w-]{1,64}$/.test(userId)) throw new ApiError(400, 'Invalid account');
  return path.join(process.cwd(), '.data', 'habits', `${userId}.json`);
}

/** The user's local day as their browser reports it, if it's within a day of the server's. */
function userToday(value: unknown) {
  const serverDay = new Date().toISOString().slice(0, 10);
  return isDateKey(value) && value >= addDays(serverDay, -1) && value <= addDays(serverDay, 1) ? value : serverDay;
}

export async function GET(request: Request) {
  try {
    const userId = await requireWorkoutUserId();
    const today = userToday(new URL(request.url).searchParams.get('today'));
    const data = normalizeHabitsData(await readJson(habitsFile(userId), emptyHabitsData()), today);
    return NextResponse.json({ success: true, data }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return handleApiError(error, 'Load habits failed');
  }
}

export async function POST(request: Request) {
  try {
    const userId = await requireWorkoutUserId();
    const body = await readJsonObject(request);
    const today = userToday(body.today);
    const action = body.action as HabitAction;
    if (!action || typeof action !== 'object') throw new ApiError(400, 'Missing change');

    const data = await updateJson<HabitsData, HabitsData>(habitsFile(userId), emptyHabitsData(), (stored) => {
      const next = normalizeHabitsData(stored, today);
      try {
        applyHabitAction(next, action, today, generateId);
      } catch (error) {
        if (error instanceof HabitInputError) throw new ApiError(400, error.message);
        throw error;
      }
      Object.assign(stored, next);
      return next;
    });
    return NextResponse.json({ success: true, data });
  } catch (error) {
    return handleApiError(error, 'Save habits failed');
  }
}
