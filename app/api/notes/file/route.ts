import { NextResponse } from 'next/server';
import { ApiError, handleApiError, requireWorkoutUserId } from '@/lib/workout/api';
import { isId, UPLOAD_CHUNK_BYTES } from '@/lib/notes/items';
import { appendUpload, finishUpload, NotebookGone, openStoredFile, UploadRefused } from '@/lib/notes/store';

// The PDFs, pictures and recordings that go with a notebook. They go up in pieces as raw bytes
// at ?offset=<n>, then ?done=1 checks and files them. Only ever sent to the account that owns
// them, and always as a download: nothing here must ever open as a page of this site. The app
// reads the bytes and shows them itself.

const PRIVATE = { 'Cache-Control': 'no-store, private' };
/** A little over one piece, so a client can't keep a single request open forever writing. */
const MAX_PIECE_BYTES = UPLOAD_CHUNK_BYTES + 1024 * 1024;

function target(request: Request) {
  const params = new URL(request.url).searchParams;
  const notebook = params.get('notebook');
  const file = params.get('file');
  if (!isId(notebook) || !isId(file)) throw new ApiError(400, 'Which file?');
  return { notebook, file, params };
}

export async function GET(request: Request) {
  try {
    const userId = await requireWorkoutUserId();
    const { notebook, file } = target(request);
    const stored = await openStoredFile(userId, notebook, file);
    if (!stored) throw new ApiError(404, 'That file isn’t here yet.');
    return new Response(stored.stream(), {
      headers: {
        'Content-Type': 'application/octet-stream',
        'Content-Length': String(stored.size),
        'Content-Disposition': 'attachment',
        'Cache-Control': 'no-store, private',
      },
    });
  } catch (error) {
    return handleApiError(error, 'Notes file failed');
  }
}

export async function POST(request: Request) {
  try {
    const userId = await requireWorkoutUserId();
    const { notebook, file, params } = target(request);
    if (params.get('done') !== null) {
      await finishUpload(userId, notebook, file);
      return NextResponse.json({ success: true }, { headers: PRIVATE });
    }
    const offset = Number(params.get('offset'));
    if (!Number.isSafeInteger(offset) || offset < 0 || !request.body) throw new ApiError(400, 'Bad upload piece.');
    if (Number(request.headers.get('content-length') ?? 0) > MAX_PIECE_BYTES) throw new ApiError(413, 'That piece is too big.');
    const received = await appendUpload(userId, notebook, file, offset, request.body);
    return NextResponse.json({ success: true, received }, { headers: PRIVATE });
  } catch (error) {
    if (error instanceof NotebookGone) return NextResponse.json({ success: false, gone: true, message: 'That notebook isn’t here any more.' }, { status: 410 });
    if (error instanceof UploadRefused) return NextResponse.json({ success: false, message: error.message }, { status: 413 });
    return handleApiError(error, 'Notes upload failed');
  }
}
