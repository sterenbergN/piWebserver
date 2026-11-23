import { NextResponse } from 'next/server';
import { getPoolInfo, refillPuzzlePool } from '@/lib/chess/puzzles';
import { isAdminAuthenticated } from '@/lib/security/server-auth';

// Admin endpoint for inspecting and expanding the server's Lichess puzzle pool.

export const dynamic = 'force-dynamic';

const NO_STORE = { 'Cache-Control': 'no-store, private' };
const unauthorized = () => NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });

export async function GET() {
  if (!(await isAdminAuthenticated())) return unauthorized();
  const pool = await getPoolInfo();
  return NextResponse.json({ success: true, pool }, { headers: NO_STORE });
}

export async function POST(request: Request) {
  if (!(await isAdminAuthenticated())) return unauthorized();
  try {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const rawCount = typeof body.count === 'number' ? body.count : Number(body.count);
    const count = Number.isFinite(rawCount) ? Math.max(25, Math.min(1000, Math.round(rawCount))) : 250;

    const rawMin = typeof body.minRating === 'number' ? body.minRating : Number(body.minRating);
    const minRating = Number.isFinite(rawMin) ? Math.max(400, Math.min(2600, Math.round(rawMin))) : 600;

    const rawMax = typeof body.maxRating === 'number' ? body.maxRating : Number(body.maxRating);
    const maxRating = Number.isFinite(rawMax) ? Math.max(minRating + 100, Math.min(2800, Math.round(rawMax))) : 2400;

    const result = await refillPuzzlePool({ count, minRating, maxRating });
    return NextResponse.json({ success: true, ...result }, { headers: NO_STORE });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to load puzzles from Lichess.';
    return NextResponse.json({ success: false, error: message }, { status: 502, headers: NO_STORE });
  }
}
