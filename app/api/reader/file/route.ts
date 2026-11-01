import { createReadStream } from 'fs';
import fs from 'fs/promises';
import { Readable } from 'stream';
import { ApiError, handleApiError, requireWorkoutUserId } from '@/lib/workout/api';
import { isId } from '@/lib/reader/items';
import { bookPath, coverPath, findBook } from '@/lib/reader/store';

// A book's file (or with ?cover=1 its cover), for the device to keep. Only ever sent
// to the account that owns it, and always as a download: an HTML "book" must never
// open as a page of this site. The app reads the bytes and shows them in its own frame.

export async function GET(request: Request) {
  try {
    const userId = await requireWorkoutUserId();
    const params = new URL(request.url).searchParams;
    const bookId = params.get('book');
    if (!isId(bookId)) throw new ApiError(400, 'Which book?');
    const book = await findBook(userId, bookId);
    if (!book) throw new ApiError(404, 'That book isn’t here any more.');

    const wantsCover = params.get('cover') !== null;
    const file = wantsCover ? coverPath(userId, bookId) : bookPath(userId, book);
    const stat = await fs.stat(file).catch(() => null);
    if (!stat) throw new ApiError(404, 'That file isn’t here any more.');

    const body = Readable.toWeb(createReadStream(file)) as ReadableStream<Uint8Array>;
    return new Response(body, {
      headers: {
        'Content-Type': wantsCover ? 'image/jpeg' : 'application/octet-stream',
        'Content-Length': String(stat.size),
        'Content-Disposition': 'attachment',
        'Cache-Control': 'no-store, private',
      },
    });
  } catch (error) {
    return handleApiError(error, 'Reader file failed');
  }
}
