import { GameState } from '../types';
import { waitingFor } from '../presence';
import { bumpStat } from '../awards';
import { drawGameContent } from '../prompts';

const TOTAL_ROUNDS = 5;
const PROMPT_TIME = 35;

export function normalizeHerdAnswer(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/^(a|an|the)\s+/i, '')
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/([^s])s$/, '$1'); // simple singularization (e.g. "fries" stays, "apples" -> "apple")
}

export const herdMentalityLogic = {
  onStart: async (state: GameState) => {
    if (state.playerOrder.length < 3) return;
    const prompts = await drawGameContent('herdMentality', TOTAL_ROUNDS, state.settings?.packs);
    state.gameData = {
      round: 0,
      totalRounds: TOTAL_ROUNDS,
      prompts,
      answers: {} as Record<string, string>,
      pinkCowHolder: null as string | null,
    };
    startHerdRound(state);
  },

  processAction: async (state: GameState, playerId: string, action: any) => {
    switch (action.type) {
      case 'SUBMIT_ANSWER': {
        if (state.phase !== 'PROMPTING') return;
        const ans = typeof action.answer === 'string' ? action.answer.trim() : '';
        if (!ans) return;
        state.gameData.answers[playerId] = ans;
        state.playerData[playerId] = { ...state.playerData[playerId], submitted: ans };

        const targets = waitingFor(state, state.playerOrder);
        if (targets.every((pid) => state.gameData.answers[pid])) {
          resolveHerdRound(state);
        }
        break;
      }

      case 'FORCE_HERD_RESULTS': {
        if (state.phase !== 'PROMPTING') return;
        resolveHerdRound(state);
        break;
      }

      case 'NEXT_HERD_ROUND': {
        if (state.phase !== 'ROUND_RESULTS') return;
        if (state.gameData.round >= state.gameData.totalRounds) {
          state.phase = 'FINAL_RESULTS';
          state.hostData = { message: 'The Herd Has Spoken!' };
          for (const pid of state.playerOrder) state.playerData[pid] = { phase: 'FINAL_RESULTS' };
        } else {
          startHerdRound(state);
        }
        break;
      }
    }
  },
};

function startHerdRound(state: GameState) {
  state.gameData.round++;
  state.gameData.answers = {};
  const prompt = state.gameData.prompts[state.gameData.round - 1];

  state.phase = 'PROMPTING';
  state.hostData = {
    round: state.gameData.round,
    totalRounds: state.gameData.totalRounds,
    prompt,
    pinkCowHolder: state.gameData.pinkCowHolder,
    timerStart: Date.now(),
    timerDuration: PROMPT_TIME,
    autoAdvanceAt: Date.now() + PROMPT_TIME * 1000,
    autoAdvanceAction: 'FORCE_HERD_RESULTS',
  };

  for (const pid of state.playerOrder) {
    state.playerData[pid] = {
      phase: 'PROMPTING',
      round: state.gameData.round,
      totalRounds: state.gameData.totalRounds,
      prompt,
      hasPinkCow: state.gameData.pinkCowHolder === pid,
      submitted: null,
    };
  }
}

function resolveHerdRound(state: GameState) {
  state.phase = 'ROUND_RESULTS';
  const prompt = state.gameData.prompts[state.gameData.round - 1];
  const groupsMap = new Map<string, { key: string; label: string; playerIds: string[] }>();

  for (const pid of state.playerOrder) {
    const raw = state.gameData.answers[pid];
    if (!raw) continue;
    const norm = normalizeHerdAnswer(raw) || raw.toLowerCase();
    const existing = groupsMap.get(norm);
    if (existing) {
      existing.playerIds.push(pid);
    } else {
      groupsMap.set(norm, { key: norm, label: raw, playerIds: [pid] });
    }
  }

  const groups = [...groupsMap.values()].sort((a, b) => b.playerIds.length - a.playerIds.length);
  const maxSize = groups[0]?.playerIds.length || 0;
  const majorityGroups = maxSize >= 2 ? groups.filter((g) => g.playerIds.length === maxSize) : [];
  const majorityPlayerIds = new Set(majorityGroups.flatMap((g) => g.playerIds));

  for (const pid of majorityPlayerIds) {
    if (state.players[pid]) {
      state.players[pid].score += 600;
      bumpStat(state, 'votes', pid, 2);
    }
  }

  // Pink Cow logic: if exactly ONE group has size 1 while at least one group has size >= 2,
  // that lone oddball gets the Pink Cow!
  const singletons = groups.filter((g) => g.playerIds.length === 1);
  let newPinkCowId: string | null = null;
  if (maxSize >= 2 && singletons.length === 1) {
    newPinkCowId = singletons[0].playerIds[0];
    state.gameData.pinkCowHolder = newPinkCowId;
  }

  state.hostData = {
    round: state.gameData.round,
    totalRounds: state.gameData.totalRounds,
    prompt,
    groups: groups.map((g) => ({
      ...g,
      isMajority: g.playerIds.length === maxSize && maxSize >= 2,
      isPinkCow: g.playerIds.length === 1 && g.playerIds[0] === newPinkCowId,
    })),
    pinkCowHolder: state.gameData.pinkCowHolder,
    newPinkCowId,
    timerStart: Date.now(),
    timerDuration: 9,
    autoAdvanceAt: Date.now() + 9_000,
    autoAdvanceAction: 'NEXT_HERD_ROUND',
  };

  for (const pid of state.playerOrder) {
    const inMajority = majorityPlayerIds.has(pid);
    const gotCow = newPinkCowId === pid;
    state.playerData[pid] = {
      phase: 'ROUND_RESULTS',
      inMajority,
      gotCow,
      hasPinkCow: state.gameData.pinkCowHolder === pid,
      myAnswer: state.gameData.answers[pid] || 'No answer',
      message: gotCow
        ? '🐄 MOO! You were the only oddball — you got the Pink Cow!'
        : inMajority
        ? '🐄 You thought like the Herd! +600 pts!'
        : 'Out of the herd this round!',
    };
  }
}
