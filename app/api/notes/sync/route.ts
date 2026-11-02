import { NextResponse } from 'next/server';
import { ApiError, handleApiError, readJsonObject, requireWorkoutUserId } from '@/lib/workout/api';
import { isId, MAX_CHANGES } from '@/lib/notes/items';
import { catchUp, pageChanged } from '@/lib/notes/ink-text';
import { NotebookGone, syncBook, syncInkText, syncLibrary, syncPage } from '@/lib/notes/store';

// A device's changes to the library, a notebook or a page: what it changed goes in, what it
// hasn't seen comes back. `cursor` is how far it had got last time at that level. The `text`
// level only comes back: it's what the server read in the handwriting. Every request only reads
// or writes the caller's own folder, and the answer carries the account's id so a device can
// keep its offline copies apart from anyone else who signs in on it.

const PRIVATE = { 'Cache-Control': 'no-store, private' };

export async function POST(request: Request) {
  try {
    const userId = await requireWorkoutUserId();
    const body = await readJsonObject(request);
    const changes = Array.isArray(body.changes) ? body.changes : [];
    if (changes.length > MAX_CHANGES) throw new ApiError(413, 'Too many changes at once.');
    const cursor = typeof body.cursor === 'number' && body.cursor >= 0 ? body.cursor : 0;
    const now = Date.now();

    if (body.level === 'library') {
      // Handwriting written while the server was off gets read now.
      catchUp(userId);
      return NextResponse.json({ success: true, userId, ...(await syncLibrary(userId, cursor, changes, now)) }, { headers: PRIVATE });
    }
    if (!isId(body.notebook)) throw new ApiError(400, 'Which notebook?');
    if (body.level === 'book') {
      return NextResponse.json({ success: true, ...(await syncBook(userId, body.notebook, cursor, changes, now)) }, { headers: PRIVATE });
    }
    if (body.level === 'page') {
      if (!isId(body.page)) throw new ApiError(400, 'Which page?');
      const { changed, ...out } = await syncPage(userId, body.notebook, body.page, cursor, changes, now);
      if (changed) pageChanged(userId, body.notebook, body.page);
      return NextResponse.json({ success: true, ...out }, { headers: PRIVATE });
    }
    if (body.level === 'text') {
      return NextResponse.json({ success: true, ...(await syncInkText(userId, body.notebook, cursor)) }, { headers: PRIVATE });
    }
    throw new ApiError(400, 'Unknown level');
  } catch (error) {
    if (error instanceof NotebookGone) return NextResponse.json({ success: false, gone: true, message: 'That notebook isn’t here any more.' }, { status: 410 });
    return handleApiError(error, 'Notes sync failed');
  }
}
