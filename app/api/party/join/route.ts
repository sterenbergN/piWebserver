import { NextResponse } from 'next/server';
import { checkRoomSeat, joinRoom } from '@/lib/party/engine';

export async function GET(request: Request) {
  const url = new URL(request.url);
  const roomCode = url.searchParams.get('roomCode');
  const playerKey = url.searchParams.get('playerId');
  const audience = url.searchParams.get('audience') === 'true';
  const hostId = url.searchParams.get('hostId');
  const { valid } = await checkRoomSeat(roomCode, { playerKey, audience, hostId });
  return NextResponse.json({ valid });
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => null);
    const result = await joinRoom(body?.roomCode, body?.playerName, { asAudience: body?.asAudience === true, avatar: body?.avatar });
    if ('error' in result) {
      return NextResponse.json({ error: result.error, audienceAvailable: result.audienceAvailable === true }, { status: 400 });
    }
    return NextResponse.json({
      success: true,
      playerId: result.playerId,
      rejoined: result.rejoined === true,
      audience: result.audience === true,
    });
  } catch (error) {
    console.error('Join room error:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
