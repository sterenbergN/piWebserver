import { partyEmitter } from './emitter';

const encoder = new TextEncoder();

/**
 * Server-sent-events stream that re-sends a view of the room on every update.
 * Guards every write so a closed connection (phone locked, tab closed) can't
 * throw from a heartbeat or a late update.
 */
export function roomEventStream(
  request: Request,
  roomCode: string,
  render: () => Promise<{ payload: unknown; close?: boolean }>,
  hooks: { onOpen?: () => void | Promise<void>; onClose?: () => void | Promise<void> } = {},
) {
  let cleanup = () => {};

  const stream = new ReadableStream({
    async start(controller) {
      let closed = false;
      const send = (text: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(text));
        } catch {
          closed = true;
        }
      };
      const push = async () => {
        const { payload, close } = await render();
        send(`data: ${JSON.stringify(payload)}\n\n`);
        if (close) {
          closed = true;
          cleanup();
          try { controller.close(); } catch { /* already closed */ }
        }
      };

      const onUpdate = () => { push().catch(() => {}); };
      const heartbeat = setInterval(() => send(':\n\n'), 15000);
      cleanup = () => {
        clearInterval(heartbeat);
        partyEmitter.off(`update-${roomCode}`, onUpdate);
      };

      partyEmitter.on(`update-${roomCode}`, onUpdate);
      request.signal.addEventListener('abort', () => {
        closed = true;
        cleanup();
        Promise.resolve(hooks.onClose?.()).catch(() => {});
      });

      await push();
      if (!closed) await hooks.onOpen?.();
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
