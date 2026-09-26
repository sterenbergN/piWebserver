import type { AudienceVote, GameState } from './types';

// The audience poll: a game opens one when a phase has something to vote on,
// the engine records AUDIENCE_VOTE actions against it, and the game reads the
// tally when it resolves that phase. A poll only counts while the game is still
// in the phase that opened it, so a stale poll can never leak into a later one.

export const MAX_AUDIENCE = 100;

export function openAudienceVote(state: GameState, poll: Omit<AudienceVote, 'votes' | 'phase'>) {
  state.audienceVote = { ...poll, phase: state.phase, votes: {} };
}

/** The poll the audience can vote in right now, if any. */
export function activeAudienceVote(state: GameState): AudienceVote | null {
  const poll = state.audienceVote;
  return poll && poll.phase === state.phase ? poll : null;
}

export function recordAudienceVote(state: GameState, audienceId: string, choice: unknown): boolean {
  const poll = activeAudienceVote(state);
  if (!poll || typeof choice !== 'string' || !poll.choices.some((c) => c.id === choice)) return false;
  poll.votes[audienceId] = choice;
  return true;
}

/**
 * Close the current poll (if it belongs to `key`) and return its tally, with
 * the single most-voted choice as `winner` (null on a tie or no votes).
 */
export function closeAudienceVote(state: GameState, key: string) {
  const poll = state.audienceVote;
  state.audienceVote = null;
  const tally: Record<string, number> = {};
  if (!poll || poll.key !== key) return { tally, total: 0, winner: null as string | null, votes: {} as Record<string, string> };
  for (const c of poll.choices) tally[c.id] = 0;
  for (const choice of Object.values(poll.votes)) if (choice in tally) tally[choice]++;
  const total = Object.values(tally).reduce((a, b) => a + b, 0);
  const best = Math.max(0, ...Object.values(tally));
  const leaders = Object.keys(tally).filter((id) => tally[id] === best);
  return { tally, total, winner: best > 0 && leaders.length === 1 ? leaders[0] : null, votes: poll.votes };
}

export function audienceCount(state: GameState) {
  return Object.keys(state.audience || {}).length;
}
