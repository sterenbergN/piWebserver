import { NextResponse } from 'next/server';
import { ApiError, handleApiError, readJsonObject, requireWorkoutUserId } from '@/lib/workout/api';
import { isAdminAuthenticated } from '@/lib/security/server-auth';
import { DEVICE_PLAYER, fromLegacy, normalizeRound } from '@/lib/golf/round';
import { markLegacyImported, readLegacyRounds, updateRound } from '@/lib/golf/store';
import type { Round } from '@/lib/golf/types';

const MAX_ROUNDS = 500;

/**
 * Bring rounds into your account:
 * - `source: 'device'`: rounds kept on this phone while signed out (`rounds`, new format)
 *   and rounds from the old Tools scorecard (`legacy`). `me` is the player who is you.
 * - `source: 'server'`: the old scorecard's rounds saved on the Pi (site admin only, once).
 */
export async function POST(request: Request) {
  try {
    const userId = await requireWorkoutUserId();
    const body = await readJsonObject(request);
    const me = typeof body.me === 'string' ? body.me.trim().slice(0, 40) : null;
    const rounds: Round[] = [];

    if (body.source === 'server') {
      if (!(await isAdminAuthenticated())) throw new ApiError(403, 'Only the site admin can bring these over');
      const games = await readLegacyRounds();
      if (!games) throw new ApiError(404, 'Nothing left to bring over');
      for (const g of games.slice(0, MAX_ROUNDS)) {
        const r = fromLegacy(g, userId, me);
        if (r) rounds.push(r);
      }
    } else {
      const legacy = Array.isArray(body.legacy) ? body.legacy.slice(0, MAX_ROUNDS) : [];
      for (const g of legacy) {
        const r = fromLegacy(g, userId, me);
        if (r) rounds.push(r);
      }
      const device = Array.isArray(body.rounds) ? body.rounds.slice(0, MAX_ROUNDS) : [];
      for (const raw of device) {
        const r = normalizeRound(raw);
        if (!r) continue;
        r.scorerId = userId;
        // Signed out, your player is marked 'device'.
        const mine = r.players.find((p) => p.userId === DEVICE_PLAYER) || r.players.find((p) => p.name === me) || r.players[0];
        for (const p of r.players) delete p.userId;
        mine.userId = userId;
        rounds.push(r);
      }
    }

    let added = 0;
    for (const round of rounds) {
      // Importing twice adds nothing: a round already saved under that id stays as it is.
      const created = await updateRound(round.id, (existing) => (existing ? { result: false } : { round, result: true }));
      if (created) added++;
    }
    if (body.source === 'server') await markLegacyImported(userId);
    return NextResponse.json({ success: true, added, skipped: rounds.length - added });
  } catch (error) {
    return handleApiError(error, 'Import golf rounds');
  }
}
