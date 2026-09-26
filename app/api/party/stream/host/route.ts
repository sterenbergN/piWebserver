import { getGameState, hostView, normalizeRoomCode } from '@/lib/party/engine';
import { roomEventStream } from '@/lib/party/sse';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const url = new URL(request.url);
  const roomCode = normalizeRoomCode(url.searchParams.get('roomCode'));
  const hostId = url.searchParams.get('hostId');
  if (!roomCode || !hostId) {
    return new Response('Missing roomCode or hostId', { status: 400 });
  }

  return roomEventStream(request, roomCode, async () => {
    const state = await getGameState(roomCode);
    if (!state) return { payload: { error: 'Room not found' }, close: true };
    if (state.hostId !== hostId) return { payload: { error: 'Invalid Host ID' }, close: true };
    return { payload: hostView(state) };
  });
}
