import { createReadStream } from 'fs';
import fs from 'fs/promises';
import path from 'path';
import { Readable } from 'stream';
import { readJson } from '@/lib/json-store';
import { ApiError, handleApiError, requireWorkoutUserId } from '@/lib/workout/api';
import { isId, publicLibraryFile } from '@/lib/reader/items';
import { bookPath, coverPath, findBook } from '@/lib/reader/store';

// A book's file (or with ?cover=1 its cover), for the device to keep or to read from.
// A book on an account is only ever sent to that account. Always as a download: an
// HTML "book" must never open as a page of this site. The app reads the bytes and
// shows them in its own frame.
//
// Any part of a file can be asked for (a Range request). That's how an audio book
// plays (Safari won't play audio any other way), and how a big PDF opens straight
// away: the Reader asks for the pages it's showing, not the whole file first.
// Audio is sent as audio, since it's streamed straight into the player; it's only
// ever our own .m4a files, made on the server, so that's safe.
//
// ?public=<address> is a book from the public Library, for someone reading without
// an account. It has to be listed there right now, so this can't reach any other file.

const PRIVATE = 'no-store, private';

/** The one byte range asked for, as [start, end] inclusive, or null for the whole file. */
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

/** A file, or the part of it the request asked for. */
async function sendFile(request: Request, file: string, headers: Record<string, string>) {
  const stat = await fs.stat(file).catch(() => null);
  if (!stat?.isFile()) throw new ApiError(404, 'That file isn’t here any more.');
  const range = byteRange(request.headers.get('range'), stat.size);
  if (range === 'bad') return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${stat.size}` } });
  const [start, end] = range ?? [0, stat.size - 1];
  const body = stat.size ? Readable.toWeb(createReadStream(file, { start, end })) as ReadableStream<Uint8Array> : null;
  return new Response(body, {
    status: range ? 206 : 200,
    headers: {
      'Content-Length': String(stat.size ? end - start + 1 : 0),
      'Accept-Ranges': 'bytes',
      ...(range ? { 'Content-Range': `bytes ${start}-${end}/${stat.size}` } : {}),
      'X-Content-Type-Options': 'nosniff',
      ...headers,
    },
  });
}

const DOWNLOAD = { 'Content-Type': 'application/octet-stream', 'Content-Disposition': 'attachment' };

export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams;

    const publicUrl = params.get('public');
    if (publicUrl !== null) {
      const folder = path.join(process.cwd(), 'public', 'uploads', 'library');
      const name = publicLibraryFile(publicUrl);
      const listed = await readJson<{ url?: unknown }[]>(path.join(folder, 'library.json'), []);
      if (!name || !Array.isArray(listed) || !listed.some((doc) => doc?.url === publicUrl)) throw new ApiError(404, 'That isn’t in the Library any more.');
      return await sendFile(request, path.join(folder, name), { ...DOWNLOAD, 'Cache-Control': 'public, max-age=3600' });
    }

    const userId = await requireWorkoutUserId();
    const bookId = params.get('book');
    if (!isId(bookId)) throw new ApiError(400, 'Which book?');
    const book = await findBook(userId, bookId);
    if (!book) throw new ApiError(404, 'That book isn’t here any more.');

    if (params.get('cover') !== null) return await sendFile(request, coverPath(userId, bookId), { 'Content-Type': 'image/jpeg', 'Content-Disposition': 'attachment', 'Cache-Control': PRIVATE });
    return await sendFile(request, bookPath(userId, book), { ...(book.format === 'audio' ? { 'Content-Type': 'audio/mp4' } : DOWNLOAD), 'Cache-Control': PRIVATE });
  } catch (error) {
    return handleApiError(error, 'Reader file failed');
  }
}
