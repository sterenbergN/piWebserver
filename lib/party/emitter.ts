import { EventEmitter } from 'events';

// Preserve the emitter across hot reloads in Next.js development
const globalForParty = globalThis as unknown as { partyEmitter: EventEmitter };

export const partyEmitter = globalForParty.partyEmitter || new EventEmitter();

// Increase max listeners if many people join
partyEmitter.setMaxListeners(50);

if (process.env.NODE_ENV !== 'production') {
  globalForParty.partyEmitter = partyEmitter;
}

export function emitStateUpdate(roomCode: string) {
  partyEmitter.emit(`update-${roomCode}`);
}
