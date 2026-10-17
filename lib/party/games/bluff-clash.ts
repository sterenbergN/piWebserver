import { GameState } from '../types';
import { waitingFor } from '../presence';
import { closeAudienceVote, openAudienceVote } from '../audience';
import { bumpStat } from '../awards';
import { drawGameContent, type BluffFact } from '../prompts';

const TOTAL_ROUNDS = 4;
const BLUFF_TIME = 45;
const VOTE_TIME = 30;

/** Compare answers loosely so "A house cat!" still counts as the truth "house cat". */
export function normalizeBluff(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^(a|an|the) /, '');
}

export const bluffClashLogic = {
  onStart: async (state: GameState) => {
    if (state.playerOrder.length < 3) return;
    const facts = await drawGameContent('bluffFacts', TOTAL_ROUNDS, state.settings?.packs);
    state.gameData = {
      round: 0,
      totalRounds: TOTAL_ROUNDS,
      facts,
      bluffs: {} as Record<string, string>,
      choices: [] as { id: string; text: string; authorIds: string[]; isTruth: boolean }[],
      votes: {} as Record<string, string>,
    };
    startBluffRound(state);
  },

  processAction: async (state: GameState, playerId: string, action: any) => {
    switch (action.type) {
      case 'SUBMIT_BLUFF': {
        if (state.phase !== 'BLUFFING') return;
        const fact = state.gameData.facts[state.gameData.round - 1] as BluffFact;
        const text = typeof action.bluff === 'string' ? action.bluff.trim() : '';
        if (!text) return;
        if (normalizeBluff(text) === normalizeBluff(fact.truth)) {
          state.playerData[playerId] = {
            ...state.playerData[playerId],
            truthWarning: '🎯 That’s the actual truth! Make up a convincing lie instead!',
          };
          return;
        }
        state.gameData.bluffs[playerId] = text;
        state.playerData[playerId] = { ...state.playerData[playerId], truthWarning: null, submitted: text };

        const targets = waitingFor(state, state.playerOrder);
        if (targets.every((pid) => state.gameData.bluffs[pid])) {
          startBluffVoting(state);
        }
        break;
      }

      case 'FORCE_BLUFF_VOTING': {
        if (state.phase !== 'BLUFFING') return;
        startBluffVoting(state);
        break;
      }

      case 'SUBMIT_VOTE': {
        if (state.phase !== 'VOTING') return;
        const choiceId = String(action.choiceId || '');
        const choice = state.gameData.choices.find((c: any) => c.id === choiceId);
        if (!choice || choice.authorIds.includes(playerId)) return;
        state.gameData.votes[playerId] = choiceId;
        state.playerData[playerId] = { ...state.playerData[playerId], voted: true };

        const targets = waitingFor(state, state.playerOrder);
        if (targets.every((pid) => state.gameData.votes[pid])) {
          resolveBluffRound(state);
        }
        break;
      }

      case 'FORCE_BLUFF_RESULTS': {
        if (state.phase !== 'VOTING') return;
        resolveBluffRound(state);
        break;
      }

      case 'NEXT_BLUFF_ROUND': {
        if (state.phase !== 'ROUND_RESULTS') return;
        if (state.gameData.round >= state.gameData.totalRounds) {
          state.phase = 'FINAL_RESULTS';
          state.hostData = { message: 'No More Lies!' };
          for (const pid of state.playerOrder) state.playerData[pid] = { phase: 'FINAL_RESULTS' };
        } else {
          startBluffRound(state);
        }
        break;
      }
    }
  },
};

function startBluffRound(state: GameState) {
  state.gameData.round++;
  state.gameData.bluffs = {};
  state.gameData.votes = {};
  const fact = state.gameData.facts[state.gameData.round - 1] as BluffFact;

  state.phase = 'BLUFFING';
  state.hostData = {
    round: state.gameData.round,
    totalRounds: state.gameData.totalRounds,
    prompt: fact.prompt,
    timerStart: Date.now(),
    timerDuration: BLUFF_TIME,
    autoAdvanceAt: Date.now() + BLUFF_TIME * 1000,
    autoAdvanceAction: 'FORCE_BLUFF_VOTING',
  };

  for (const pid of state.playerOrder) {
    state.playerData[pid] = {
      phase: 'BLUFFING',
      round: state.gameData.round,
      totalRounds: state.gameData.totalRounds,
      prompt: fact.prompt,
      submitted: null,
      truthWarning: null,
    };
  }
}

function startBluffVoting(state: GameState) {
  state.phase = 'VOTING';
  const fact = state.gameData.facts[state.gameData.round - 1] as BluffFact;

  // Merge identical player bluffs
  const byText = new Map<string, { id: string; text: string; authorIds: string[]; isTruth: boolean }>();
  byText.set(normalizeBluff(fact.truth), {
    id: 'TRUTH',
    text: fact.truth.toLowerCase(),
    authorIds: [],
    isTruth: true,
  });

  let idx = 0;
  for (const pid of state.playerOrder) {
    const raw = state.gameData.bluffs[pid];
    if (!raw) continue;
    const key = normalizeBluff(raw) || raw.toLowerCase();
    const existing = byText.get(key);
    if (existing && !existing.isTruth) {
      existing.authorIds.push(pid);
    } else if (!existing) {
      byText.set(key, { id: `BLUFF_${idx++}`, text: raw.toLowerCase(), authorIds: [pid], isTruth: false });
    }
  }

  // Top up with house decoys so there are always at least 4 options
  for (const d of fact.decoys) {
    if (byText.size >= 4) break;
    if (!byText.has(normalizeBluff(d))) {
      byText.set(normalizeBluff(d), { id: `DECOY_${idx++}`, text: d.toLowerCase(), authorIds: [], isTruth: false });
    }
  }

  const choices = [...byText.values()].sort(() => Math.random() - 0.5);
  // Ids go to every phone and the TV, so after shuffling they must say nothing
  // about which choice is the truth, a house decoy or a player's lie.
  choices.forEach((c, i) => { c.id = `C${i}`; });
  state.gameData.choices = choices;

  state.hostData = {
    round: state.gameData.round,
    totalRounds: state.gameData.totalRounds,
    prompt: fact.prompt,
    choices: choices.map((c) => ({ id: c.id, text: c.text })),
    timerStart: Date.now(),
    timerDuration: VOTE_TIME,
    autoAdvanceAt: Date.now() + VOTE_TIME * 1000,
    autoAdvanceAction: 'FORCE_BLUFF_RESULTS',
  };

  openAudienceVote(state, {
    key: `bluff-${state.gameData.round}`,
    prompt: fact.prompt,
    choices: choices.map((c) => ({ id: c.id, label: c.text })),
  });

  for (const pid of state.playerOrder) {
    state.playerData[pid] = {
      phase: 'VOTING',
      prompt: fact.prompt,
      voted: false,
      choices: choices
        .filter((c) => !c.authorIds.includes(pid))
        .map((c) => ({ id: c.id, text: c.text })),
    };
  }
}

function resolveBluffRound(state: GameState) {
  state.phase = 'ROUND_RESULTS';
  const fact = state.gameData.facts[state.gameData.round - 1] as BluffFact;
  const choices: { id: string; text: string; authorIds: string[]; isTruth: boolean }[] = state.gameData.choices;
  const votes: Record<string, string> = state.gameData.votes;

  const truthId = choices.find((c) => c.isTruth)?.id;
  const audience = closeAudienceVote(state, `bluff-${state.gameData.round}`);
  for (const [aid, choice] of Object.entries(audience.votes)) {
    const member = state.audience?.[aid];
    if (member && choice === truthId) member.score++;
  }

  const revealed = choices.map((c) => {
    const fooledIds = Object.keys(votes).filter((voterId) => votes[voterId] === c.id);
    if (c.isTruth) {
      for (const voterId of fooledIds) {
        if (state.players[voterId]) {
          state.players[voterId].score += 750;
          bumpStat(state, 'correct', voterId);
        }
      }
    } else if (c.authorIds.length > 0 && fooledIds.length > 0) {
      for (const authorId of c.authorIds) {
        if (state.players[authorId]) {
          state.players[authorId].score += fooledIds.length * 400;
          bumpStat(state, 'votes', authorId, fooledIds.length);
        }
      }
    }
    return {
      ...c,
      voterIds: fooledIds,
    };
  });

  state.hostData = {
    round: state.gameData.round,
    totalRounds: state.gameData.totalRounds,
    prompt: fact.prompt,
    truth: fact.truth,
    revealed,
    timerStart: Date.now(),
    timerDuration: 10,
    autoAdvanceAt: Date.now() + 10_000,
    autoAdvanceAction: 'NEXT_BLUFF_ROUND',
  };

  for (const pid of state.playerOrder) {
    const pickedId = votes[pid];
    const pickedTruth = !!pickedId && pickedId === truthId;
    const myBluff = revealed.find((r) => r.authorIds.includes(pid));
    const fooledCount = myBluff?.voterIds.length || 0;
    state.playerData[pid] = {
      phase: 'ROUND_RESULTS',
      pickedTruth,
      fooledCount,
      truth: fact.truth,
      message: `${pickedTruth ? '✅ You found the truth (+750)!' : pickedId ? '❌ You fell for a bluff!' : '⏰ You didn’t vote this round.'}${
        fooledCount > 0 ? ` 🤥 Your bluff fooled ${fooledCount} player${fooledCount > 1 ? 's' : ''} (+${fooledCount * 400})!` : ''
      }`,
    };
  }
}
