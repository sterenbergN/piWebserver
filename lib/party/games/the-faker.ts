import { GameState } from '../types';
import { getRandomPrompts } from '../prompts';

const TOTAL_ROUNDS = 3;

export const fakerLogic = {
  onStart: async (state: GameState) => {
    if (state.playerOrder.length < 3) return;

    // Initialize multi-round tracking
    state.gameData = {
      round: 1,
      totalRounds: TOTAL_ROUNDS,
      eliminatedPlayers: [] as string[],   // players voted out
      roundHistory: [] as any[],            // per-round results for final screen
      activePlayers: [...state.playerOrder],
      // Per-round state (reset each round)
      task: null,
      fakerId: null,
      votes: {},
    };

    await startNewFakerRound(state);
  },

  processAction: async (state: GameState, playerId: string, action: any) => {
    switch (action.type) {

      case 'PROCEED_TO_ACTION':
        if (state.phase !== 'TASK_DELIVERY') return;
        state.phase = 'ACTION';
        state.hostData = {
          message: '3... 2... 1... GO!',
          subMessage: 'Perform your action and FREEZE! Look around — who is blending in?',
          round: state.gameData.round,
          totalRounds: state.gameData.totalRounds,
          eliminatedPlayers: state.gameData.eliminatedPlayers,
          timerStart: Date.now(),
          timerDuration: 7,
          autoAdvanceAt: Date.now() + 7_000,
          autoAdvanceAction: 'PROCEED_TO_VOTING',
        };
        for (const pid of state.gameData.activePlayers) {
          state.playerData[pid] = {
            ...state.playerData[pid],
            showAction: true,
            instruction: 'Perform your action NOW and FREEZE!',
          };
        }
        break;

      case 'PROCEED_TO_VOTING':
        if (state.phase !== 'ACTION') return;
        state.phase = 'VOTING';
        state.gameData.votes = {};
        state.hostData = {
          message: 'Time to vote!',
          subMessage: 'Who do you think is The Faker? Vote on your phones!',
          round: state.gameData.round,
          totalRounds: state.gameData.totalRounds,
          eliminatedPlayers: state.gameData.eliminatedPlayers,
          timerStart: Date.now(),
          timerDuration: 45,
          autoAdvanceAt: Date.now() + 45_000,
          autoAdvanceAction: 'FORCE_FAKER_RESULTS',
        };
        for (const pid of state.gameData.activePlayers) {
          state.playerData[pid] = {
            ...state.playerData[pid],
            phase: 'VOTING',
            activePlayers: state.gameData.activePlayers,
          };
        }
        break;

      case 'SUBMIT_VOTE':
        if (state.phase !== 'VOTING') return;
        // Only active non-eliminated players can vote
        if (!state.gameData.activePlayers.includes(playerId)) return;
        state.gameData.votes[playerId] = action.votedFor;
        // Auto-advance when everyone active has voted
        if (Object.keys(state.gameData.votes).length >= state.gameData.activePlayers.length) {
          calculateFakerRoundResult(state);
        }
        break;

      case 'FORCE_FAKER_RESULTS':
        if (state.phase !== 'VOTING') return;
        calculateFakerRoundResult(state);
        break;

      case 'NEXT_FAKER_ROUND':
        if (state.phase !== 'RESULTS') return;
        // Check if we should continue or end the game
        const remaining = state.gameData.activePlayers.filter(
          (pid: string) => !state.gameData.eliminatedPlayers.includes(pid)
        );
        if (state.gameData.round >= TOTAL_ROUNDS || remaining.length <= 2) {
          endFakerGame(state);
        } else {
          state.gameData.round++;
          state.gameData.activePlayers = remaining;
          await startNewFakerRound(state);
        }
        break;

      case 'END_FAKER_GAME':
        endFakerGame(state);
        break;

      case 'PLAY_AGAIN':
        if (playerId !== state.hostId) return;
        state.phase = 'LOBBY';
        state.hostData = {};
        state.playerData = {};
        state.gameData = {};
        for (const pid of state.playerOrder) state.players[pid].score = 0;
        break;
    }
  },
};

async function startNewFakerRound(state: GameState) {
  const activePlayers = state.gameData.activePlayers;
  const [task] = await getRandomPrompts('the-faker', 1);
  // Keep existing faker if possible, otherwise pick new
  let fakerId = state.gameData.fakerId;
  if (!fakerId || !activePlayers.includes(fakerId)) {
    fakerId = activePlayers[Math.floor(Math.random() * activePlayers.length)];
  }

  state.gameData.task = task;
  state.gameData.fakerId = fakerId;
  state.gameData.votes = {};
  state.phase = 'TASK_DELIVERY';

  state.hostData = {
    message: 'Check your devices!',
    subMessage: 'Everyone received a secret task — except one person. Do NOT say it out loud!',
    round: state.gameData.round,
    totalRounds: state.gameData.totalRounds,
    eliminatedPlayers: state.gameData.eliminatedPlayers,
    timerStart: Date.now(),
    timerDuration: 8,
    autoAdvanceAt: Date.now() + 8_000,
    autoAdvanceAction: 'PROCEED_TO_ACTION',
  };

  // Give each active player their role
  for (const pid of state.playerOrder) {
    if (state.gameData.eliminatedPlayers.includes(pid)) {
      state.playerData[pid] = {
        role: 'ELIMINATED',
        message: 'You have been eliminated. Watch the screen!',
      };
    } else if (pid === fakerId) {
      state.playerData[pid] = {
        role: 'FAKER', phase: 'TASK_DELIVERY',
        round: state.gameData.round,
        instruction: 'You are THE FAKER — you got NO prompt. Blend in and try to guess the task!',
        showAction: false,
      };
    } else {
      state.playerData[pid] = {
        role: 'INNOCENT', phase: 'TASK_DELIVERY',
        round: state.gameData.round,
        instruction: 'Your task:',
        prompt: task,
        showAction: false,
      };
    }
  }
}

function calculateFakerRoundResult(state: GameState) {
  state.phase = 'RESULTS';
  const fakerId = state.gameData.fakerId;
  const votes = state.gameData.votes;
  const activePlayers: string[] = state.gameData.activePlayers;

  // Tally votes
  const voteCounts: Record<string, number> = {};
  for (const pid of activePlayers) voteCounts[pid] = 0;
  for (const voterId in votes) {
    const target = votes[voterId];
    voteCounts[target] = (voteCounts[target] || 0) + 1;
  }

  const totalVotes = Object.values(votes).length;
  const majorityThreshold = totalVotes / 2; // "more than half"

  // Find who (if anyone) exceeded majority
  let eliminated: string | null = null;
  for (const pid of activePlayers) {
    if (voteCounts[pid] > majorityThreshold) {
      eliminated = pid;
      break;
    }
  }

  const fakerCaught = eliminated === fakerId;
  const fakerEliminated = eliminated !== null;

  // Award points
  if (fakerCaught) {
    // Innocents who voted correctly get 1000 pts
    for (const pid of activePlayers) {
      if (pid !== fakerId && votes[pid] === fakerId) {
        state.players[pid].score += 1000;
      }
    }
  } else {
    // Faker escapes: faker gets 1500 pts
    state.players[fakerId].score += 1500;
  }

  // Apply elimination
  if (eliminated) {
    state.gameData.eliminatedPlayers.push(eliminated);
  }

  // Track history
  state.gameData.roundHistory.push({
    round: state.gameData.round,
    task: state.gameData.task,
    fakerId,
    eliminated,
    fakerCaught,
    voteCounts,
  });

  // Schedule auto-advance to next round (8s)
  const remaining = activePlayers.filter(
    (pid: string) => !state.gameData.eliminatedPlayers.includes(pid)
  );
  const isGameOver = state.gameData.round >= TOTAL_ROUNDS || remaining.length <= 2;

  state.hostData = {
    round: state.gameData.round,
    totalRounds: state.gameData.totalRounds,
    fakerId,
    task: state.gameData.task,
    eliminated,
    fakerCaught,
    fakerEliminated,
    voteCounts,
    eliminatedPlayers: state.gameData.eliminatedPlayers,
    isGameOver,
    timerStart: Date.now(),
    timerDuration: 10,
    autoAdvanceAt: Date.now() + 10_000,
    autoAdvanceAction: isGameOver ? 'END_FAKER_GAME' : 'NEXT_FAKER_ROUND',
  };

  // Notify players
  for (const pid of state.playerOrder) {
    const isEliminated = pid === eliminated;
    const wasFaker = pid === fakerId;
    state.playerData[pid] = {
      phase: 'RESULTS',
      fakerCaught,
      isEliminated,
      wasFaker,
      eliminated,
      fakerName: state.players[fakerId]?.name,
      eliminatedName: eliminated ? state.players[eliminated]?.name : null,
      message: buildPlayerResultMessage(pid, fakerId, eliminated, fakerCaught, votes),
    };
  }
}

function buildPlayerResultMessage(pid: string, fakerId: string, eliminated: string | null, fakerCaught: boolean, votes: Record<string, string>): string {
  if (pid === fakerId) {
    return fakerCaught ? 'You were caught! 🚔' : 'You escaped! 🏃';
  }
  if (pid === eliminated && pid !== fakerId) {
    return 'You were eliminated — but you were innocent! 😱';
  }
  if (fakerCaught && votes[pid] === fakerId) return 'You caught the Faker! +1000 pts 🎯';
  if (fakerCaught) return 'The Faker was caught!';
  return 'The Faker got away!';
}

function endFakerGame(state: GameState) {
  state.phase = 'FINAL_RESULTS';
  state.hostData = {
    message: 'Game Over!',
    roundHistory: state.gameData.roundHistory,
    eliminatedPlayers: state.gameData.eliminatedPlayers,
  };
  for (const pid of state.playerOrder) {
    state.playerData[pid] = { phase: 'FINAL_RESULTS' };
  }
}
