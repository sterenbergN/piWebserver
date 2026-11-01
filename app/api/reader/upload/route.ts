import crypto from 'crypto';
import { NextResponse } from 'next/server';
import { ApiError, handleApiError, requireWorkoutUserId } from '@/lib/workout/api';
import { cleanTitle, formatFromName, isId, matchesFormat, titleFromName, UPLOAD_CHUNK_BYTES, type BookMeta } from '@/lib/reader/items';
import { addBook, appendUpload, coverFrom, discardUpload, readUploadHead, UploadRefused } from '@/lib/reader/store';

// Adding a book, in two steps. The file's pieces arrive as raw bytes at
// ?upload=<id>&offset=<n>, then a JSON request with no ?offset names it and files it.

const PRIVATE = { 'Cache-Control': 'no-store, private' };
/** A little over one piece, so a client can't keep a single request open forever writing. */
const MAX_PIECE_BYTES = UPLOAD_CHUNK_BYTES + 1024 * 1024;

export async function POST(request: Request) {
  try {
    const userId = await requireWorkoutUserId();
    const params = new URL(request.url).searchParams;
    const uploadId = params.get('upload');
    if (!isId(uploadId)) throw new ApiError(400, 'Which upload?');

    const offsetParam = params.get('offset');
    if (offsetParam !== null) {
      const offset = Number(offsetParam);
      if (!Number.isSafeInteger(offset) || offset < 0 || !request.body) throw new ApiError(400, 'Bad upload piece.');
      if (Number(request.headers.get('content-length') ?? 0) > MAX_PIECE_BYTES) throw new ApiError(413, 'That piece is too big.');
      const received = await appendUpload(userId, uploadId, offset, request.body);
      return NextResponse.json({ success: true, received }, { headers: PRIVATE });
    }

    const body = await request.json().catch(() => null) as Record<string, unknown> | null;
    const fileName = typeof body?.fileName === 'string' ? body.fileName.slice(0, 300) : '';
    const format = formatFromName(fileName);
    if (!format) throw new ApiError(400, 'Books can be EPUB, PDF, CBZ, TXT, Markdown or HTML.');
    const upload = await readUploadHead(userId, uploadId);
    if (!upload) throw new ApiError(400, 'That upload isn’t here any more. Try adding the book again.');
    if (!upload.size || !matchesFormat(format, upload.head)) {
      await discardUpload(userId, uploadId);
      throw new ApiError(400, `That file doesn’t look like a ${format.toUpperCase()}.`);
    }

    const cover = coverFrom(body?.cover);
    const book: BookMeta = {
      id: crypto.randomBytes(9).toString('base64url'),
      title: cleanTitle(body?.title, titleFromName(fileName)),
      author: cleanTitle(body?.author, ''),
      format,
      size: upload.size,
      addedAt: new Date().toISOString(),
      hasCover: !!cover,
      ...(isId(body?.folder) ? { folder: body.folder } : {}),
    };
    await addBook(userId, uploadId, book, cover);
    return NextResponse.json({ success: true, book }, { headers: PRIVATE });
  } catch (error) {
    if (error instanceof UploadRefused) return NextResponse.json({ success: false, message: error.message }, { status: 413 });
    return handleApiError(error, 'Reader upload failed');
  }
}
