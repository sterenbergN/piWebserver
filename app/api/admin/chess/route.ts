import { NextResponse } from 'next/server';
import { getAllPuzzles, getPoolDetails, puzzlesLeftNear, refillPuzzlePool, solvedByBand } from '@/lib/chess/puzzles';
import { aimOffset } from '@/lib/chess/rating';
import { getSiteTuning } from '@/lib/tuning/site';
import { readChessProgress } from '@/lib/chess/store';
import { isAdminAuthenticated } from '@/lib/security/server-auth';
import { loadUsersData } from '@/lib/workout/users';

// Admin endpoint for inspecting and expanding the server's Lichess puzzle pool.

export const dynamic = 'force-dynamic';

const NO_STORE = { 'Cache-Control': 'no-store, private' };
const unauthorized = () => NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });

/** Everyone who has tried a puzzle: their Elo, how many puzzles are left near it, and how many they've used up in each band. */
async function players() {
  const [{ users }, puzzles, tuning] = await Promise.all([loadUsersData(), getAllPuzzles(), getSiteTuning()]);
  const rows = await Promise.all(users.map(async (u) => {
    const progress = await readChessProgress(u.id).catch(() => null);
    if (!progress || progress.games === 0) return null;
    const offset = aimOffset(progress, tuning.chessAimOffset);
    return { name: u.username, rating: progress.rating, aim: progress.rating - offset, games: progress.games, solved: progress.solved.length, leftNear: puzzlesLeftNear(puzzles, progress, tuning.refill.window, Infinity, tuning.chessAimOffset), solvedByBand: solvedByBand(puzzles, progress.solved) };
  }));
  return rows.filter((r) => r !== null).sort((a, b) => b.games - a.games);
}

export async function GET() {
  if (!(await isAdminAuthenticated())) return unauthorized();
  const [details, list] = await Promise.all([getSiteTuning().then((t) => getPoolDetails(t.refill)), players()]);
  return NextResponse.json({ success: true, ...details, players: list }, { headers: NO_STORE });
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

    const result = await refillPuzzlePool({ count, minRating, maxRating, trigger: 'admin' });
    return NextResponse.json({ success: true, ...result }, { headers: NO_STORE });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to load puzzles from Lichess.';
    return NextResponse.json({ success: false, error: message }, { status: 502, headers: NO_STORE });
  }
}
