import { NextResponse } from 'next/server';
import { ApiError, handleApiError, readJsonObject, requireWorkoutUserId } from '@/lib/workout/api';
import { cleanTitle, isId } from '@/lib/reader/items';
import {
  addFolder, coverFrom, fillBookDetails, FolderError, importPublicBook, moveBooks, readLibrary, readProgressFile, removeBook, removeFolder, renameBook, renameFolder, saveProgress, UploadRefused,
} from '@/lib/reader/store';

// The signed-in account's bookshelf. Every request only reads or writes the caller's
// own folder. The answer carries the account's id so a device can keep its offline
// copies apart from anyone else who signs in on it.

const PRIVATE = { 'Cache-Control': 'no-store, private' };

export async function GET() {
  try {
    const userId = await requireWorkoutUserId();
    const [library, progress] = await Promise.all([readLibrary(userId), readProgressFile(userId)]);
    return NextResponse.json({ success: true, userId, books: library.books, folders: library.folders, seqs: library.seqs, progress }, { headers: PRIVATE });
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

    if (body.action === 'folder-add') {
      return NextResponse.json({ success: true, folder: await addFolder(userId, body.name) }, { headers: PRIVATE });
    }
    if (body.action === 'folder-rename') {
      await renameFolder(userId, body.folder, body.name);
      return NextResponse.json({ success: true }, { headers: PRIVATE });
    }
    if (body.action === 'folder-delete') {
      await removeFolder(userId, body.folder);
      return NextResponse.json({ success: true }, { headers: PRIVATE });
    }
    if (body.action === 'move') {
      if (!Array.isArray(body.books) || body.books.length > 2000) throw new ApiError(400, 'Which books?');
      await moveBooks(userId, body.books, body.folder ?? null);
      return NextResponse.json({ success: true }, { headers: PRIVATE });
    }
    if (body.action === 'import') {
      return NextResponse.json({ success: true, ...(await importPublicBook(userId, body.url, body.folder)) }, { headers: PRIVATE });
    }

    if (!isId(body.book)) throw new ApiError(400, 'Which book?');

    if (body.action === 'details') {
      const book = await fillBookDetails(userId, body.book, coverFrom(body.cover), cleanTitle(body.author, ''));
      if (!book) throw new ApiError(404, 'That book isn’t here any more.');
      return NextResponse.json({ success: true, book }, { headers: PRIVATE });
    }

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
    if (error instanceof FolderError) return NextResponse.json({ success: false, message: error.message }, { status: 400 });
    if (error instanceof UploadRefused) return NextResponse.json({ success: false, message: error.message }, { status: 413 });
    return handleApiError(error, 'Reader action failed');
  }
}
