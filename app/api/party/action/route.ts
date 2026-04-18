import { NextResponse } from 'next/server';
import { processAction } from '@/lib/party/engine';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { roomCode, playerId, action } = body;
    
    if (!roomCode || !playerId || !action) {
      return NextResponse.json({ error: 'Missing roomCode, playerId, or action' }, { status: 400 });
    }

    const result = await processAction(roomCode, playerId, action);
    
    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }
    
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Action error:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
