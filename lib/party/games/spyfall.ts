import { GameState } from '../types';
import { waitingFor } from '../presence';
import { closeAudienceVote, openAudienceVote } from '../audience';
import { bumpStat } from '../awards';
import { getGameContent, type SpyfallLocation } from '../prompts';

const TOTAL_ROUNDS = 3;
const DISCUSSION_TIME = 120;
const VOTING_TIME = 30;
/** Locations in play for one game (drawn from the chosen packs); 16 fit the TV and phone grids. */
const LOCATIONS_PER_GAME = 16;

const SAMPLE_QUESTIONS = [
  'What are you wearing right now at this place?',
  'How long do people usually stay here?',
  'What is the loudest sound you hear around us?',
  'Did you need special training to be here?',
  'Would you bring a child to this place?',
  'What is the worst part about working or visiting here?',
  'Is it hot, cold, or cramped where we are?',
];

export const spyfallLogic = {
  onStart: async (state: GameState) => {
    if (state.playerOrder.length < 3) return;
    const locations = await getGameContent('spyfallLocations', LOCATIONS_PER_GAME, state.settings?.packs);
    state.gameData = {
      round: 0,
      totalRounds: TOTAL_ROUNDS,
      locations,
      usedLocations: [] as string[],
      location: '',
      locationEmoji: '',
      spyId: '',
      roles: {} as Record<string, string>,
      votes: {} as Record<string, string>,
      calledBy: null as string | null,
      spyGuess: null as string | null,
    };
    startSpyfallRound(state);
  },

  processAction: async (state: GameState, playerId: string, action: any) => {
    switch (action.type) {
      case 'CALL_VOTE': {
        if (state.phase !== 'DISCUSSION') return;
        state.gameData.calledBy = playerId !== state.hostId ? playerId : null;
        startSpyfallVoting(state);
        break;
      }

      case 'SPY_GUESS_LOCATION': {
        if (state.phase !== 'DISCUSSION' && state.phase !== 'VOTING') return;
        if (playerId !== state.gameData.spyId) return;
        const guess = typeof action.location === 'string' ? action.location.trim() : '';
        if (!(state.gameData.locations as SpyfallLocation[]).some((l) => l.name === guess)) return;
        state.gameData.spyGuess = guess;
        resolveSpyfallRound(state);
        break;
      }

      case 'SUBMIT_VOTE': {
        if (state.phase !== 'VOTING') return;
        const target = String(action.votedFor || '');
        if (!state.players[target] || state.players[target].left || target === playerId) return;
        state.gameData.votes[playerId] = target;
        state.playerData[playerId] = { ...state.playerData[playerId], hasVoted: true };
        const targets = waitingFor(state, state.playerOrder);
        if (targets.every((pid) => state.gameData.votes[pid])) {
          resolveSpyfallRound(state);
        }
        break;
      }

      case 'FORCE_SPYFALL_RESULTS': {
        if (state.phase !== 'VOTING') return;
        resolveSpyfallRound(state);
        break;
      }

      case 'NEXT_SPYFALL_ROUND': {
        if (state.phase !== 'RESULTS') return;
        if (state.gameData.round >= state.gameData.totalRounds) {
          state.phase = 'FINAL_RESULTS';
          state.hostData = { message: 'Mission Complete!' };
          for (const pid of state.playerOrder) state.playerData[pid] = { phase: 'FINAL_RESULTS' };
        } else {
          startSpyfallRound(state);
        }
        break;
      }
    }
  },
};

function startSpyfallRound(state: GameState) {
  state.gameData.round++;
  state.gameData.votes = {};
  state.gameData.calledBy = null;
  state.gameData.spyGuess = null;

  const locations: SpyfallLocation[] = state.gameData.locations;
  const available = locations.filter((l) => !state.gameData.usedLocations.includes(l.name));
  const pool = available.length ? available : locations;
  const loc = pool[Math.floor(Math.random() * pool.length)];
  state.gameData.usedLocations.push(loc.name);
  state.gameData.location = loc.name;
  state.gameData.locationEmoji = loc.emoji;

  const activeOrder = state.playerOrder.filter((pid) => !state.players[pid]?.left);
  // A spy whose phone has dropped can't see their card, so pick from reachable players.
  const spyPool = waitingFor(state, activeOrder);
  const spyId = spyPool[Math.floor(Math.random() * spyPool.length)] || state.playerOrder[0];
  state.gameData.spyId = spyId;

  const shuffledRoles = [...loc.roles].sort(() => Math.random() - 0.5);
  const roles: Record<string, string> = {};
  let rIdx = 0;
  for (const pid of state.playerOrder) {
    if (pid === spyId) {
      roles[pid] = 'THE SPY';
    } else {
      roles[pid] = shuffledRoles[rIdx % shuffledRoles.length];
      rIdx++;
    }
  }
  state.gameData.roles = roles;

  const allLocations = (state.gameData.locations as SpyfallLocation[]).map((l) => ({ name: l.name, emoji: l.emoji }));
  const firstAsker = activeOrder[Math.floor(Math.random() * activeOrder.length)];
  const samplePrompt = SAMPLE_QUESTIONS[Math.floor(Math.random() * SAMPLE_QUESTIONS.length)];

  state.phase = 'DISCUSSION';
  state.hostData = {
    round: state.gameData.round,
    totalRounds: state.gameData.totalRounds,
    message: 'Interrogate Each Other!',
    subMessage: `${state.players[firstAsker]?.name || 'Someone'} asks the first question! e.g. "${samplePrompt}"`,
    locations: allLocations,
    timerStart: Date.now(),
    timerDuration: DISCUSSION_TIME,
    autoAdvanceAt: Date.now() + DISCUSSION_TIME * 1000,
    autoAdvanceAction: 'CALL_VOTE',
  };

  for (const pid of state.playerOrder) {
    const isSpy = pid === spyId;
    state.playerData[pid] = {
      phase: 'DISCUSSION',
      isSpy,
      location: isSpy ? null : loc.name,
      locationEmoji: isSpy ? '🕵️' : loc.emoji,
      role: roles[pid],
      locations: allLocations,
      firstAskerName: state.players[firstAsker]?.name,
      samplePrompt,
    };
  }
}

function startSpyfallVoting(state: GameState) {
  state.phase = 'VOTING';
  state.gameData.votes = {};
  const callerName = state.gameData.calledBy ? state.players[state.gameData.calledBy]?.name : null;
  const allLocations = (state.gameData.locations as SpyfallLocation[]).map((l) => ({ name: l.name, emoji: l.emoji }));
  const activePlayers = state.playerOrder.filter((pid) => !state.players[pid]?.left);

  state.hostData = {
    round: state.gameData.round,
    totalRounds: state.gameData.totalRounds,
    message: callerName ? `🚨 ${callerName} Called a Vote!` : '⏰ Time is Up — Vote Now!',
    subMessage: 'Point fingers and vote on your phones: Who is The Spy?',
    locations: allLocations,
    timerStart: Date.now(),
    timerDuration: VOTING_TIME,
    autoAdvanceAt: Date.now() + VOTING_TIME * 1000,
    autoAdvanceAction: 'FORCE_SPYFALL_RESULTS',
  };

  openAudienceVote(state, {
    key: `spyfall-${state.gameData.round}`,
    prompt: 'Who is The Spy?',
    choices: activePlayers.map((pid) => ({ id: pid, label: state.players[pid]?.name || '?' })),
  });

  for (const pid of state.playerOrder) {
    state.playerData[pid] = {
      ...state.playerData[pid],
      phase: 'VOTING',
      hasVoted: false,
      activePlayers,
    };
  }
}

function resolveSpyfallRound(state: GameState) {
  state.phase = 'RESULTS';
  const spyId = state.gameData.spyId;
  const location = state.gameData.location;
  const locationEmoji = state.gameData.locationEmoji;
  const spyGuess: string | null = state.gameData.spyGuess;
  const votes: Record<string, string> = state.gameData.votes || {};

  const audience = closeAudienceVote(state, `spyfall-${state.gameData.round}`);
  for (const [aid, choice] of Object.entries(audience.votes)) {
    const member = state.audience?.[aid];
    if (member && choice === spyId) member.score++;
  }

  let outcome: 'SPY_GUESSED_RIGHT' | 'SPY_GUESSED_WRONG' | 'SPY_CAUGHT' | 'SPY_ESCAPED';
  let accusedId: string | null = null;

  if (spyGuess) {
    if (spyGuess === location) {
      outcome = 'SPY_GUESSED_RIGHT';
      if (state.players[spyId]) state.players[spyId].score += 1200;
      bumpStat(state, 'escapes', spyId);
    } else {
      outcome = 'SPY_GUESSED_WRONG';
      for (const pid of state.playerOrder) {
        if (pid !== spyId && !state.players[pid]?.left) state.players[pid].score += 800;
      }
    }
  } else {
    const tally: Record<string, number> = {};
    for (const pid of state.playerOrder) tally[pid] = 0;
    for (const target of Object.values(votes)) {
      if (target in tally) tally[target]++;
    }
    const best = Math.max(0, ...Object.values(tally));
    const leaders = Object.keys(tally).filter((id) => tally[id] === best);
    accusedId = best > 0 && leaders.length === 1 ? leaders[0] : null;

    if (accusedId === spyId) {
      outcome = 'SPY_CAUGHT';
      for (const [voterId, target] of Object.entries(votes)) {
        if (voterId !== spyId && target === spyId && state.players[voterId]) {
          state.players[voterId].score += 800;
          bumpStat(state, 'detective', voterId);
        }
      }
      if (state.gameData.calledBy && votes[state.gameData.calledBy] === spyId && state.players[state.gameData.calledBy]) {
        state.players[state.gameData.calledBy].score += 250;
      }
    } else {
      outcome = 'SPY_ESCAPED';
      if (state.players[spyId]) state.players[spyId].score += 1200;
      bumpStat(state, 'escapes', spyId);
      for (const [voterId, target] of Object.entries(votes)) {
        if (voterId !== spyId && target === spyId && state.players[voterId]) {
          state.players[voterId].score += 250;
          bumpStat(state, 'detective', voterId);
        }
      }
    }
  }

  const voters: Record<string, string[]> = {};
  for (const pid of state.playerOrder) {
    voters[pid] = Object.keys(votes).filter((v) => votes[v] === pid);
  }

  const spyCaught = outcome === 'SPY_CAUGHT' || outcome === 'SPY_GUESSED_WRONG';
  const headline =
    outcome === 'SPY_GUESSED_RIGHT'
      ? `🕵️ The Spy Pinpointed ${locationEmoji} ${location}!`
      : outcome === 'SPY_GUESSED_WRONG'
      ? `💥 The Spy Guessed "${spyGuess}" — Wrong!`
      : outcome === 'SPY_CAUGHT'
      ? '🎯 Spy Caught!'
      : '👻 The Spy Escaped!';

  state.hostData = {
    round: state.gameData.round,
    totalRounds: state.gameData.totalRounds,
    outcome,
    spyCaught,
    headline,
    spyId,
    accusedId,
    spyGuess,
    location,
    locationEmoji,
    roles: state.gameData.roles,
    voters,
    votes,
    timerStart: Date.now(),
    timerDuration: 10,
    autoAdvanceAt: Date.now() + 10_000,
    autoAdvanceAction: 'NEXT_SPYFALL_ROUND',
  };

  for (const pid of state.playerOrder) {
    state.playerData[pid] = {
      phase: 'RESULTS',
      outcome,
      spyCaught,
      headline,
      wasSpy: pid === spyId,
      spyName: state.players[spyId]?.name,
      location: `${locationEmoji} ${location}`,
    };
  }
}
