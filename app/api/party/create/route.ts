import { NextResponse } from 'next/server';
import { createRoom, GAME_TYPES } from '@/lib/party/engine';
import type { GameType } from '@/lib/party/types';

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => null);
    const gameType = body?.gameType as GameType;
    if (!GAME_TYPES.includes(gameType)) {
      return NextResponse.json({ error: 'Unknown game type' }, { status: 400 });
    }
    const { roomCode, hostId } = await createRoom(gameType);
    return NextResponse.json({ success: true, roomCode, hostId });
  } catch (error) {
    console.error('Create room error:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
