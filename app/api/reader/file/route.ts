import { createReadStream } from 'fs';
import fs from 'fs/promises';
import { Readable } from 'stream';
import { ApiError, handleApiError, requireWorkoutUserId } from '@/lib/workout/api';
import { isId } from '@/lib/reader/items';
import { bookPath, coverPath, findBook } from '@/lib/reader/store';

// A book's file (or with ?cover=1 its cover), for the device to keep. Only ever sent
// to the account that owns it, and always as a download: an HTML "book" must never
// open as a page of this site. The app reads the bytes and shows them in its own frame.
//
// Audio books are the exception: they're streamed straight into the player, which
// asks for them a range of bytes at a time (Safari won't play audio any other way).
// They're only ever our own .m4a files, made on the server, so this is safe.

const PRIVATE = 'no-store, private';

/** The one byte range a player asks for, as [start, end] inclusive, or null for the whole file. */
function byteRange(header: string | null, size: number): [number, number] | null | 'bad' {
  if (!header) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m || (!m[1] && !m[2])) return 'bad';
  let start: number;
  let end: number;
  if (!m[1]) {
    start = Math.max(0, size - Number(m[2]));
    end = size - 1;
  } else {
    start = Number(m[1]);
    end = m[2] ? Math.min(Number(m[2]), size - 1) : size - 1;
  }
  return start <= end && start < size ? [start, end] : 'bad';
}

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

    if (!wantsCover && book.format === 'audio') {
      const range = byteRange(request.headers.get('range'), stat.size);
      if (range === 'bad') return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${stat.size}` } });
      const [start, end] = range ?? [0, stat.size - 1];
      const body = Readable.toWeb(createReadStream(file, { start, end })) as ReadableStream<Uint8Array>;
      return new Response(body, {
        status: range ? 206 : 200,
        headers: {
          'Content-Type': 'audio/mp4',
          'Content-Length': String(end - start + 1),
          'Accept-Ranges': 'bytes',
          ...(range ? { 'Content-Range': `bytes ${start}-${end}/${stat.size}` } : {}),
          'Cache-Control': PRIVATE,
          'X-Content-Type-Options': 'nosniff',
        },
      });
    }

    const body = Readable.toWeb(createReadStream(file)) as ReadableStream<Uint8Array>;
    return new Response(body, {
      headers: {
        'Content-Type': wantsCover ? 'image/jpeg' : 'application/octet-stream',
        'Content-Length': String(stat.size),
        'Content-Disposition': 'attachment',
        'Cache-Control': PRIVATE,
      },
    });
  } catch (error) {
    return handleApiError(error, 'Reader file failed');
  }
}
