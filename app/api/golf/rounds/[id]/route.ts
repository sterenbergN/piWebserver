import { NextResponse } from 'next/server';
import { ApiError, handleApiError, readJsonObject, requireWorkoutUserId } from '@/lib/workout/api';
import { applyOps, canAccess, cleanOp } from '@/lib/golf/round';
import { readRound, updateRound } from '@/lib/golf/store';
import type { RoundOp } from '@/lib/golf/types';

const NO_STORE = { 'Cache-Control': 'no-store' };
const MAX_OPS = 500;

/**
 * A round you're in. With ?code= (the join code a friend showed you) you can see it
 * before you're in it, to pick which name is you.
 */
export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const userId = await requireWorkoutUserId();
    const { id } = await ctx.params;
    const round = await readRound(id);
    const code = new URL(request.url).searchParams.get('code')?.toUpperCase();
    if (!round || (!canAccess(round, userId) && code !== round.joinCode)) throw new ApiError(404, 'Round not found');
    return NextResponse.json({ success: true, round, member: canAccess(round, userId) }, { headers: NO_STORE });
  } catch (error) {
    return handleApiError(error, 'Golf round');
  }
}

/** Apply changes made on a phone, in order. Older changes than what's saved are skipped. */
export async function PATCH(request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const userId = await requireWorkoutUserId();
    const { id } = await ctx.params;
    const body = await readJsonObject(request);
    if (!Array.isArray(body.ops) || body.ops.length > MAX_OPS) throw new ApiError(400, 'Expected a list of changes');
    const round = await updateRound(id, (current) => {
      if (!current || !canAccess(current, userId)) throw new ApiError(404, 'Round not found');
      const ops = body.ops.map((op: unknown) => cleanOp(op, current)).filter((op: RoundOp | null): op is RoundOp => op !== null);
      if (!ops.length) return { result: current };
      applyOps(current, ops);
      return { round: current, result: current };
    });
    return NextResponse.json({ success: true, round });
  } catch (error) {
    return handleApiError(error, 'Save golf round');
  }
}

/** The scorer deletes the round for everyone; anyone else just leaves it (their name stays as a guest). */
export async function DELETE(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const userId = await requireWorkoutUserId();
    const { id } = await ctx.params;
    const outcome = await updateRound(id, (current) => {
      if (!current || !canAccess(current, userId)) throw new ApiError(404, 'Round not found');
      if (current.scorerId === userId) return { round: null, result: 'deleted' as const };
      for (const p of current.players) if (p.userId === userId) delete p.userId;
      current.updatedAt = new Date().toISOString();
      return { round: current, result: 'left' as const };
    });
    return NextResponse.json({ success: true, outcome });
  } catch (error) {
    return handleApiError(error, 'Delete golf round');
  }
}
