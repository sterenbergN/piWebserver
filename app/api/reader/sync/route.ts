import { NextResponse } from 'next/server';
import { ApiError, handleApiError, readJsonObject, requireWorkoutUserId } from '@/lib/workout/api';
import { isId, MAX_CHANGES } from '@/lib/reader/items';
import { findBook, syncNotes } from '@/lib/reader/store';

// A device's notes and pen marks for one book: what it changed goes in, what it
// hasn't seen comes back. `cursor` is how far it had got last time.

export async function POST(request: Request) {
  try {
    const userId = await requireWorkoutUserId();
    const body = await readJsonObject(request);
    if (!isId(body.book)) throw new ApiError(400, 'Which book?');
    const changes = Array.isArray(body.changes) ? body.changes : [];
    if (changes.length > MAX_CHANGES) throw new ApiError(413, 'Too many changes at once.');
    if (!(await findBook(userId, body.book))) throw new ApiError(404, 'That book isn’t here any more.');
    const cursor = typeof body.cursor === 'number' && body.cursor >= 0 ? body.cursor : 0;
    const { seq, items } = await syncNotes(userId, body.book, cursor, changes, Date.now());
    return NextResponse.json({ success: true, cursor: seq, items }, { headers: { 'Cache-Control': 'no-store, private' } });
  } catch (error) {
    return handleApiError(error, 'Reader sync failed');
  }
}
