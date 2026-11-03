import { NextResponse } from 'next/server';
import { ApiError, handleApiError, requireWorkoutUserId } from '@/lib/workout/api';
import { isId } from '@/lib/notes/items';
import { pagesTiedTo } from '@/lib/notes/store';

// For the daily questions: which of your notes pages are tied to them, so a question can link
// straight to the working you did for it. Only ever the caller's own notebooks.

export async function GET(request: Request) {
  try {
    const userId = await requireWorkoutUserId();
    const questions = (new URL(request.url).searchParams.get('questions') ?? '').split(',').filter(isId).slice(0, 40);
    if (!questions.length) throw new ApiError(400, 'Which questions?');
    return NextResponse.json({ success: true, pages: await pagesTiedTo(userId, questions) }, { headers: { 'Cache-Control': 'no-store, private' } });
  } catch (error) {
    return handleApiError(error, 'Notes tied pages failed');
  }
}
