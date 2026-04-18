import { NextResponse } from 'next/server';
import { createRoom } from '@/lib/party/engine';
import { GameType } from '@/lib/party/types';

export async function POST(request: Request) {
  try {
    const { gameType } = await request.json() as { gameType: GameType };
    
    if (!gameType) {
      return NextResponse.json({ error: 'Missing gameType' }, { status: 400 });
    }

    const { roomCode, hostId } = await createRoom(gameType);
    
    return NextResponse.json({ success: true, roomCode, hostId });
  } catch (error) {
    console.error('Create room error:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
