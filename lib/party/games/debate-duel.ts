import { GameState } from '../types';
import { waitingFor } from '../presence';
import { drawGameContent } from '../prompts';
import { closeAudienceVote, openAudienceVote } from '../audience';
import { bumpStat } from '../awards';

// Debate Duel: every player is handed a side in two silly debates (one per
// side, against two different opponents). They write an opening argument for
// each, then see their opponent's opening and fire back a rebuttal. Each debate
// then plays on the TV and everyone who isn't in it votes for the better side.

const OPENING_SECONDS = 75;
const REBUTTAL_SECONDS = 50;
const VOTE_SECONDS = 40;
const RESULTS_SECONDS = 9;

export const VOTE_POINTS = 500;
/** Every vote (at least two of them) went one way. */
export const MIC_DROP_BONUS = 500;
export const AUDIENCE_FAVORITE_BONUS = 250;

export const SILENT_OPENING = '(stood there in silence)';
export const SILENT_REBUTTAL = '(had no comeback)';

export type Side = 0 | 1;

export interface DebateTopic {
  motion: string;
  sides: [string, string];
}

interface Debate {
  topic: DebateTopic;
  /** Player arguing each side. */
  debaters: [string, string];
  openings: [string, string];
  rebuttals: [string, string];
}

/** One of a player's two debates: which debate, and which side of it they argue. */
interface Seat { debate: number; side: Side }

/**
 * A topic is written either as two sides ("Cats vs Dogs", optionally with a
 * question first: "Best pet: Cats vs Dogs" / "Is a hot dog a sandwich? Yes vs No")
 * or as a motion to argue For or Against ("Pineapple belongs on pizza").
 */
export function parseDebateTopic(raw: string): DebateTopic {
  const text = raw.trim();
  const vs = text.match(/^(?:(.+?[:?])\s+)?(.+?)\s+vs\.?\s+(.+)$/i);
  if (vs) {
    const a = vs[2].trim();
    const b = vs[3].trim();
    const label = vs[1]?.replace(/:$/, '').trim();
    return { motion: label || `${a} vs ${b}`, sides: [a, b] };
  }
  return { motion: text, sides: ['For', 'Against'] };
}

const pollKey = (state: GameState) => `debate-${state.gameData.currentRound}-${state.gameData.current}`;

function seatsFor(state: GameState, playerId: string): Seat[] {
  return state.gameData.seats?.[playerId] || [];
}

function cardFor(debate: Debate, seat: Seat) {
  return { motion: debate.topic.motion, sides: debate.topic.sides, mySide: seat.side };
}

export const debateDuelLogic = {
  onStart: async (state: GameState, isNextRound = false) => {
    const n = state.playerOrder.length;
    if (n < 3) return;

    const targetRounds = state.gameData?.targetRounds || 1;
    const currentRound = isNextRound && state.gameData ? state.gameData.currentRound + 1 : 0;
    const topics = (await drawGameContent('debateTopics', n, state.settings?.packs)).map(parseDebateTopic);

    // Debate k: player k argues side 0, the player before them argues side 1.
    // So everyone argues one side of one debate and the other side of another,
    // against two different opponents.
    const debates: Debate[] = topics.map((topic, k) => ({
      topic,
      debaters: [state.playerOrder[k], state.playerOrder[(k - 1 + n) % n]],
      openings: ['', ''],
      rebuttals: ['', ''],
    }));
    const seats: Record<string, Seat[]> = {};
    for (let i = 0; i < n; i++) {
      seats[state.playerOrder[i]] = [{ debate: i, side: 0 }, { debate: (i + 1) % n, side: 1 }];
    }

    state.gameData = {
      ...state.gameData,
      debates,
      seats,
      current: 0,
      votes: {}, // debate index -> { voterId: side }
      currentRound,
      targetRounds,
    };

    state.phase = 'OPENING';
    state.hostData = {
      round: currentRound + 1,
      totalRounds: targetRounds,
      timerStart: Date.now(),
      timerDuration: OPENING_SECONDS,
      autoAdvanceAt: Date.now() + OPENING_SECONDS * 1000,
      autoAdvanceAction: 'FORCE_REBUTTALS',
    };
    for (const pid of state.playerOrder) {
      state.playerData[pid] = {
        phase: 'OPENING',
        cards: seats[pid].map((seat) => cardFor(debates[seat.debate], seat)),
        written: ['', ''],
      };
    }
  },

  processAction: async (state: GameState, playerId: string, action: any) => {
    switch (action.type) {
      case 'SUBMIT_OPENING':
      case 'SUBMIT_REBUTTAL': {
        const opening = action.type === 'SUBMIT_OPENING';
        if (state.phase !== (opening ? 'OPENING' : 'REBUTTAL')) return;
        const slot = action.slot;
        const text = typeof action.text === 'string' ? action.text.trim() : '';
        const seat = seatsFor(state, playerId)[slot];
        const pd = state.playerData[playerId];
        if ((slot !== 0 && slot !== 1) || !seat || !pd || !text) return;
        const debate: Debate = state.gameData.debates[seat.debate];
        (opening ? debate.openings : debate.rebuttals)[seat.side] = text;
        pd.written[slot] = text;

        const everyoneDone = waitingFor(state, state.playerOrder).every((pid) => state.playerData[pid]?.written?.every(Boolean));
        if (everyoneDone) {
          if (opening) startRebuttals(state);
          else startDebates(state);
        }
        break;
      }

      case 'FORCE_REBUTTALS':
        if (playerId !== state.hostId || state.phase !== 'OPENING') return;
        startRebuttals(state);
        break;

      case 'FORCE_DEBATES':
        if (playerId !== state.hostId || state.phase !== 'REBUTTAL') return;
        startDebates(state);
        break;

      case 'SUBMIT_VOTE': {
        if (state.phase !== 'VOTING') return;
        const idx: number = state.gameData.current;
        const debate: Debate = state.gameData.debates[idx];
        const side = action.side;
        // Debaters sit this one out, and a vote must name a side.
        if (debate.debaters.includes(playerId) || (side !== 0 && side !== 1)) return;
        (state.gameData.votes[idx] ||= {})[playerId] = side;
        if (state.playerData[playerId]) state.playerData[playerId].votedSide = side;

        const voters = waitingFor(state, state.playerOrder.filter((pid) => !debate.debaters.includes(pid)));
        if (voters.every((pid) => state.gameData.votes[idx]?.[pid] !== undefined)) tallyDebate(state);
        break;
      }

      case 'FORCE_TALLY':
        if (playerId !== state.hostId || state.phase !== 'VOTING') return;
        tallyDebate(state);
        break;

      case 'NEXT_DEBATE':
        if (playerId !== state.hostId || state.phase !== 'DEBATE_RESULTS') return;
        state.gameData.current++;
        if (state.gameData.current < state.gameData.debates.length) {
          startDebate(state);
        } else if (state.gameData.currentRound < state.gameData.targetRounds - 1) {
          await debateDuelLogic.onStart(state, true);
        } else {
          state.phase = 'FINAL_RESULTS';
          state.hostData = { message: 'The debates are over!' };
          for (const pid of state.playerOrder) state.playerData[pid] = { phase: 'FINAL_RESULTS' };
        }
        break;
    }
  },
};

function startRebuttals(state: GameState) {
  const debates: Debate[] = state.gameData.debates;
  for (const d of debates) d.openings = d.openings.map((t) => t || SILENT_OPENING) as [string, string];

  state.phase = 'REBUTTAL';
  state.hostData = {
    round: state.gameData.currentRound + 1,
    totalRounds: state.gameData.targetRounds,
    timerStart: Date.now(),
    timerDuration: REBUTTAL_SECONDS,
    autoAdvanceAt: Date.now() + REBUTTAL_SECONDS * 1000,
    autoAdvanceAction: 'FORCE_DEBATES',
  };
  for (const pid of state.playerOrder) {
    state.playerData[pid] = {
      phase: 'REBUTTAL',
      cards: seatsFor(state, pid).map((seat) => {
        const d = debates[seat.debate];
        return { ...cardFor(d, seat), myOpening: d.openings[seat.side], theirOpening: d.openings[1 - seat.side] };
      }),
      written: ['', ''],
    };
  }
}

function startDebates(state: GameState) {
  for (const d of state.gameData.debates as Debate[]) d.rebuttals = d.rebuttals.map((t) => t || SILENT_REBUTTAL) as [string, string];
  state.gameData.current = 0;
  startDebate(state);
}

function startDebate(state: GameState) {
  state.phase = 'VOTING';
  const idx: number = state.gameData.current;
  const d: Debate = state.gameData.debates[idx];

  // Who argued which side stays secret until the votes are in.
  state.hostData = {
    motion: d.topic.motion,
    sides: d.topic.sides,
    openings: d.openings,
    rebuttals: d.rebuttals,
    debateNumber: idx + 1,
    totalDebates: state.gameData.debates.length,
    timerStart: Date.now(),
    timerDuration: VOTE_SECONDS,
    autoAdvanceAt: Date.now() + VOTE_SECONDS * 1000,
    autoAdvanceAction: 'FORCE_TALLY',
  };

  openAudienceVote(state, {
    key: pollKey(state),
    prompt: `${d.topic.motion}: who argued better?`,
    choices: d.topic.sides.map((label, side) => ({ id: String(side), label })),
  });

  for (const pid of state.playerOrder) {
    const side = d.debaters.indexOf(pid);
    state.playerData[pid] = side >= 0
      ? { phase: 'WAITING', mySide: side, message: 'Your debate is on! Everyone else is judging.' }
      : { phase: 'VOTING', canVote: true, votedSide: null };
  }
}

function tallyDebate(state: GameState) {
  const idx: number = state.gameData.current;
  const d: Debate = state.gameData.debates[idx];
  const votes: Record<string, Side> = state.gameData.votes[idx] || {};

  const tally: [number, number] = [0, 0];
  const voters: [string[], string[]] = [[], []];
  for (const [voter, side] of Object.entries(votes)) {
    tally[side]++;
    voters[side].push(voter);
  }
  const total = tally[0] + tally[1];
  const winnerSide: Side | null = tally[0] === tally[1] ? null : tally[0] > tally[1] ? 0 : 1;
  const micDrop: Side | null = winnerSide !== null && total >= 2 && tally[winnerSide] === total ? winnerSide : null;

  const points: [number, number] = [tally[0] * VOTE_POINTS, tally[1] * VOTE_POINTS];
  if (micDrop !== null) points[micDrop] += MIC_DROP_BONUS;

  const audience = closeAudienceVote(state, pollKey(state));
  const audienceFavorite: Side | null = audience.winner === '0' ? 0 : audience.winner === '1' ? 1 : null;
  if (audienceFavorite !== null) points[audienceFavorite] += AUDIENCE_FAVORITE_BONUS;

  d.debaters.forEach((pid, side) => {
    if (state.players[pid]) state.players[pid].score += points[side];
    bumpStat(state, 'votes', pid, tally[side]);
  });
  if (winnerSide !== null) bumpStat(state, 'debatesWon', d.debaters[winnerSide]);
  if (micDrop !== null) bumpStat(state, 'micDrop', d.debaters[micDrop]);
  if (audienceFavorite !== null) bumpStat(state, 'audienceFavorite', d.debaters[audienceFavorite]);

  state.phase = 'DEBATE_RESULTS';
  state.hostData = {
    motion: d.topic.motion,
    sides: d.topic.sides,
    openings: d.openings,
    rebuttals: d.rebuttals,
    debaters: d.debaters,
    debateNumber: idx + 1,
    totalDebates: state.gameData.debates.length,
    tally,
    voters,
    points,
    winnerSide,
    micDrop,
    audienceTally: audience.total > 0 ? [audience.tally['0'] || 0, audience.tally['1'] || 0] : null,
    audienceFavorite,
    timerStart: Date.now(),
    timerDuration: RESULTS_SECONDS,
    autoAdvanceAt: Date.now() + RESULTS_SECONDS * 1000,
    autoAdvanceAction: 'NEXT_DEBATE',
  };
  for (const pid of state.playerOrder) state.playerData[pid] = { phase: 'DEBATE_RESULTS' };
}
