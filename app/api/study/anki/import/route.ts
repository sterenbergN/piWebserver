import crypto from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import { NextResponse } from 'next/server';
import { ApiError, handleApiError, requireWorkoutUserId } from '@/lib/workout/api';
import { AnkiFileError, MAX_APKG_BYTES, readApkg } from '@/lib/study/anki-import';
import { studyFolder, writeAnki } from '@/lib/study/store';

// An Anki export, sent as the raw request body and written straight to disk so a
// large one doesn't sit in memory. Only counts and the most-forgotten cards are
// kept, and a new import replaces the last. Backups skip `.tmp` files.

const TOO_BIG = 'That file is too large, which usually means it has media in it. Export again with “Include media” turned off.';

async function saveBody(request: Request, file: string) {
  if (Number(request.headers.get('content-length')) > MAX_APKG_BYTES) throw new ApiError(413, TOO_BIG);
  if (!request.body) throw new ApiError(400, 'Choose a file first.');
  const handle = await fs.open(file, 'w');
  let size = 0;
  try {
    const reader = request.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_APKG_BYTES) {
        await reader.cancel();
        throw new ApiError(413, TOO_BIG);
      }
      await handle.write(value);
    }
  } finally {
    await handle.close();
  }
  if (!size) throw new ApiError(400, 'That file is empty.');
}

export async function POST(request: Request) {
  let upload: string | null = null;
  try {
    const userId = await requireWorkoutUserId();
    const folder = studyFolder(userId);
    await fs.mkdir(folder, { recursive: true });
    upload = path.join(folder, `upload-${crypto.randomBytes(6).toString('hex')}.tmp`);
    await saveBody(request, upload);

    const name = decodeURIComponent(request.headers.get('x-file-name') ?? '').replace(/[^\p{L}\p{N} ._()-]/gu, '').trim() || 'Anki export';
    const data = await readApkg(upload, name, new Date().toISOString());
    await writeAnki(userId, data);
    return NextResponse.json({ success: true, cards: data.groups.reduce((n, g) => n + g.cards, 0), hasHistory: data.hasHistory }, { headers: { 'Cache-Control': 'no-store, private' } });
  } catch (error) {
    if (error instanceof AnkiFileError) return handleApiError(new ApiError(error.kind === 'server' ? 500 : 400, error.message));
    return handleApiError(error, 'Anki import failed');
  } finally {
    if (upload) await fs.rm(upload, { force: true }).catch(() => {});
  }
}
