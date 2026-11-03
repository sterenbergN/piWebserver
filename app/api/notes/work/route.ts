import { NextResponse } from 'next/server';
import { ApiError, handleApiError, requireWorkoutUserId } from '@/lib/workout/api';
import { isId } from '@/lib/notes/items';
import { pageForQuestion } from '@/lib/notes/work';

// For the daily questions: make the Notes page to work a question out on, ready on every device,
// without opening Notes here. Answers with the page, new or already there.

export async function POST(request: Request) {
  try {
    const userId = await requireWorkoutUserId();
    const body = await request.json().catch(() => ({})) as { question?: unknown; date?: unknown };
    if (!isId(body.question)) throw new ApiError(400, 'Which question?');
    // A practice question has no day of its own: it's tied to the day you worked it.
    const date = typeof body.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.date) ? body.date : new Date().toISOString().slice(0, 10);
    const page = await pageForQuestion(userId, body.question, date);
    if (!page) throw new ApiError(404, 'That question couldn’t be found.');
    return NextResponse.json({ success: true, page }, { headers: { 'Cache-Control': 'no-store, private' } });
  } catch (error) {
    return handleApiError(error, 'Notes page for a question failed');
  }
}
