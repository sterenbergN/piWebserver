import type { GameState } from './types';

// Stopping the clock so a room can talk something through. The deadline moves out of
// hostData while paused, so neither the server's timer nor the host page's fallback can
// fire. Resuming puts it back, later by however long the pause lasted.

export function canPause(state: GameState) {
  return state.gameType === 'trivia-death'
    && !state.paused
    && typeof state.hostData?.autoAdvanceAt === 'number'
    && typeof state.hostData?.autoAdvanceAction === 'string';
}

export function pauseGame(state: GameState, now = Date.now()) {
  const { autoAdvanceAt, autoAdvanceAction, ...hostData } = state.hostData;
  state.paused = { at: now, autoAdvanceAt, autoAdvanceAction };
  state.hostData = hostData;
}

export function resumeGame(state: GameState, now = Date.now()) {
  if (!state.paused) return;
  const { at, autoAdvanceAt, autoAdvanceAction } = state.paused;
  const away = now - at;
  state.hostData = { ...state.hostData, autoAdvanceAt: autoAdvanceAt + away, autoAdvanceAction };
  if (typeof state.hostData.timerStart === 'number') state.hostData.timerStart += away;
  for (const data of Object.values(state.playerData)) {
    if (typeof data?.timerStart === 'number') data.timerStart += away;
  }
  delete state.paused;
}
