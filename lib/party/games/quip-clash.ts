import { GameState } from '../types';
import { getRandomPrompts } from '../prompts';

export const quipClashLogic = {
  onStart: async (state: GameState, isNextRound = false) => {
    if (state.playerOrder.length < 3) return;

    const targetRounds = state.gameData?.targetRounds || 1;
    const currentRound = isNextRound && state.gameData ? state.gameData.currentRound + 1 : 0;


    // We need 2 prompts per player. 
    // Usually each prompt goes to exactly 2 players.
    // So we need playerOrder.length prompts total.
    const prompts = await getRandomPrompts('quip-clash', state.playerOrder.length);
    
    // Assign each player 2 prompts
    const playerPrompts: Record<string, string[]> = {};
    const promptOwners: Record<string, string[]> = {}; // prompt -> [] of playerIds
    
    // Circular assignment: player 0 gets prompt 0,1. player 1 gets 1,2 ... player N gets N, 0.
    for (let i = 0; i < state.playerOrder.length; i++) {
      const pid = state.playerOrder[i];
      const p1 = prompts[i];
      const p2 = prompts[(i + 1) % prompts.length];
      
      playerPrompts[pid] = [p1, p2];
      
      if (!promptOwners[p1]) promptOwners[p1] = [];
      promptOwners[p1].push(pid);
      if (!promptOwners[p2]) promptOwners[p2] = [];
      promptOwners[p2].push(pid);
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
      answers: {}, // prompt -> { playerId: answer }
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
        prompts: playerPrompts[pid],
        answers: ['', '']
      };
      if (!isNextRound) {
        state.players[pid].score = 0; // Reset score only on a fresh new game, not between rounds
      }
    }
  },

  processAction: async (state: GameState, playerId: string, action: any) => {
    switch (action.type) {
      case 'SUBMIT_ANSWER':
        if (state.phase !== 'PROMPTING') return;
        const { promptIndex, answer } = action; // 0 or 1
        const prompt = state.playerData[playerId].prompts[promptIndex];
        
        if (!state.gameData.answers[prompt]) {
          state.gameData.answers[prompt] = {};
        }
        state.gameData.answers[prompt][playerId] = answer;
        
        state.playerData[playerId].answers[promptIndex] = answer;
        
        // Check if all answers from all players are submitted
        let complete = true;
        for (const pid of state.playerOrder) {
          if (!state.playerData[pid].answers[0] || !state.playerData[pid].answers[1]) {
            complete = false;
            break;
          }
        }
        if (complete) {
          startVotingPhase(state);
        }
        break;

      case 'FORCE_VOTING': // Host can force time
        if (playerId === state.hostId && state.phase === 'PROMPTING') {
             // Fill missing answers with "Too slow!"
             for (const pid of state.playerOrder) {
                 for (let i=0; i<2; i++) {
                     if (!state.playerData[pid].answers[i]) {
                         const p = state.playerData[pid].prompts[i];
                         if (!state.gameData.answers[p]) state.gameData.answers[p] = {};
                         state.gameData.answers[p][pid] = "Too slow!";
                     }
                 }
             }
             startVotingPhase(state);
        }
        break;

      case 'SUBMIT_VOTE':
        if (state.phase !== 'VOTING') return;
        const currentIdx = state.gameData.currentPromptIndex;
        if (!state.gameData.votes[currentIdx]) {
          state.gameData.votes[currentIdx] = {};
        }
        
        const currentPrompt = state.gameData.prompts[currentIdx];
        const owners = state.gameData.promptOwners[currentPrompt];
        
        // Cannot vote if you are an owner
        if (owners.includes(playerId)) return;
        
        state.gameData.votes[currentIdx][playerId] = action.votedForId;
        
        // Check if everyone (except the 2 authors) has voted
        const votersCount = Object.keys(state.gameData.votes[currentIdx]).length;
        if (votersCount >= state.playerOrder.length - 2) {
          calculateRoundVotes(state);
        }
        break;
        
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
  const currentPrompt = state.gameData.prompts[state.gameData.currentPromptIndex];
  const owners = state.gameData.promptOwners[currentPrompt]; // should be 2 players
  const answers = state.gameData.answers[currentPrompt];
  
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
  const owners = state.gameData.promptOwners[currentPrompt];
  const votes = state.gameData.votes[currentIdx] || {};

  // Tally votes
  const tally: Record<string, number> = {};
  for (const pid of owners) tally[pid] = 0;
  
  for (const voterId in votes) {
    const votedFor = votes[voterId];
    tally[votedFor] = (tally[votedFor] || 0) + 1;
  }

  // Award points (e.g. 500 per vote)
  for (const pid of owners) {
    state.players[pid].score += tally[pid] * 500;
  }

  // If one got all votes ("Quiplash")
  const totalVotes = Object.keys(votes).length;
  let quipLash = null;
  if (totalVotes > 0) {
      for (const pid of owners) {
          if (tally[pid] === totalVotes && totalVotes >= 3) {
             quipLash = pid;
             state.players[pid].score += 1000; // Bonus
          }
      }
  }

  // Auto-advance to next prompt after 7s
  state.hostData = {
    prompt: currentPrompt,
    tally,
    answers: state.gameData.answers[currentPrompt],
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
