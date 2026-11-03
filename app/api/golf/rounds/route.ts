import { NextResponse } from 'next/server';
import { ApiError, handleApiError, readJsonObject, requireWorkoutUserId } from '@/lib/workout/api';
import { canAccess, normalizeRound } from '@/lib/golf/round';
import { listRoundSummaries, readRoundsFor, updateRound } from '@/lib/golf/store';

const NO_STORE = { 'Cache-Control': 'no-store' };

/** Your rounds: summaries, or every round in full with ?full=1 (for stats). */
export async function GET(request: Request) {
  try {
    const userId = await requireWorkoutUserId();
    const full = new URL(request.url).searchParams.get('full') === '1';
    return NextResponse.json(
      full ? { success: true, userId, rounds: await readRoundsFor(userId) } : { success: true, userId, summaries: await listRoundSummaries(userId) },
      { headers: NO_STORE },
    );
  } catch (error) {
    return handleApiError(error, 'Golf rounds');
  }
}

/**
 * Start a round. The phone makes the id, so sending the same round twice (a retry
 * after a dropped connection) hands back the one already saved.
 */
export async function POST(request: Request) {
  try {
    const userId = await requireWorkoutUserId();
    const body = await readJsonObject(request);
    const round = normalizeRound(body.round);
    if (!round) throw new ApiError(400, 'That round is missing its players');
    round.scorerId = userId;
    // Only you can be linked to your account here; friends claim their own names with the join code.
    let claimed = false;
    for (const p of round.players) {
      if (p.userId === userId && !claimed) claimed = true;
      else delete p.userId;
    }
    const saved = await updateRound(round.id, (existing) => {
      if (existing) {
        if (!canAccess(existing, userId)) throw new ApiError(409, 'That round id is taken');
        return { result: existing };
      }
      return { round, result: round };
    });
    return NextResponse.json({ success: true, round: saved });
  } catch (error) {
    return handleApiError(error, 'Start golf round');
  }
}
