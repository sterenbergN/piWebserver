import { normalizeRoomCode } from '@/lib/party/engine';
import { partyEmitter } from '@/lib/party/emitter';
import { getKartSimulation, getKartSnapshot } from '@/lib/party/kart-physics';

export const dynamic = 'force-dynamic';

const encoder = new TextEncoder();

export async function GET(request: Request) {
  const url = new URL(request.url);
  const roomCode = normalizeRoomCode(url.searchParams.get('roomCode'));
  const role = url.searchParams.get('role') === 'player' ? 'player' : 'host';

  if (!roomCode) {
    return new Response('Missing roomCode', { status: 400 });
  }

  let cleanup = () => {};

  const stream = new ReadableStream({
    start(controller) {
      let closed = false;
      const send = (text: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(text));
        } catch {
          closed = true;
        }
      };

      // The sim serializes each tick once, so a room full of phones doesn't multiply the work
      const onTick = (json: string, tickCount: number) => {
        // Host TV gets full 30Hz stream; phones get 10Hz (every 3rd tick) to save mobile battery/bandwidth
        if (role === 'player' && tickCount % 3 !== 0) return;
        send(`data: ${json}\n\n`);
      };

      const heartbeat = setInterval(() => send(':\n\n'), 15000);
      cleanup = () => {
        clearInterval(heartbeat);
        partyEmitter.off(`kart-tick-${roomCode}`, onTick);
      };

      partyEmitter.on(`kart-tick-${roomCode}`, onTick);
      request.signal.addEventListener('abort', () => {
        closed = true;
        cleanup();
      });

      const currentSim = getKartSimulation(roomCode);
      if (currentSim) {
        send(`data: ${JSON.stringify(getKartSnapshot(currentSim))}\n\n`);
      }
    },
    cancel() {
      cleanup();
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
