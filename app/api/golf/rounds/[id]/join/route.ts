import { NextResponse } from 'next/server';
import { ApiError, handleApiError, readJsonObject, requireWorkoutUserId } from '@/lib/workout/api';
import { createLimiter } from '@/lib/security/rate-limit';
import { MAX_PLAYERS, newId, playerFor } from '@/lib/golf/round';
import { updateRound } from '@/lib/golf/store';
import { findWorkoutUser } from '@/lib/workout/users';

// Six-character codes are easy to read out, so wrong guesses are limited.
const guesses = createLimiter({ max: 10, windowMs: 10 * 60 * 1000 });

/**
 * Join a friend's round with its code: claim a guest name as yours (`playerId`),
 * or be added as a new player. Your scores then count in your own stats.
 */
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const userId = await requireWorkoutUserId();
    const wait = guesses.retryAfter(userId);
    if (wait) throw new ApiError(429, `Too many tries. Wait ${Math.ceil(wait / 60)} min.`);
    const { id } = await ctx.params;
    const body = await readJsonObject(request);
    const code = String(body.code || '').toUpperCase();
    const user = await findWorkoutUser(userId);
    const round = await updateRound(id, (current) => {
      if (!current || current.joinCode !== code) {
        guesses.hit(userId);
        throw new ApiError(404, 'That code doesn\'t match a round');
      }
      if (playerFor(current, userId)) return { result: current };
      if (body.playerId) {
        const player = current.players.find((p) => p.id === body.playerId);
        if (!player) throw new ApiError(404, 'That player isn\'t in the round');
        if (player.userId) throw new ApiError(409, 'Someone already joined as that player');
        player.userId = userId;
      } else {
        if (current.players.length >= MAX_PLAYERS) throw new ApiError(409, 'The round is full');
        const player = { id: newId(8), name: String(user?.name || user?.username || 'Player').slice(0, 40), userId };
        current.players.push(player);
        current.scores[player.id] = Array(current.pars.length).fill(null);
      }
      current.updatedAt = new Date().toISOString();
      return { round: current, result: current };
    });
    return NextResponse.json({ success: true, round });
  } catch (error) {
    return handleApiError(error, 'Join golf round');
  }
}
