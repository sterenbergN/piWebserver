import fs from 'fs/promises';
import { createReadStream } from 'fs';
import { Readable } from 'stream';
import type { NextRequest } from 'next/server';
import { writeAccountExport } from '@/lib/account-export';
import { getWorkoutUserIdFromToken } from '@/lib/security/auth';
import { handleApiError, jsonError } from '@/lib/workout/api';
import { findWorkoutUser } from '@/lib/workout/users';

export const dynamic = 'force-dynamic';

/** The signed-in account's own data as a zip. Which account comes only from the signed cookie. */
export async function GET(request: NextRequest) {
  try {
    const userId = getWorkoutUserIdFromToken(request.cookies.get('workout_auth')?.value);
    // A deleted account's cookie still verifies for a while.
    if (!userId || !(await findWorkoutUser(userId))) return jsonError(401, 'Unauthorized');

    const file = await writeAccountExport(userId);
    const { size } = await fs.stat(file);
    // Streamed: private posts' pictures can be bigger than the Pi's memory. Gone once sent or cancelled.
    const stream = createReadStream(file);
    stream.once('close', () => { fs.rm(file, { force: true }).catch(() => {}); });
    const today = new Date().toISOString().slice(0, 10);
    return new Response(Readable.toWeb(stream) as ReadableStream, {
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="my-data-${today}.zip"`,
        'Content-Length': String(size),
        'Cache-Control': 'no-store, private',
      },
    });
  } catch (error) {
    return handleApiError(error, 'Account export failed');
  }
}
