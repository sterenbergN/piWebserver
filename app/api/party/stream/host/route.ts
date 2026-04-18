import { getGameState } from '@/lib/party/engine';
import { partyEmitter } from '@/lib/party/emitter';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const url = new URL(request.url);
  const roomCode = url.searchParams.get('roomCode');
  const hostId = url.searchParams.get('hostId');

  if (!roomCode || !hostId) {
    return new Response('Missing roomCode or hostId', { status: 400 });
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      // Send initial state
      const initialState = await getGameState(roomCode);
      if (initialState) {
        if (initialState.hostId !== hostId) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ error: 'Invalid Host ID' })}\n\n`));
          controller.close();
          return;
        }
        
        // Host gets the full state including hostData, but strip out playerData unless needed, actually host can see all to render
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(initialState)}\n\n`));
      } else {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ error: 'Room not found' })}\n\n`));
        controller.close();
        return;
      }

      const updateHandler = async () => {
        const state = await getGameState(roomCode);
        if (state) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(state)}\n\n`));
        }
      };

      partyEmitter.on(`update-${roomCode}`, updateHandler);

      // Keep connection alive with heartbeat
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
