import { NextResponse } from 'next/server';
import { PUZZLES, puzzleById } from '@/lib/chess/puzzles';
import { normalizeChessProgress, pickPuzzle } from '@/lib/chess/rating';
import { readChessProgress, saveChessResult } from '@/lib/chess/store';
import { getAuthenticatedWorkoutUserId } from '@/lib/security/server-auth';
import { ApiError, handleApiError, readJsonObject, requireWorkoutUserId } from '@/lib/workout/api';

// Chess puzzles for the rest between sets. GET hands out the next one near your
// puzzle rating; POST records how it went. Signed in, the rating and solved
// list live in .data/workout/chess/<userId>.json. Signed out, the browser keeps
// them and sends its rating and the ids to skip with each GET.

const PRIVATE = { 'Cache-Control': 'no-store, private' };

const idList = (raw: string | null) => (raw ?? '').split(',').map((s) => s.trim()).filter((s) => /^[\w-]{1,16}$/.test(s)).slice(0, 200);

export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams;
    const skip = idList(params.get('skip'));
    const userId = await getAuthenticatedWorkoutUserId();
    const progress = userId
      ? await readChessProgress(userId)
      : normalizeChessProgress({ rating: Number(params.get('rating')) || undefined, solved: idList(params.get('solved')) });
    const puzzle = pickPuzzle(PUZZLES, progress, { exclude: skip });
    if (!puzzle) throw new ApiError(404, 'No puzzles here yet');
    return NextResponse.json(
      { success: true, puzzle, rating: progress.rating, solvedCount: progress.solved.length, signedIn: !!userId },
      { headers: PRIVATE },
    );
  } catch (error) {
    return handleApiError(error, 'Load chess puzzle failed');
  }
}

export async function POST(request: Request) {
  try {
    const userId = await requireWorkoutUserId();
    const body = await readJsonObject(request);
    // The rating comes from the bundled puzzle, never from the request.
    const puzzle = puzzleById(body.puzzleId);
    if (!puzzle) throw new ApiError(400, 'That puzzle isn’t one of ours');
    const { before, after } = await saveChessResult(userId, puzzle, body.clean === true);
    return NextResponse.json(
      { success: true, rating: after.rating, change: after.rating - before, solvedCount: after.solved.length },
      { headers: PRIVATE },
    );
  } catch (error) {
    return handleApiError(error, 'Save chess result failed');
  }
}
