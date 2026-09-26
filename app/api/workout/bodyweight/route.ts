import { NextResponse } from 'next/server';
import { generateId, getWorkoutData, updateWorkoutData } from '@/lib/workout/data';
import { updateUsersData } from '@/lib/workout/users';
import { ApiError, handleApiError, readJsonObject, requireWorkoutUserId } from '@/lib/workout/api';

type BodyweightEntry = { id: string; userId: string; weight: number; date: string };
type BodyweightStore = { entries: BodyweightEntry[] };

const FILE = 'bodyweight.json';
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function userEntries(store: BodyweightStore, userId: string) {
  return (store.entries || [])
    .filter((entry) => entry.userId === userId)
    .sort((a, b) => a.date.localeCompare(b.date));
}

/** Keep the profile weight equal to the most recent log entry. */
async function syncProfileWeight(userId: string, entries: BodyweightEntry[]) {
  const latest = entries[entries.length - 1];
  if (!latest) return;
  await updateUsersData((data) => {
    const user = data.users.find((u) => u.id === userId);
    if (user) user.weight = latest.weight;
  });
}

export async function GET() {
  try {
    const userId = await requireWorkoutUserId();
    const store = await getWorkoutData<BodyweightStore>(FILE, { entries: [] });
    return NextResponse.json({ success: true, entries: userEntries(store, userId) });
  } catch (error) {
    return handleApiError(error, 'Load bodyweight failed');
  }
}

/** Log a weight. One entry per day: logging again the same day replaces it. */
export async function POST(request: Request) {
  try {
    const userId = await requireWorkoutUserId();
    const body = await readJsonObject(request);
    const weight = Number(body.weight);
    if (!Number.isFinite(weight) || weight < 50 || weight > 800) throw new ApiError(400, 'Weight must be between 50 and 800 lbs');
    const date = typeof body.date === 'string' && DATE_RE.test(body.date) ? body.date : new Date().toISOString().slice(0, 10);

    const entries = await updateWorkoutData<BodyweightStore, BodyweightEntry[]>(FILE, { entries: [] }, (store) => {
      if (!Array.isArray(store.entries)) store.entries = [];
      const existing = store.entries.find((entry) => entry.userId === userId && entry.date === date);
      if (existing) existing.weight = Math.round(weight * 10) / 10;
      else store.entries.push({ id: generateId(), userId, weight: Math.round(weight * 10) / 10, date });
      return userEntries(store, userId);
    });
    await syncProfileWeight(userId, entries);
    return NextResponse.json({ success: true, entries });
  } catch (error) {
    return handleApiError(error, 'Log bodyweight failed');
  }
}

export async function DELETE(request: Request) {
  try {
    const userId = await requireWorkoutUserId();
    const id = new URL(request.url).searchParams.get('id');
    if (!id) throw new ApiError(400, 'ID missing');
    const entries = await updateWorkoutData<BodyweightStore, BodyweightEntry[]>(FILE, { entries: [] }, (store) => {
      const entry = (store.entries || []).find((e) => e.id === id);
      if (!entry) throw new ApiError(404, 'Not found');
      if (entry.userId !== userId) throw new ApiError(403, 'Forbidden');
      store.entries = store.entries.filter((e) => e.id !== id);
      return userEntries(store, userId);
    });
    await syncProfileWeight(userId, entries);
    return NextResponse.json({ success: true, entries });
  } catch (error) {
    return handleApiError(error, 'Delete bodyweight failed');
  }
}
