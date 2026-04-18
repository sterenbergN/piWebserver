import { getGameState } from '@/lib/party/engine';
import { partyEmitter } from '@/lib/party/emitter';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const url = new URL(request.url);
  const roomCode = url.searchParams.get('roomCode');
  const playerId = url.searchParams.get('playerId');

  if (!roomCode || !playerId) {
    return new Response('Missing roomCode or playerId', { status: 400 });
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const sendState = async () => {
        const state = await getGameState(roomCode);
        if (state) {
          if (!state.players[playerId]) {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ error: 'Invalid Player ID / Kicked' })}\n\n`));
            return;
          }
          
          // Players only get a subset of the state
          const playerView = {
            roomCode: state.roomCode,
            gameType: state.gameType,
            phase: state.phase,
            players: state.players, // basic info
            me: state.players[playerId],
            data: state.playerData[playerId] || null, // Only this player's specific data
            updatedAt: state.updatedAt
          };
          
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(playerView)}\n\n`));
        } else {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ error: 'Room not found' })}\n\n`));
        }
      };

      // Send initial
      await sendState();

      const updateHandler = async () => {
        await sendState();
      };

      partyEmitter.on(`update-${roomCode}`, updateHandler);

      const heartbeat = setInterval(() => {
        controller.enqueue(encoder.encode(':\n\n'));
      }, 15000);

      request.signal.addEventListener('abort', () => {
        partyEmitter.off(`update-${roomCode}`, updateHandler);
        clearInterval(heartbeat);
      });
    }
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
}
