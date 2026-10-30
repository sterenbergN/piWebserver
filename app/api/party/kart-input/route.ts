import { NextResponse } from 'next/server';
import { getGameState, normalizeRoomCode, resolvePlayerKey } from '@/lib/party/engine';
import { getKartSimulation, updateKartInput } from '@/lib/party/kart-physics';

const keyCache = new Map<string, string>();

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

    const cacheKey = `${code}:${actorKey}`;
    let resolvedId: string | null = keyCache.get(cacheKey) || null;
    if (!resolvedId || !sim.karts[resolvedId]) {
      if (sim.karts[actorKey]) {
        resolvedId = actorKey;
      } else {
        const state = await getGameState(code);
        resolvedId = state ? resolvePlayerKey(state, actorKey) : null;
      }
      if (resolvedId) {
        if (keyCache.size > 500) keyCache.clear();
        keyCache.set(cacheKey, resolvedId);
      }
    }

    if (!resolvedId) {
      return NextResponse.json({ error: 'Player not found' }, { status: 403 });
    }

    const updated = updateKartInput(code, resolvedId, input);
    return NextResponse.json({ ok: updated });
  } catch {
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
