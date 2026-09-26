import { GameState } from '../types';
import { getRandomPrompts } from '../prompts';
import { closeAudienceVote, openAudienceVote } from '../audience';
import { bumpStat } from '../awards';

/** Bonus for the answer the audience liked best. */
const AUDIENCE_FAVORITE_BONUS = 250;
const pollKey = (state: GameState) => `quip-${state.gameData.currentRound}-${state.gameData.currentPromptIndex}`;

export const quipClashLogic = {
  onStart: async (state: GameState, isNextRound = false) => {
    if (state.playerOrder.length < 3) return;

    const targetRounds = state.gameData?.targetRounds || 1;
    const currentRound = isNextRound && state.gameData ? state.gameData.currentRound + 1 : 0;


    // We need 2 prompts per player. 
    // Usually each prompt goes to exactly 2 players.
    // So we need playerOrder.length prompts total.
    const prompts = await getRandomPrompts('quip-clash', state.playerOrder.length, state.settings?.packs);
    
    // Circular assignment: player i answers prompts i and i+1, so every prompt
    // has exactly two authors. Everything is keyed by prompt index (not text)
    // so a small prompt pool that repeats a prompt can't merge two matchups.
    const n = state.playerOrder.length;
    const playerPromptIdx: Record<string, number[]> = {};
    const promptOwners: string[][] = prompts.map(() => []);
    for (let i = 0; i < n; i++) {
      const pid = state.playerOrder[i];
      const idx = [i, (i + 1) % n];
      playerPromptIdx[pid] = idx;
      for (const k of idx) promptOwners[k].push(pid);
    }

    state.phase = 'PROMPTING';
    state.hostData = {
      message: 'Check your devices and answer your prompts!',
      timerStart: Date.now(),
      timerDuration: 60,
      autoAdvanceAt: Date.now() + 60_000,
      autoAdvanceAction: 'FORCE_VOTING',
    };

    state.gameData = {
      ...state.gameData, 
      prompts,
      promptOwners,
      answers: {}, // promptIndex -> { playerId: answer }
      currentPromptIndex: 0,
      totalPrompts: prompts.length,
      votes: {}, // promptIndex -> { voterId: votedForPlayerId }
      currentRound,
      targetRounds,
    };

    // Initialize player data
    for (const pid of state.playerOrder) {
      state.playerData[pid] = {
        phase: 'PROMPTING',
        prompts: playerPromptIdx[pid].map((k) => prompts[k]),
        promptIdx: playerPromptIdx[pid],
        answers: ['', '']
      };
      if (!isNextRound) {
        state.players[pid].score = 0; // Reset score only on a fresh new game, not between rounds
      }
    }
  },

  processAction: async (state: GameState, playerId: string, action: any) => {
    switch (action.type) {
      case 'SUBMIT_ANSWER': {
        if (state.phase !== 'PROMPTING') return;
        const { promptIndex } = action; // 0 or 1
        const answer = typeof action.answer === 'string' ? action.answer.trim() : '';
        const pd = state.playerData[playerId];
        if (!pd || (promptIndex !== 0 && promptIndex !== 1) || !answer) return;
        const k = pd.promptIdx[promptIndex];
        if (!state.gameData.answers[k]) state.gameData.answers[k] = {};
        state.gameData.answers[k][playerId] = answer;
        pd.answers[promptIndex] = answer;

        const complete = state.playerOrder.every(
          (pid) => state.playerData[pid]?.answers?.[0] && state.playerData[pid]?.answers?.[1],
        );
        if (complete) startVotingPhase(state);
        break;
      }

      case 'FORCE_VOTING': // Host (or the prompt timer) ends the writing phase
        if (playerId !== state.hostId || state.phase !== 'PROMPTING') return;
        for (const pid of state.playerOrder) {
          const pd = state.playerData[pid];
          for (let i = 0; i < 2; i++) {
            if (pd.answers[i]) continue;
            const k = pd.promptIdx[i];
            if (!state.gameData.answers[k]) state.gameData.answers[k] = {};
            state.gameData.answers[k][pid] = 'Too slow!';
          }
        }
        startVotingPhase(state);
        break;

      case 'SUBMIT_VOTE': {
        if (state.phase !== 'VOTING') return;
        const currentIdx = state.gameData.currentPromptIndex;
        const owners: string[] = state.gameData.promptOwners[currentIdx];
        // Authors can't vote on their own matchup, and a vote must name one of them.
        if (owners.includes(playerId) || !owners.includes(action.votedForId)) return;
        if (!state.gameData.votes[currentIdx]) state.gameData.votes[currentIdx] = {};
        state.gameData.votes[currentIdx][playerId] = action.votedForId;

        const votersCount = Object.keys(state.gameData.votes[currentIdx]).length;
        if (votersCount >= state.playerOrder.length - owners.length) calculateRoundVotes(state);
        break;
      }

      case 'NEXT_PROMPT':
        if (state.phase !== 'ROUND_RESULTS') return;
        state.gameData.currentPromptIndex++;
        if (state.gameData.currentPromptIndex >= state.gameData.prompts.length) {
          if (state.gameData.currentRound < (state.gameData.targetRounds - 1)) {
            // Start next round of prompts
            await quipClashLogic.onStart(state, true);
          } else {
            state.phase = 'FINAL_RESULTS';
            state.hostData = { message: 'Game Over! Look at the winners.' };
          }
        } else {
          startVotingRound(state);
        }
        break;
        
      case 'PLAY_AGAIN':
        if (playerId !== state.hostId) return;
        state.phase = 'LOBBY';
        state.hostData = {};
        state.playerData = {};
        state.gameData = {};
        break;

      case 'FORCE_NEXT_VOTE':
        // Auto-advance voting when timer runs out
        if (state.phase !== 'VOTING') return;
        calculateRoundVotes(state);
        break;
    }
  }
};

function startVotingPhase(state: GameState) {
  state.phase = 'VOTING';
  state.gameData.currentPromptIndex = 0;
  startVotingRound(state);
}

function startVotingRound(state: GameState) {
  state.phase = 'VOTING';
  const idx = state.gameData.currentPromptIndex;
  const currentPrompt = state.gameData.prompts[idx];
  const owners: string[] = state.gameData.promptOwners[idx];
  const answers = state.gameData.answers[idx] || {};
  
  // Randomize answer order so we don't know who is who 
  // Normally we'd shuffle, but we can just map it mapping ID -> UI
  const displayAnswers = owners.map((pid: string) => ({
    id: pid,
    answer: answers[pid] || 'Nothing!'
  })).sort(() => Math.random() - 0.5);

  // 30s voting timer per prompt
  state.hostData = {
    prompt: currentPrompt,
    answers: displayAnswers,
    round: state.gameData.currentPromptIndex + 1,
    totalRounds: state.gameData.totalPrompts,
    timerStart: Date.now(),
    timerDuration: 30,
    autoAdvanceAt: Date.now() + 30_000,
    autoAdvanceAction: 'FORCE_NEXT_VOTE',
  };

  openAudienceVote(state, {
    key: pollKey(state),
    prompt: currentPrompt,
    choices: displayAnswers.map((a: { id: string; answer: string }) => ({ id: a.id, label: a.answer })),
  });

  for (const pid of state.playerOrder) {
    if (owners.includes(pid)) {
      state.playerData[pid] = { phase: 'WAITING', message: 'Your prompt is on screen! Shhh!' };
    } else {
      state.playerData[pid] = {
        phase: 'VOTING',
        prompt: currentPrompt,
        answers: displayAnswers
      };
    }
  }
}

function calculateRoundVotes(state: GameState) {
  state.phase = 'ROUND_RESULTS';
  const currentIdx = state.gameData.currentPromptIndex;
  const currentPrompt = state.gameData.prompts[currentIdx];
  const owners: string[] = state.gameData.promptOwners[currentIdx];
  const votes = state.gameData.votes[currentIdx] || {};

  // Tally votes
  const tally: Record<string, number> = {};
  for (const pid of owners) tally[pid] = 0;
  
  for (const voterId in votes) {
    const votedFor = votes[voterId];
    if (votedFor in tally) tally[votedFor]++;
  }

  // Award points (e.g. 500 per vote)
  for (const pid of owners) {
    state.players[pid].score += tally[pid] * 500;
    bumpStat(state, 'votes', pid, tally[pid]);
  }

  // If one got all votes ("Quiplash")
  const totalVotes = Object.keys(votes).length;
  let quipLash = null;
  if (totalVotes > 0) {
      for (const pid of owners) {
          if (tally[pid] === totalVotes && totalVotes >= 3) {
             quipLash = pid;
             state.players[pid].score += 1000; // Bonus
             bumpStat(state, 'quiplash', pid);
          }
      }
  }

  const audience = closeAudienceVote(state, pollKey(state));
  if (audience.winner && state.players[audience.winner]) {
    state.players[audience.winner].score += AUDIENCE_FAVORITE_BONUS;
    bumpStat(state, 'audienceFavorite', audience.winner);
  }

  // Auto-advance to next prompt after 7s
  state.hostData = {
    prompt: currentPrompt,
    tally,
    audienceTally: audience.total > 0 ? audience.tally : null,
    // Who voted for which answer, so the TV can show their faces on it.
    voters: Object.fromEntries(owners.map((pid: string) => [pid, Object.keys(votes).filter((v) => votes[v] === pid)])),
    audienceFavorite: audience.winner,
    answers: state.gameData.answers[currentIdx] || {},
    quipLash,
    timerStart: Date.now(),
    timerDuration: 7,
    autoAdvanceAt: Date.now() + 7_000,
    autoAdvanceAction: 'NEXT_PROMPT',
  };

  for (const pid of state.playerOrder) {
    state.playerData[pid] = { phase: 'ROUND_RESULTS' };
  }
}
