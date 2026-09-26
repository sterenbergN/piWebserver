import { getGameState, normalizeRoomCode, resolvePlayerKey, setPlayerConnected } from '@/lib/party/engine';
import { computeAwards } from '@/lib/party/awards';
import { roomEventStream } from '@/lib/party/sse';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const url = new URL(request.url);
  const roomCode = normalizeRoomCode(url.searchParams.get('roomCode'));
  // The URL carries the player's secret key; resolve it to their public id.
  const playerKey = url.searchParams.get('playerId');
  if (!roomCode || !playerKey) {
    return new Response('Missing roomCode or playerId', { status: 400 });
  }

  let connectedId: string | null = null;
  return roomEventStream(
    request,
    roomCode,
    async () => {
      const state = await getGameState(roomCode);
      if (!state) return { payload: { error: 'Room not found' }, close: true };
      const playerId = resolvePlayerKey(state, playerKey);
      if (!playerId || !state.players[playerId]) return { payload: { error: 'You were removed from this room' }, close: true };
      connectedId = playerId;

      // Players only get their own private data plus public room info.
      return {
        payload: {
          roomCode: state.roomCode,
          gameType: state.gameType,
          phase: state.phase,
          players: state.players,
          me: state.players[playerId],
          data: state.playerData[playerId] || null,
          awards: state.phase === 'FINAL_RESULTS' ? computeAwards(state) : null,
          updatedAt: state.updatedAt,
        },
      };
    },
    {
      // Lets the host see who dropped, and lets a dropped player rejoin by name.
      // The first render (which runs before onOpen) resolved connectedId.
      onOpen: () => (connectedId ? setPlayerConnected(roomCode, connectedId, true) : undefined),
      onClose: () => (connectedId ? setPlayerConnected(roomCode, connectedId, false) : undefined),
    },
  );
}
