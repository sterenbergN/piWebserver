import { NextResponse } from 'next/server';
import { createRoom, GAME_TYPES } from '@/lib/party/engine';
import { GAME_INFO } from '@/lib/party/catalog';
import type { GameType } from '@/lib/party/types';

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => null);
    const gameType = body?.gameType as GameType;
    if (!GAME_TYPES.includes(gameType)) {
      return NextResponse.json({ error: 'Unknown game type' }, { status: 400 });
    }
    const phonesOnly = body?.mode === 'phones';
    if (phonesOnly && GAME_INFO[gameType].tvOnly) {
      return NextResponse.json({ error: `${GAME_INFO[gameType].name} needs a TV` }, { status: 400 });
    }
    const { roomCode, hostId } = await createRoom(gameType, { phonesOnly });
    return NextResponse.json({ success: true, roomCode, hostId });
  } catch (error) {
    console.error('Create room error:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
