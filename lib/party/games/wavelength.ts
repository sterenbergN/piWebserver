import { GameState } from '../types';
import { waitingFor } from '../presence';
import { bumpStat } from '../awards';
import { drawGameContent } from '../prompts';

const CLUE_TIME = 45;
const DIAL_TIME = 35;

export const wavelengthLogic = {
  onStart: async (state: GameState) => {
    if (state.playerOrder.length < 2) return;
    const totalRounds = Math.min(Math.max(state.playerOrder.length, 3), 5);
    // Phones and the TV read a spectrum as [left, right].
    const spectrums = (await drawGameContent('wavelengthSpectrums', totalRounds, state.settings?.packs)).map((sp) => [sp.left, sp.right]);
    state.gameData = {
      round: 0,
      totalRounds,
      spectrums,
      psychicId: '',
      target: 50,
      clue: '',
      dials: {} as Record<string, number>,
    };
    startWavelengthRound(state);
  },

  processAction: async (state: GameState, playerId: string, action: any) => {
    switch (action.type) {
      case 'SUBMIT_CLUE': {
        if (state.phase !== 'CLUE_GIVING') return;
        if (playerId !== state.gameData.psychicId && playerId !== state.hostId) return;
        const clue = typeof action.clue === 'string' ? action.clue.trim() : '';
        if (!clue) return;
        state.gameData.clue = clue;
        startDialingPhase(state);
        break;
      }

      case 'FORCE_DIALING': {
        if (state.phase !== 'CLUE_GIVING') return;
        if (!state.gameData.clue) state.gameData.clue = '(Spoken out loud!)';
        startDialingPhase(state);
        break;
      }

      case 'SUBMIT_DIAL': {
        if (state.phase !== 'DIALING') return;
        if (playerId === state.gameData.psychicId) return;
        const val = Math.max(0, Math.min(100, Math.round(Number(action.value))));
        if (!Number.isFinite(val)) return;
        state.gameData.dials[playerId] = val;
        state.playerData[playerId] = { ...state.playerData[playerId], lockedDial: val, submitted: true };

        const targetGuessers = waitingFor(state, state.playerOrder.filter((pid) => pid !== state.gameData.psychicId));
        if (targetGuessers.every((pid) => state.gameData.dials[pid] !== undefined)) {
          resolveWavelengthRound(state);
        }
        break;
      }

      case 'FORCE_WAVELENGTH_RESULTS': {
        if (state.phase !== 'DIALING') return;
        resolveWavelengthRound(state);
        break;
      }

      case 'NEXT_WAVELENGTH_ROUND': {
        if (state.phase !== 'ROUND_RESULTS') return;
        if (state.gameData.round >= state.gameData.totalRounds) {
          state.phase = 'FINAL_RESULTS';
          state.hostData = { message: 'In Sync!' };
          for (const pid of state.playerOrder) state.playerData[pid] = { phase: 'FINAL_RESULTS' };
        } else {
          startWavelengthRound(state);
        }
        break;
      }
    }
  },
};

function startWavelengthRound(state: GameState) {
  state.gameData.round++;
  state.gameData.dials = {};
  state.gameData.clue = '';

  const activeOrder = state.playerOrder.filter((pid) => !state.players[pid]?.left);
  // Skip phones that have dropped so the round doesn't stall waiting on a clue.
  const pool = waitingFor(state, activeOrder);
  const psychicId = pool[(state.gameData.round - 1) % pool.length] || state.playerOrder[0];
  state.gameData.psychicId = psychicId;

  const spectrum = state.gameData.spectrums[(state.gameData.round - 1) % state.gameData.spectrums.length];
  const target = Math.floor(Math.random() * 85) + 8; // 8..92
  state.gameData.target = target;

  state.phase = 'CLUE_GIVING';
  state.hostData = {
    round: state.gameData.round,
    totalRounds: state.gameData.totalRounds,
    psychicId,
    psychicName: state.players[psychicId]?.name,
    spectrum,
    timerStart: Date.now(),
    timerDuration: CLUE_TIME,
    autoAdvanceAt: Date.now() + CLUE_TIME * 1000,
    autoAdvanceAction: 'FORCE_DIALING',
  };

  for (const pid of state.playerOrder) {
    const isPsychic = pid === psychicId;
    state.playerData[pid] = {
      phase: 'CLUE_GIVING',
      round: state.gameData.round,
      totalRounds: state.gameData.totalRounds,
      isPsychic,
      psychicName: state.players[psychicId]?.name,
      spectrum,
      target: isPsychic ? target : null,
    };
  }
}

function startDialingPhase(state: GameState) {
  state.phase = 'DIALING';
  const { psychicId, target, clue } = state.gameData;
  const spectrum = state.gameData.spectrums[(state.gameData.round - 1) % state.gameData.spectrums.length];

  state.hostData = {
    round: state.gameData.round,
    totalRounds: state.gameData.totalRounds,
    psychicId,
    psychicName: state.players[psychicId]?.name,
    spectrum,
    clue,
    timerStart: Date.now(),
    timerDuration: DIAL_TIME,
    autoAdvanceAt: Date.now() + DIAL_TIME * 1000,
    autoAdvanceAction: 'FORCE_WAVELENGTH_RESULTS',
  };

  for (const pid of state.playerOrder) {
    const isPsychic = pid === psychicId;
    state.playerData[pid] = {
      phase: 'DIALING',
      isPsychic,
      psychicName: state.players[psychicId]?.name,
      spectrum,
      clue,
      target: isPsychic ? target : null,
      lockedDial: null,
      submitted: false,
    };
  }
}

function resolveWavelengthRound(state: GameState) {
  state.phase = 'ROUND_RESULTS';
  const { psychicId, target, clue, dials } = state.gameData;
  const spectrum = state.gameData.spectrums[(state.gameData.round - 1) % state.gameData.spectrums.length];

  const results: Record<string, { value: number; diff: number; points: number; label: string }> = {};
  let psychicBonus = 0;

  for (const pid of state.playerOrder) {
    if (pid === psychicId || dials[pid] === undefined) continue;
    const value = dials[pid];
    const diff = Math.abs(value - target);
    let points = 0;
    let label = 'Miss';
    if (diff <= 4) {
      points = 800;
      label = '🎯 BULLSEYE!';
      psychicBonus += 400;
      bumpStat(state, 'correct', pid);
    } else if (diff <= 10) {
      points = 550;
      label = '🔥 Close!';
      psychicBonus += 250;
    } else if (diff <= 18) {
      points = 300;
      label = '👍 Warm';
      psychicBonus += 125;
    }
    if (state.players[pid]) state.players[pid].score += points;
    results[pid] = { value, diff, points, label };
  }

  if (state.players[psychicId]) state.players[psychicId].score += psychicBonus;

  state.hostData = {
    round: state.gameData.round,
    totalRounds: state.gameData.totalRounds,
    psychicId,
    psychicName: state.players[psychicId]?.name,
    psychicBonus,
    spectrum,
    clue,
    target,
    results,
    timerStart: Date.now(),
    timerDuration: 10,
    autoAdvanceAt: Date.now() + 10_000,
    autoAdvanceAction: 'NEXT_WAVELENGTH_ROUND',
  };

  for (const pid of state.playerOrder) {
    const isPsychic = pid === psychicId;
    const r = results[pid];
    state.playerData[pid] = {
      phase: 'ROUND_RESULTS',
      isPsychic,
      target,
      clue,
      spectrum,
      myResult: r || null,
      psychicBonus: isPsychic ? psychicBonus : undefined,
      message: isPsychic
        ? `Target was ${target}% — you earned +${psychicBonus} pts from your team!`
        : r
        ? `${r.label} (You guessed ${r.value}%, target was ${target}%) +${r.points} pts`
        : `Target was ${target}%!`,
    };
  }
}
