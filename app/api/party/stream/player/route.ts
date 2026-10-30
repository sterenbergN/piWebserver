import { getGameState, normalizeRoomCode, resolvePlayerKey, setPlayerConnected } from '@/lib/party/engine';
import { computeAwards } from '@/lib/party/awards';
import { roomEventStream } from '@/lib/party/sse';
import { GameState } from '@/lib/party/types';
import { waitingFor } from '@/lib/party/presence';

export const dynamic = 'force-dynamic';

// Open streams per player. A reconnecting phone opens its new stream before the
// server notices the old one closed, so only the last stream to close may mark
// the player as gone; otherwise they'd show as disconnected (and be skipped).
const openStreams = new Map<string, number>();

function computeWaitingOnNames(state: GameState): string[] {
  const ids = waitingFor(state, state.playerOrder);

  const isDone = (pid: string): boolean => {
    const pd = state.playerData?.[pid];
    switch (state.gameType) {
      case 'quip-clash':
        if (state.phase === 'PROMPTING') return Boolean(pd?.answers?.[0] && pd?.answers?.[1]);
        if (state.phase === 'VOTING') return !pd?.canVote || Boolean(state.gameData?.currentVotes?.[pid]);
        return true;
      case 'the-faker':
        if (state.phase === 'VOTING') return Boolean(pd?.hasVoted);
        return true;
      case 'trivia-death':
        if (state.phase === 'QUESTION') return pd?.status === 'ghost' || (pd?.answer !== null && pd?.answer !== undefined);
        if (state.phase === 'FINAL_ESCAPE') return pd?.answer !== null && pd?.answer !== undefined;
        return true;
      case 'bracket-battles':
        if (state.phase === 'PROMPTING') return Boolean(pd?.submitted);
        if (state.phase === 'PREDICTION') return Boolean(pd?.predicted);
        if (state.phase === 'MATCHUP') return !pd?.canVote || Boolean(pd?.voted);
        return true;
      case 'spyfall':
        if (state.phase === 'VOTING') return Boolean(pd?.hasVoted);
        return true;
      case 'herd-mentality':
        if (state.phase === 'PROMPTING') return Boolean(pd?.submitted);
        return true;
      case 'wavelength':
        if (state.phase === 'CLUE_GIVING') return pid !== state.gameData?.psychicId;
        if (state.phase === 'DIALING') return pid === state.gameData?.psychicId || Boolean(pd?.submitted || pd?.lockedDial !== null);
        return true;
      case 'bluff-clash':
        if (state.phase === 'BLUFFING') return Boolean(pd?.submitted);
        if (state.phase === 'VOTING') return Boolean(pd?.voted);
        return true;
      case 'emoji-telephone':
        if (state.phase === 'TRANSLATE' || state.phase === 'GUESS') return Boolean(pd?.submitted);
        if (state.phase === 'VOTING') return Boolean(pd?.voted);
        return true;
      case 'kart-clash':
        if (state.phase === 'TRACK_VOTE') return !pd?.isRacing || Boolean(pd?.votedTrackId);
        return true;
      default:
        return true;
    }
  };

  return ids
    .filter((pid) => !isDone(pid))
    .map((pid) => state.players[pid]?.name)
    .filter(Boolean);
}

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
      if (!playerId || !state.players[playerId]) return { payload: { error: 'You were removed from this room' }, close: true };
      connectedId = playerId;

      // Players only get their own private data plus public room info (including TV hostData for phones-only play).
      return {
        payload: {
          roomCode: state.roomCode,
          gameType: state.gameType,
          phase: state.phase,
          players: state.players,
          playerOrder: state.playerOrder,
          settings: state.settings,
          audienceSize: Object.keys(state.audience || {}).length,
          hostData: state.hostData || {},
          baseScores: state.gameData?.baseScores || null,
          targetRounds: state.gameData?.targetRounds || null,
          kartConfig: state.gameType === 'kart-clash' ? {
            format: state.gameData?.format || (state.playerOrder.length > 8 ? 'tournament' : 'grand-prix'),
            totalRaces: state.gameData?.totalRaces || 3,
            heatSize: state.gameData?.heatSize || 4,
            aiBots: state.gameData?.aiBots !== false,
          } : null,
          waitingOn: computeWaitingOnNames(state),
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
