import { NextResponse } from 'next/server';
import { getAuthenticatedWorkoutUserId } from '@/lib/security/server-auth';
import { ApiError, handleApiError, readJsonObject, requireWorkoutUserId } from '@/lib/workout/api';
import { emptyMathStats, type MathAnswerRecord } from '@/lib/workout/rest-math-stats';
import { readMathStats, saveMathSprint } from '@/lib/workout/rest-math-store';

// Mental math sprint statistics for the rest panel.
// Signed in: kept per account in .data/workout/math/<userId>.json.
// Signed out: browser keeps stats locally in device prefs.

const PRIVATE = { 'Cache-Control': 'no-store, private' };

export async function GET() {
  try {
    const userId = await getAuthenticatedWorkoutUserId();
    if (!userId) {
      return NextResponse.json(
        { success: true, stats: emptyMathStats(), signedIn: false },
        { headers: PRIVATE },
      );
    }
    return NextResponse.json(
      { success: true, stats: await readMathStats(userId), signedIn: true },
      { headers: PRIVATE },
    );
  } catch (error) {
    return handleApiError(error, 'Load math stats failed');
  }
}

export async function POST(request: Request) {
  try {
    const userId = await requireWorkoutUserId();
    const body = await readJsonObject(request);
    if (typeof body.score !== 'number' || !Number.isFinite(body.score) || body.score < 0) {
      throw new ApiError(400, 'Invalid score');
    }
    if (!Array.isArray(body.answers)) {
      throw new ApiError(400, 'Invalid answers');
    }
    const stats = await saveMathSprint(userId, {
      score: body.score,
      answers: body.answers as MathAnswerRecord[],
      mode: body.mode === 'drill' ? 'drill' : 'sprint',
    });
    return NextResponse.json({ success: true, stats }, { headers: PRIVATE });
  } catch (error) {
    return handleApiError(error, 'Save math stats failed');
  }
}
