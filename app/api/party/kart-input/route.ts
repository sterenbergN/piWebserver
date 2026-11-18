import { NextResponse } from 'next/server';
import { getGameState, normalizeRoomCode, resolvePlayerKey } from '@/lib/party/engine';
import { getKartSimulation, isKartPlayerRevoked, updateKartInput } from '@/lib/party/kart-physics';

interface CachedKeyEntry {
  playerId: string;
  raceId: string;
  verifiedAt: number;
}

const KEY_CACHE_TTL_MS = 2000;
const keyCache = new Map<string, CachedKeyEntry>();

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Invalid body' }, { status: 400 });
    }

    const code = normalizeRoomCode(body.roomCode);
    const actorKey =
      typeof body.playerId === 'string' && body.playerId
        ? body.playerId
        : typeof body.playerKey === 'string' && body.playerKey
          ? body.playerKey
          : '';
    const input = body.input && typeof body.input === 'object' ? body.input : body;

    if (!code || !actorKey) {
      return NextResponse.json({ error: 'Missing parameters' }, { status: 400 });
    }

    const sim = getKartSimulation(code);
    if (!sim) {
      return NextResponse.json({ ok: false, reason: 'not_racing' });
    }

    const now = Date.now();
    const cacheKey = `${code}:${actorKey}`;
    const cached = keyCache.get(cacheKey);
    let resolvedId: string | null = null;

    if (cached && cached.raceId === sim.raceId) {
      if (isKartPlayerRevoked(code, cached.playerId)) {
        keyCache.delete(cacheKey);
        return NextResponse.json({ error: 'Player not found' }, { status: 403 });
      }
      if (now - cached.verifiedAt <= KEY_CACHE_TTL_MS) {
        resolvedId = cached.playerId;
      }
    } else if (cached) {
      keyCache.delete(cacheKey);
    }

    if (!resolvedId) {
      // The secret player key only: public ids are visible to everyone and must not drive a kart
      const state = await getGameState(code);
      const candidateId = state ? resolvePlayerKey(state, actorKey) : null;
      const validPlayer = Boolean(
        candidateId &&
        state?.players?.[candidateId] &&
        !state.players[candidateId].left &&
        !isKartPlayerRevoked(code, candidateId),
      );
      if (validPlayer && candidateId) {
        resolvedId = candidateId;
        if (keyCache.size > 500) keyCache.clear();
        keyCache.set(cacheKey, { playerId: resolvedId, raceId: sim.raceId, verifiedAt: now });
      } else {
        keyCache.delete(cacheKey);
      }
    }

    if (!resolvedId) {
      return NextResponse.json({ error: 'Player not found' }, { status: 403 });
    }

    const updated = updateKartInput(code, resolvedId, input);
    if (!updated && isKartPlayerRevoked(code, resolvedId)) {
      keyCache.delete(cacheKey);
      return NextResponse.json({ error: 'Player not found' }, { status: 403 });
    }
    return NextResponse.json({ ok: updated });
  } catch {
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
