import { NextResponse } from 'next/server';
import { joinRoom } from '@/lib/party/engine';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { roomCode, playerName } = body;
    
    if (!roomCode || !playerName) {
      return NextResponse.json({ error: 'Missing roomCode or playerName' }, { status: 400 });
    }

    const result = await joinRoom(roomCode, playerName);
    
    if ('error' in result) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }
    
    return NextResponse.json({ success: true, playerId: result.playerId });
  } catch (error) {
    console.error('Join room error:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
