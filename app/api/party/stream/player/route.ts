import { getGameState, normalizeRoomCode, resolvePlayerKey, setPlayerConnected } from '@/lib/party/engine';
import { buildPlayerPayload } from '@/lib/party/player-stream';
import { roomEventStream } from '@/lib/party/sse';

export const dynamic = 'force-dynamic';

// Open streams per player. A reconnecting phone opens its new stream before the
// server notices the old one closed, so only the last stream to close may mark
// the player as gone; otherwise they'd show as disconnected (and be skipped).
const openStreams = new Map<string, number>();

export async function GET(request: Request) {
  const url = new URL(request.url);
  const roomCode = normalizeRoomCode(url.searchParams.get('roomCode'));
  // The URL carries the player's secret key; resolve it to their public id.
  const playerKey = url.searchParams.get('playerId');
  if (!roomCode || !playerKey) {
    return new Response('Missing roomCode or playerId', { status: 400 });
  }

  let connectedId: string | null = null;
  let opened = false;
  return roomEventStream(
    request,
    roomCode,
    async () => {
      const state = await getGameState(roomCode);
      if (!state) return { payload: { error: 'Room not found' }, close: true };
      const playerId = resolvePlayerKey(state, playerKey);
      if (!playerId || !state.players[playerId] || state.players[playerId].left) {
        return { payload: { error: 'You were removed from this room' }, close: true };
      }
      connectedId = playerId;

      return { payload: buildPlayerPayload(state, playerId) };
    },
    {
      // Lets the host see who dropped, and lets a dropped player rejoin by name.
      // The first render (which runs before onOpen) resolved connectedId.
      onOpen: () => {
        if (!connectedId) return;
        opened = true;
        const key = `${roomCode}:${connectedId}`;
        openStreams.set(key, (openStreams.get(key) || 0) + 1);
        return setPlayerConnected(roomCode, connectedId, true);
      },
      onClose: () => {
        if (!connectedId || !opened) return;
        const key = `${roomCode}:${connectedId}`;
        const remaining = (openStreams.get(key) || 1) - 1;
        if (remaining > 0) {
          openStreams.set(key, remaining);
          return;
        }
        openStreams.delete(key);
        return setPlayerConnected(roomCode, connectedId, false);
      },
    },
  );
}
