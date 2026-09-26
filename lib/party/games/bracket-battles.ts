import { GameState } from '../types';
import { getRandomPrompts } from '../prompts';
import { closeAudienceVote, openAudienceVote } from '../audience';
import { bumpStat } from '../awards';

const BOT_ANSWERS = [
  "A potato", "My mom", "Nothing at all", "Just a guy named Greg",
  "A very angry goose", "Taxes", "A wet sock", "The lingering feeling of dread",
  "Beans", "A single slice of cheese", "Shrek", "The entire internet"
];

function shuffle<T>(array: T[]): T[] {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

// Players who wrote an answer in this match sit it out; everyone else votes.
function matchVoters(state: GameState, match: any): string[] {
  const ids = [match.answer1?.id, match.answer2?.id];
  return state.playerOrder.filter((pid) => !ids.includes(pid));
}

export const bracketBattlesLogic = {
  onStart: async (state: GameState) => {
    if (state.playerOrder.length < 3) return;

    const bracketSize = state.playerOrder.length <= 8 ? 8 : 16;
    const promptsNeeded = Math.ceil(bracketSize / 2) + 10;
    const prompts = await getRandomPrompts('bracket-battles', promptsNeeded, state.settings?.packs);
    
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
      // Players are paired in this order: the two who share a prompt meet in round one.
      pairOrder: shuffledPlayers,
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
        const answer = typeof action.answer === 'string' ? action.answer.trim() : '';
        if (!answer || state.gameData.answers[playerId]) return;
        state.gameData.answers[playerId] = answer;
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
        const entryIds = (state.hostData.entries || []).map((e: any) => e.id);
        if (!entryIds.includes(action.predictionId)) return;
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
        const match = state.gameData.bracket[state.gameData.currentMatchId];
        const voters = matchVoters(state, match);
        if (!voters.includes(playerId)) return;
        if (action.voteId !== match.answer1.id && action.voteId !== match.answer2.id) return;
        state.gameData.votes[playerId] = action.voteId;
        if (voters.every((pid) => state.gameData.votes[pid])) {
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
        if (state.phase !== 'TIEBREAKER' || !state.gameData.votes[playerId]) return;
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
  
  // Round one pairs the two players who answered the same prompt; an odd
  // player out and the remaining slots are filled with bot answers.
  const shuffledBots = shuffle([...BOT_ANSWERS]);
  let botIdx = 0;
  const bot = () => {
    const entry = { id: `bot-${botIdx}`, answer: shuffledBots[botIdx % shuffledBots.length], isBot: true };
    botIdx++;
    return entry;
  };
  const order: string[] = (state.gameData.pairOrder || state.playerOrder).filter((pid: string) => state.players[pid]);
  const player = (pid: string | undefined) =>
    pid ? { id: pid, answer: state.gameData.answers[pid] || 'Too slow!', isBot: false } : bot();
  const pairs = Array.from({ length: size / 2 }, (_, i) => ({
    entries: [player(order[i * 2]), player(order[i * 2 + 1])],
    prompt: state.gameData.prompts[i] as string,
  }));
  shuffle(pairs);
  const entries = pairs.flatMap((p) => p.entries);

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
    [bracket[i].answer1, bracket[i].answer2] = pairs[i].entries;
    bracket[i].prompt = pairs[i].prompt;
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

  openAudienceVote(state, {
    key: `bracket-${nextMatchIdx}`,
    prompt: match.prompt,
    choices: answers.map((a: any) => ({ id: a.id, label: a.answer })),
  });

  const voters = matchVoters(state, match);
  for (const pid of state.playerOrder) {
    if (!voters.includes(pid)) {
      state.playerData[pid] = { phase: 'WAITING', message: 'Your answer is on screen! Let the crowd decide.' };
      continue;
    }
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
  // The audience's majority counts as one extra vote.
  const audience = closeAudienceVote(state, `bracket-${matchId}`);
  if (audience.winner === match.answer1.id) v1++;
  else if (audience.winner === match.answer2.id) v2++;
  state.gameData.audienceTally = audience.total > 0 ? audience.tally : null;

  if (v1 === v2 && v1 > 0) {
    startTiebreaker(state, match, v1, v2);
    return;
  }
  if (v1 === v2) {
    // Nobody voted: coin flip.
    const [winner, loser] = shuffle([match.answer1, match.answer2]);
    finalizeMatchWinner(state, matchId, winner, loser, votes, 0, 0);
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
    state.playerData[pid] = state.gameData.votes[pid]
      ? { phase: 'TIEBREAKER', answers: [match.answer1, match.answer2] }
      : { phase: 'WAITING', message: 'Tiebreaker! The voters are mashing…' };
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
    bumpStat(state, 'matchWins', winner.id);
  }
  if (!winner.isBot) bumpStat(state, 'votesReceived', winner.id, winner === bracket[matchId].answer1 ? v1 : v2);
  if (!loser.isBot) bumpStat(state, 'votesReceived', loser.id, loser === bracket[matchId].answer1 ? v1 : v2);

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
      bumpStat(state, 'oracle', pid);
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
