import { NextResponse } from 'next/server';
import { ApiError, handleApiError, readJsonObject, requireWorkoutUserId } from '@/lib/workout/api';
import { cleanTitle, isId } from '@/lib/reader/items';
import { readLibrary, readProgressFile, removeBook, renameBook, saveProgress } from '@/lib/reader/store';

// The signed-in account's bookshelf. Every request only reads or writes the caller's
// own folder. The answer carries the account's id so a device can keep its offline
// copies apart from anyone else who signs in on it.

const PRIVATE = { 'Cache-Control': 'no-store, private' };

export async function GET() {
  try {
    const userId = await requireWorkoutUserId();
    const [library, progress] = await Promise.all([readLibrary(userId), readProgressFile(userId)]);
    return NextResponse.json({ success: true, userId, books: library.books, seqs: library.seqs, progress }, { headers: PRIVATE });
  } catch (error) {
    return handleApiError(error, 'Load reader library failed');
  }
}

export async function POST(request: Request) {
  try {
    const userId = await requireWorkoutUserId();
    const body = await readJsonObject(request);

    if (body.action === 'progress') {
      if (!Array.isArray(body.entries) || body.entries.length > 500) throw new ApiError(400, 'Nothing to save.');
      await saveProgress(userId, body.entries, Date.now());
      return NextResponse.json({ success: true }, { headers: PRIVATE });
    }

    if (!isId(body.book)) throw new ApiError(400, 'Which book?');

    if (body.action === 'rename') {
      const book = await renameBook(userId, body.book, cleanTitle(body.title, 'Untitled'), cleanTitle(body.author, ''));
      if (!book) throw new ApiError(404, 'That book isn’t here any more.');
      return NextResponse.json({ success: true, book }, { headers: PRIVATE });
    }

    if (body.action === 'delete') {
      await removeBook(userId, body.book);
      return NextResponse.json({ success: true }, { headers: PRIVATE });
    }

    throw new ApiError(400, 'Unknown action');
  } catch (error) {
    return handleApiError(error, 'Reader action failed');
  }
}
