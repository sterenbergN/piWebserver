import { EventEmitter } from 'events';

// Preserve the emitter across hot reloads and across Next.js route chunks in production
const globalForParty = globalThis as unknown as { partyEmitter?: EventEmitter };

export const partyEmitter = globalForParty.partyEmitter || new EventEmitter();
partyEmitter.setMaxListeners(100);
globalForParty.partyEmitter = partyEmitter;

export function emitStateUpdate(roomCode: string) {
  partyEmitter.emit(`update-${roomCode}`);
}
