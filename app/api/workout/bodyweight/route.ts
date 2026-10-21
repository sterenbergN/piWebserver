import { NextResponse } from 'next/server';
import { deleteBodyweight, loadBodyweight, logBodyweights } from '@/lib/workout/bodyweight';
import { ApiError, handleApiError, readJsonObject, requireWorkoutUserId } from '@/lib/workout/api';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function GET() {
  try {
    const userId = await requireWorkoutUserId();
    return NextResponse.json({ success: true, entries: await loadBodyweight(userId) });
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
    const entries = await logBodyweights(userId, [{ date, weight }]);
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
    const entries = await deleteBodyweight(userId, id);
    if (!entries) throw new ApiError(404, 'Not found');
    return NextResponse.json({ success: true, entries });
  } catch (error) {
    return handleApiError(error, 'Delete bodyweight failed');
  }
}
