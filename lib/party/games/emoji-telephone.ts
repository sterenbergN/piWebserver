import { GameState } from '../types';
import { waitingFor } from '../presence';
import { bumpStat } from '../awards';
import { drawGameContent } from '../prompts';

const TRANSLATE_TIME = 45;
const GUESS_TIME = 45;

const MAX_CLUE_GRAPHEMES = 16;

/** Strip ASCII letters and numbers so the clue is purely emojis & symbols. */
export function sanitizeEmojiClue(input: string): string {
  const stripped = input.replace(/[a-zA-Z0-9]/g, '').replace(/\s+/g, ' ').trim();
  // Cap by grapheme so a multi-codepoint emoji (flags, skin tones, ZWJ) is never cut in half.
  const graphemes = Array.from(new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(stripped), (g) => g.segment);
  return graphemes.slice(0, MAX_CLUE_GRAPHEMES).join('').trim();
}

export const emojiTelephoneLogic = {
  onStart: async (state: GameState) => {
    if (state.playerOrder.length < 3) return;
    const n = state.playerOrder.length;
    const prompts = await drawGameContent('emojiTelephone', n, state.settings?.packs);

    const chains = state.playerOrder.map((pid, idx) => ({
      id: idx,
      originPrompt: prompts[idx % prompts.length],
      translatorId: pid,
      guesserId: state.playerOrder[(idx + 1) % n],
      emojis: '',
      guess: '',
      votes: [] as string[],
    }));

    state.gameData = {
      chains,
      currentRevealIdx: 0,
      favoriteVotes: {} as Record<string, number>,
    };

    state.phase = 'TRANSLATE';
    state.hostData = {
      message: 'Step 1: Translate to Emojis!',
      subMessage: 'Describe your secret phrase using ONLY emojis on your phone.',
      timerStart: Date.now(),
      timerDuration: TRANSLATE_TIME,
      autoAdvanceAt: Date.now() + TRANSLATE_TIME * 1000,
      autoAdvanceAction: 'FORCE_GUESS_PHASE',
    };

    for (let i = 0; i < n; i++) {
      const pid = state.playerOrder[i];
      state.playerData[pid] = {
        phase: 'TRANSLATE',
        prompt: chains[i].originPrompt,
        submitted: null,
      };
    }
  },

  processAction: async (state: GameState, playerId: string, action: any) => {
    switch (action.type) {
      case 'SUBMIT_EMOJIS': {
        if (state.phase !== 'TRANSLATE') return;
        const emojis = sanitizeEmojiClue(typeof action.emojis === 'string' ? action.emojis : '');
        if (!emojis) return;
        const chain = state.gameData.chains.find((c: any) => c.translatorId === playerId);
        if (!chain) return;
        if (!chain.emojis && state.players[playerId]) {
          state.players[playerId].score += 400;
        }
        chain.emojis = emojis;
        state.playerData[playerId] = { ...state.playerData[playerId], submitted: emojis };

        const targets = waitingFor(state, state.playerOrder);
        if (targets.every((pid) => state.gameData.chains.find((c: any) => c.translatorId === pid)?.emojis)) {
          startGuessPhase(state);
        }
        break;
      }

      case 'FORCE_GUESS_PHASE': {
        if (state.phase !== 'TRANSLATE') return;
        for (const c of state.gameData.chains) {
          if (!c.emojis) c.emojis = '🤷❓🛸';
        }
        startGuessPhase(state);
        break;
      }

      case 'SUBMIT_GUESS': {
        if (state.phase !== 'GUESS') return;
        const guess = typeof action.guess === 'string' ? action.guess.trim() : '';
        if (!guess) return;
        const chain = state.gameData.chains.find((c: any) => c.guesserId === playerId);
        if (!chain) return;
        if (!chain.guess && state.players[playerId]) {
          state.players[playerId].score += 400;
        }
        chain.guess = guess;
        state.playerData[playerId] = { ...state.playerData[playerId], submitted: guess };

        const targets = waitingFor(state, state.playerOrder);
        if (targets.every((pid) => state.gameData.chains.find((c: any) => c.guesserId === pid)?.guess)) {
          startChainShowcase(state);
        }
        break;
      }

      case 'FORCE_SHOWCASE': {
        if (state.phase !== 'GUESS') return;
        for (const c of state.gameData.chains) {
          if (!c.guess) c.guess = 'No idea whatsoever!';
        }
        startChainShowcase(state);
        break;
      }

      case 'NEXT_CHAIN': {
        if (state.phase !== 'SHOWCASE') return;
        state.gameData.currentRevealIdx++;
        if (state.gameData.currentRevealIdx >= state.gameData.chains.length) {
          startFavoriteChainVote(state);
        } else {
          showCurrentChain(state);
        }
        break;
      }

      case 'SUBMIT_VOTE': {
        if (state.phase !== 'VOTING') return;
        const chainId = Number(action.chainId);
        const chain = state.gameData.chains[chainId];
        // No voting for a chain you translated or decoded.
        if (!chain || chain.translatorId === playerId || chain.guesserId === playerId) return;
        state.gameData.favoriteVotes[playerId] = chainId;
        state.playerData[playerId] = { ...state.playerData[playerId], voted: true };

        const targets = waitingFor(state, state.playerOrder);
        if (targets.every((pid) => state.gameData.favoriteVotes[pid] !== undefined)) {
          finishEmojiTelephone(state);
        }
        break;
      }

      case 'FORCE_TELEPHONE_END': {
        if (state.phase !== 'VOTING') return;
        finishEmojiTelephone(state);
        break;
      }
    }
  },
};

function startGuessPhase(state: GameState) {
  state.phase = 'GUESS';
  for (const c of state.gameData.chains) {
    if (!c.emojis) c.emojis = '🤷❓🛸';
  }

  state.hostData = {
    message: 'Step 2: Decode the Emojis!',
    subMessage: 'Look at your phone and guess the original phrase from the emojis!',
    timerStart: Date.now(),
    timerDuration: GUESS_TIME,
    autoAdvanceAt: Date.now() + GUESS_TIME * 1000,
    autoAdvanceAction: 'FORCE_SHOWCASE',
  };

  for (const pid of state.playerOrder) {
    const chain = state.gameData.chains.find((c: any) => c.guesserId === pid);
    state.playerData[pid] = {
      phase: 'GUESS',
      emojis: chain?.emojis || '🤷❓',
      translatorName: state.players[chain?.translatorId]?.name,
      submitted: null,
    };
  }
}

function startChainShowcase(state: GameState) {
  for (const c of state.gameData.chains) {
    if (!c.guess) c.guess = 'No idea whatsoever!';
  }
  state.gameData.currentRevealIdx = 0;
  showCurrentChain(state);
}

function showCurrentChain(state: GameState) {
  state.phase = 'SHOWCASE';
  const idx = state.gameData.currentRevealIdx;
  const chain = state.gameData.chains[idx];

  state.hostData = {
    round: idx + 1,
    totalRounds: state.gameData.chains.length,
    chain: {
      ...chain,
      translatorName: state.players[chain.translatorId]?.name || '?',
      guesserName: state.players[chain.guesserId]?.name || '?',
    },
    timerStart: Date.now(),
    timerDuration: 9,
    autoAdvanceAt: Date.now() + 9_000,
    autoAdvanceAction: 'NEXT_CHAIN',
  };

  for (const pid of state.playerOrder) {
    state.playerData[pid] = {
      phase: 'SHOWCASE',
      round: idx + 1,
      totalRounds: state.gameData.chains.length,
      chain: state.hostData.chain,
    };
  }
}

function startFavoriteChainVote(state: GameState) {
  state.phase = 'VOTING';
  const chainsSummary = state.gameData.chains.map((c: any) => ({
    id: c.id,
    originPrompt: c.originPrompt,
    emojis: c.emojis,
    guess: c.guess,
    translatorName: state.players[c.translatorId]?.name || '?',
    guesserName: state.players[c.guesserId]?.name || '?',
  }));

  state.hostData = {
    message: 'You can’t vote for a chain you worked on.',
    chains: chainsSummary,
    timerStart: Date.now(),
    timerDuration: 25,
    autoAdvanceAt: Date.now() + 25_000,
    autoAdvanceAction: 'FORCE_TELEPHONE_END',
  };

  for (const pid of state.playerOrder) {
    state.playerData[pid] = {
      phase: 'VOTING',
      voted: false,
      chains: chainsSummary.filter((_: unknown, i: number) => {
        const c = state.gameData.chains[i];
        return c.translatorId !== pid && c.guesserId !== pid;
      }),
    };
  }
}

function finishEmojiTelephone(state: GameState) {
  for (const chainId of Object.values(state.gameData.favoriteVotes) as number[]) {
    const chain = state.gameData.chains[chainId];
    if (!chain) continue;
    if (state.players[chain.translatorId]) {
      state.players[chain.translatorId].score += 800;
      bumpStat(state, 'votes', chain.translatorId);
    }
    if (state.players[chain.guesserId]) {
      state.players[chain.guesserId].score += 600;
    }
  }
  state.phase = 'FINAL_RESULTS';
  state.hostData = { message: 'Lost in Translation!' };
  for (const pid of state.playerOrder) state.playerData[pid] = { phase: 'FINAL_RESULTS' };
}
