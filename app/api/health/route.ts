import fs from 'fs/promises';
import path from 'path';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

/** Liveness check for the deploy script: which build is running and since when. */
export async function GET() {
  const info = await fs.readFile(path.join(process.cwd(), 'build-info.json'), 'utf-8')
    .then((t) => JSON.parse(t)).catch(() => ({ id: 'dev' }));
  return NextResponse.json({ ok: true, build: info.id, sha: info.sha, builtAt: info.builtAt, uptime: Math.round(process.uptime()) });
}
