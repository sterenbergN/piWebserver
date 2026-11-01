import { NextResponse } from 'next/server';
import { handleApiError, requireWorkoutUserId } from '@/lib/workout/api';
import { readStudyXp } from '@/lib/study/store';

// Study's share of the site-wide level. Just a number, for the pages that show a level.

export async function GET() {
  try {
    const userId = await requireWorkoutUserId();
    return NextResponse.json({ success: true, xp: await readStudyXp(userId) }, { headers: { 'Cache-Control': 'no-store, private' } });
  } catch (error) {
    return handleApiError(error, 'Load study XP failed');
  }
}
