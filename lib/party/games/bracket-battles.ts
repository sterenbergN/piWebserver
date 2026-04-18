import { GameState } from '../types';
import { getRandomPrompts } from '../prompts';

const BOT_ANSWERS = [
  "A potato", "My mom", "Nothing at all", "Just a guy named Greg",
  "A very angry goose", "Taxes", "A wet sock", "The lingering feeling of dread",
  "Beans", "A single slice of cheese", "Shrek", "The entire internet"
];

function shuffle<T>(array: T[]): T[] {
  return array.sort(() => Math.random() - 0.5);
}

export const bracketBattlesLogic = {
  onStart: async (state: GameState) => {
    if (state.playerOrder.length < 3) return;

    const bracketSize = state.playerOrder.length <= 8 ? 8 : 16;
    const promptsNeeded = Math.ceil(bracketSize / 2) + 10;
    const prompts = await getRandomPrompts('bracket-battles', promptsNeeded);
    
    state.phase = 'PROMPTING';
    const timerDuration = 60;
    
    const playerPrompts: Record<string, string> = {};
    const shuffledPlayers = shuffle([...state.playerOrder]);
    
    for (let i = 0; i < shuffledPlayers.length; i++) {
      const promptIndex = Math.floor(i / 2);
      playerPrompts[shuffledPlayers[i]] = prompts[promptIndex];
    }
    
    state.hostData = {
      message: 'Check your devices!',
      subMessage: 'Everyone write an answer to your unique prompt:',
      timerStart: Date.now(),
      timerDuration,
      autoAdvanceAt: Date.now() + timerDuration * 1000,
      autoAdvanceAction: 'FORCE_PREDICTION',
    };

    state.gameData = {
      prompts,
      nextPromptIndex: Math.ceil(bracketSize / 2),
      playerPrompts,
      answers: {}, // playerId -> answer
      predictions: {}, // playerId -> matchNodeId
      bracketSize,
      bracket: [], // Array of match nodes
      currentMatchId: null,
      votes: {}, // playerId -> votedForAnswerId
    };

    for (const pid of state.playerOrder) {
      state.playerData[pid] = {
        phase: 'PROMPTING',
        prompt: playerPrompts[pid],
      };
      state.players[pid].score = 0;
    }
  },

  processAction: async (state: GameState, playerId: string, action: any) => {
    switch (action.type) {
      case 'SUBMIT_ANSWER': {
        if (state.phase !== 'PROMPTING') return;
        state.gameData.answers[playerId] = action.answer;
        state.playerData[playerId].phase = 'WAITING';
        
        // Check if all players answered
        if (Object.keys(state.gameData.answers).length >= state.playerOrder.length) {
          setupBracketAndPredictions(state);
        }
        break;
      }
      
      case 'FORCE_PREDICTION': {
        if (state.phase !== 'PROMPTING') return;
        // Fill in missing answers
        for (const pid of state.playerOrder) {
          if (!state.gameData.answers[pid]) {
            state.gameData.answers[pid] = "Too slow!";
          }
        }
        setupBracketAndPredictions(state);
        break;
      }

      case 'SUBMIT_PREDICTION': {
        if (state.phase !== 'PREDICTION') return;
        state.gameData.predictions[playerId] = action.predictionId;
        state.playerData[playerId].phase = 'WAITING';
        
        if (Object.keys(state.gameData.predictions).length >= state.playerOrder.length) {
          startNextMatch(state);
        }
        break;
      }

      case 'FORCE_MATCHUP': {
        if (state.phase !== 'PREDICTION') return;
        startNextMatch(state);
        break;
      }

      case 'SUBMIT_VOTE': {
        if (state.phase !== 'MATCHUP') return;
        state.gameData.votes[playerId] = action.voteId;
        // Check if everyone voted
        if (Object.keys(state.gameData.votes).length >= state.playerOrder.length) {
          resolveMatch(state);
        }
        break;
      }

      case 'FORCE_RESOLVE_MATCH': {
        if (state.phase !== 'MATCHUP') return;
        resolveMatch(state);
        break;
      }

      case 'SUBMIT_TIEBREAKER': {
        if (state.phase !== 'TIEBREAKER') return;
        // the action carries how many clicks they did
        state.gameData.tiebreakerTaps = state.gameData.tiebreakerTaps || {};
        state.gameData.tiebreakerTaps[playerId] = (state.gameData.tiebreakerTaps[playerId] || 0) + 1;
        break;
      }

      case 'RESOLVE_TIEBREAKER': {
        if (state.phase !== 'TIEBREAKER') return;
        resolveTiebreaker(state);
        break;
      }

      case 'NEXT_MATCH': {
        if (state.phase !== 'MATCH_RESULT') return;
        startNextMatch(state);
        break;
      }

      case 'PLAY_AGAIN': {
        if (playerId !== state.hostId) return;
        state.phase = 'LOBBY';
        state.hostData = {};
        state.playerData = {};
        state.gameData = {};
        for (const pid of state.playerOrder) state.players[pid].score = 0;
        break;
      }
    }
  }
};

function setupBracketAndPredictions(state: GameState) {
  state.phase = 'PREDICTION';
  const size = state.gameData.bracketSize; // 8 or 16
  
  let entries = Object.keys(state.gameData.answers).map(pid => ({
    id: pid,
    answer: state.gameData.answers[pid],
    isBot: false,
  }));

  // Pad with bots
  let botIdx = 0;
  const shuffledBots = shuffle([...BOT_ANSWERS]);
  while (entries.length < size) {
    entries.push({
      id: `bot-${botIdx}`,
      answer: shuffledBots[botIdx % shuffledBots.length],
      isBot: true,
    });
    botIdx++;
  }

  // Shuffle entries to randomize bracket
  entries = shuffle(entries);

  // Build bracket tree. 
  // Node IDs:
  // For 8 items: 
  // QF: 0,1,2,3
  // SF: 4,5
  // F: 6
  // Match `i` feeds into math `Math.floor(i/2) + (size/2)`
  
  const bracket: any[] = [];
  const numMatches = size - 1; // 7 or 15
  for (let i = 0; i < numMatches; i++) {
    bracket.push({
      id: i,
      answer1: null as any,
      answer2: null as any,
      winnerId: null as string | null,
      prompt: null as string | null,
      resolved: false
    });
  }

  // Populate first round
  for (let i = 0; i < size / 2; i++) {
    bracket[i].answer1 = entries[i * 2];
    bracket[i].answer2 = entries[i * 2 + 1];
    const pid1 = entries[i * 2].id;
    const pid2 = entries[i * 2 + 1].id;
    bracket[i].prompt = state.gameData.playerPrompts[pid1] || state.gameData.playerPrompts[pid2] || state.gameData.prompts[0];
  }

  state.gameData.bracket = bracket;

  // Give predictions
  state.hostData = {
    message: 'The Bracket is set!',
    subMessage: 'Look at your device and predict the champion!',
    bracketSize: size,
    bracket,
    entries,
    timerStart: Date.now(),
    timerDuration: 30,
    autoAdvanceAt: Date.now() + 30_000,
    autoAdvanceAction: 'FORCE_MATCHUP',
  };

  for (const pid of state.playerOrder) {
    state.playerData[pid] = {
      phase: 'PREDICTION',
      entries,
    };
  }
}

function startNextMatch(state: GameState) {
  const bracket = state.gameData.bracket;
  // Find first unresolved match where both answers are ready
  let nextMatchIdx = -1;
  for (let i = 0; i < bracket.length; i++) {
    if (!bracket[i].resolved && bracket[i].answer1 && bracket[i].answer2) {
      nextMatchIdx = i;
      break;
    }
  }

  if (nextMatchIdx === -1) {
    endBracketGame(state);
    return;
  }

  state.phase = 'MATCHUP';
  state.gameData.currentMatchId = nextMatchIdx;
  state.gameData.votes = {};

  const match = bracket[nextMatchIdx];

  if (!match.prompt) {
     match.prompt = state.gameData.prompts[state.gameData.nextPromptIndex] || "Which of these is simply greater?";
     state.gameData.nextPromptIndex++;
  }

  // Randomize ordering on screen
  const answers = shuffle([match.answer1, match.answer2]);

  let roundName = 'Round';
  const size = state.gameData.bracketSize;
  const numMatches = size - 1;
  if (nextMatchIdx === numMatches - 1) roundName = 'The Championship Phase!';
  else if (nextMatchIdx >= numMatches - 3) roundName = 'Semi-Finals';
  else if (nextMatchIdx >= size / 2) roundName = 'Quarter-Finals';

  state.hostData = {
    message: roundName,
    matchId: nextMatchIdx,
    prompt: match.prompt,
    answers,
    bracketSize: size,
    bracket,
    timerStart: Date.now(),
    timerDuration: 15,
    autoAdvanceAt: Date.now() + 15_000,
    autoAdvanceAction: 'FORCE_RESOLVE_MATCH',
  };

  for (const pid of state.playerOrder) {
    state.playerData[pid] = {
      phase: 'MATCHUP',
      matchId: nextMatchIdx,
      prompt: match.prompt,
      answers,
    };
  }
}

function resolveMatch(state: GameState) {
  const matchId = state.gameData.currentMatchId;
  const match = state.gameData.bracket[matchId];
  const votes = state.gameData.votes;

  let v1 = 0;
  let v2 = 0;
  for (const pid in votes) {
    if (votes[pid] === match.answer1.id) v1++;
    if (votes[pid] === match.answer2.id) v2++;
  }

  if (v1 === v2) {
    startTiebreaker(state, match, v1, v2);
    return;
  }

  const winner = v1 > v2 ? match.answer1 : match.answer2;
  const loser = v1 > v2 ? match.answer2 : match.answer1;
  finalizeMatchWinner(state, matchId, winner, loser, votes, v1, v2);
}

function startTiebreaker(state: GameState, match: any, v1: number, v2: number) {
  state.phase = 'TIEBREAKER';
  state.gameData.tiebreakerTaps = {};
  state.gameData.tiebreakerVotes = { v1, v2 };
  
  state.hostData = {
    message: 'TIEBREAKER!',
    subMessage: 'Mash the button on your device to break the tie!',
    answers: [match.answer1, match.answer2],
    timerStart: Date.now(),
    timerDuration: 5,
    autoAdvanceAt: Date.now() + 5_000,
    autoAdvanceAction: 'RESOLVE_TIEBREAKER',
  };

  for (const pid of state.playerOrder) {
    state.playerData[pid] = {
      phase: 'TIEBREAKER',
      answers: [match.answer1, match.answer2]
    };
  }
}

function resolveTiebreaker(state: GameState) {
  const matchId = state.gameData.currentMatchId;
  const match = state.gameData.bracket[matchId];
  const taps = state.gameData.tiebreakerTaps;
  const votes = state.gameData.votes;

  // sum taps for people who voted for 1 vs 2
  let t1 = 0;
  let t2 = 0;

  for (const pid of state.playerOrder) {
    if (votes[pid] === match.answer1.id) t1 += (taps[pid] || 0);
    if (votes[pid] === match.answer2.id) t2 += (taps[pid] || 0);
  }

  // if STILL tied, pick random
  let winner, loser;
  if (t1 > t2) { winner = match.answer1; loser = match.answer2; }
  else if (t2 > t1) { winner = match.answer2; loser = match.answer1; }
  else {
    winner = Math.random() > 0.5 ? match.answer1 : match.answer2;
    loser = winner === match.answer1 ? match.answer2 : match.answer1;
  }

  finalizeMatchWinner(state, matchId, winner, loser, votes, state.gameData.tiebreakerVotes.v1, state.gameData.tiebreakerVotes.v2);
}

function finalizeMatchWinner(state: GameState, matchId: number, winner: any, loser: any, votes: any, v1: number, v2: number) {
  state.phase = 'MATCH_RESULT';
  const bracket = state.gameData.bracket;
  
  bracket[matchId].resolved = true;
  bracket[matchId].winnerId = winner.id;

  // Advance winner to next round
  // match `i` feeds into `Math.floor(i/2) + (size/2)`
  const size = state.gameData.bracketSize;
  const numMatches = size - 1;
  if (matchId < numMatches - 1) {
    const nextMatchId = Math.floor(matchId / 2) + (size / 2);
    if (matchId % 2 === 0) bracket[nextMatchId].answer1 = winner;
    else bracket[nextMatchId].answer2 = winner;
  }

  let roundValue = 500;
  if (matchId >= numMatches - 3) roundValue = 1000;
  if (matchId === numMatches - 1) roundValue = 2000;

  // Award points to the AUTHOR of the winning answer (if not a bot)
  if (!winner.isBot && state.players[winner.id]) {
    state.players[winner.id].score += roundValue;
  }

  state.hostData = {
    message: 'Winner Advances!',
    winner,
    loser,
    votes: {
      [winner.id]: winner === bracket[matchId].answer1 ? v1 : v2,
      [loser.id]: loser === bracket[matchId].answer1 ? v1 : v2
    },
    timerStart: Date.now(),
    timerDuration: 6,
    autoAdvanceAt: Date.now() + 6_000,
    autoAdvanceAction: 'NEXT_MATCH',
  };

  for (const pid of state.playerOrder) {
    state.playerData[pid] = {
      phase: 'MATCH_RESULT',
      winner,
      loser
    };
  }
}

function endBracketGame(state: GameState) {
  state.phase = 'FINAL_RESULTS';
  const size = state.gameData.bracketSize;
  const championId = state.gameData.bracket[size - 2].winnerId;
  const champion = state.gameData.bracket[size - 2].answer1.id === championId ? state.gameData.bracket[size - 2].answer1 : state.gameData.bracket[size - 2].answer2;

  // Award prediction points
  for (const pid of state.playerOrder) {
    if (state.gameData.predictions[pid] === championId) {
      state.players[pid].score += 3000;
    }
  }

  state.hostData = {
    message: 'Tournament Champion!',
    champion,
    predictions: state.gameData.predictions,
  };

  for (const pid of state.playerOrder) {
    state.playerData[pid] = {
      phase: 'FINAL_RESULTS',
      champion,
      predictedCorrectly: state.gameData.predictions[pid] === championId
    };
  }
}
