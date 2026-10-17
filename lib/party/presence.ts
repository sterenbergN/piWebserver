import type { GameState, Player } from './types';

/**
 * How long a dropped phone still counts as in the game. Phones close their
 * live connection whenever the screen locks, so a player who glances away for
 * a few seconds must not be skipped (and handed "Too slow!"). Past this, rounds
 * stop waiting on them; the phase timers cover anything in between.
 */
export const DISCONNECT_GRACE_MS = 20_000;

/** Whether a round should still wait for this player. */
export function isPresent(player: Player | undefined, now = Date.now()): boolean {
  if (!player || player.left) return false;
  if (player.connected !== false) return true;
  return typeof player.disconnectedAt === 'number' && now - player.disconnectedAt < DISCONNECT_GRACE_MS;
}

/**
 * The players a phase waits on before moving on early: everyone in `ids` who
 * is still present. If nobody is (everyone's phone dropped), wait on all of
 * them so the game doesn't race ahead on its own; the phase timer ends it.
 */
export function waitingFor(state: GameState, ids: string[], now = Date.now()): string[] {
  const present = ids.filter((pid) => isPresent(state.players[pid], now));
  if (present.length) return present;
  const seated = ids.filter((pid) => state.players[pid] && !state.players[pid].left);
  return seated.length ? seated : ids;
}
