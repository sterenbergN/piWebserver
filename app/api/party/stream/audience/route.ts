import { audienceView, getGameState, normalizeRoomCode, resolveAudienceKey, setAudienceConnected } from '@/lib/party/engine';
import { roomEventStream } from '@/lib/party/sse';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const url = new URL(request.url);
  const roomCode = normalizeRoomCode(url.searchParams.get('roomCode'));
  const key = url.searchParams.get('key');
  if (!roomCode || !key) {
    return new Response('Missing roomCode or key', { status: 400 });
  }

  let audienceId: string | null = null;
  return roomEventStream(
    request,
    roomCode,
    async () => {
      const state = await getGameState(roomCode);
      if (!state) return { payload: { error: 'Room not found' }, close: true };
      const id = resolveAudienceKey(state, key);
      if (!id) return { payload: { error: 'You are no longer in this audience' }, close: true };
      audienceId = id;
      return { payload: audienceView(state, id) };
    },
    {
      onOpen: () => (audienceId ? setAudienceConnected(roomCode, audienceId, true) : undefined),
      onClose: () => (audienceId ? setAudienceConnected(roomCode, audienceId, false) : undefined),
    },
  );
}
