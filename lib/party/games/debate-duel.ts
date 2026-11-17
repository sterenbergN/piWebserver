import { GameState } from '../types';
import { waitingFor } from '../presence';
import { closeAudienceVote, openAudienceVote } from '../audience';
import { bumpStat } from '../awards';
import { cleanSwitchWord, isSwitchable, switchWord, toWords, wordCore } from '../debate-words';

// Debate Duel: a spoken debate game built entirely from the room's own hot
// takes. Everyone writes a goofy opinion; pairs then argue one for and against
// out loud while everyone else picks a side on their phone (and moves across
// the TV with it). After the first round of speeches, anyone can edit a word
// of the topic, and the debaters go again on whatever it turned into. Anyone
// not debating can heckle. The sides people end up on are the verdict; with
// just two players, the debaters rate each other instead.

export { cleanSwitchWord, isSwitchable, switchWord, toWords };

export const TOPIC_SECONDS = 60;
export const INTRO_SECONDS = 7;
export const HANDOFF_SECONDS = 5;
/** Speech length in the first round, then after the switch. */
export const PITCH_SECONDS = [30, 20] as const;
export const SWITCH_SECONDS = 25;
export const SWITCH_REVEAL_SECONDS = 6;
export const VERDICT_SECONDS = 15;
export const RESULTS_SECONDS = 9;

export const VOTE_POINTS = 500;
/** Everyone (at least two people) ended up on one side. */
export const MIC_DROP_BONUS = 500;
export const STAR_POINTS = 200;
export const AUDIENCE_FAVORITE_BONUS = 250;
/** The edit the room went with. */
export const SWITCH_POINTS = 150;

const MAX_TOPIC = 100;
const MAX_HECKLE = 60;
const HECKLE_GAP_MS = 2500;
const MAX_HECKLES_SHOWN = 20;
const MAX_TYPED_LINES = 6;

export const SIDE_LABELS = ['Pro', 'Con'] as const;
export type Side = 0 | 1;
/** The four speeches of a debate: Pro, Con, then (after the switch) Pro, Con. */
export type Stage = 0 | 1 | 2 | 3;

interface SwitchInfo { index: number; from: string; to: string; by: string }
type Proposal = { index: number; word: string } | 'pass';

interface Matchup {
  /** The topic as written. */
  original: string[];
  /** The topic now (after the switch, if there was one). */
  words: string[];
  author: string | null;
  /** [Pro, Con] */
  debaters: [string, string];
  switch: SwitchInfo | null;
  /** Lines typed by debaters who couldn't talk, per speech. */
  typed: string[][];
}

interface Heckle { id: number; name: string; text: string }

function shuffle<T>(list: T[]): T[] {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** Tidy a hot take: one line, capital first letter. */
export function cleanTopic(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  const text = raw.replace(/\s+/g, ' ').trim().slice(0, MAX_TOPIC);
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** Pair everyone off; with an odd count the last player takes on someone who's already been paired. */
export function pairPlayers(ids: string[]): [string, string][] {
  const order = shuffle(ids);
  const pairs: [string, string][] = [];
  for (let i = 0; i + 1 < order.length; i += 2) pairs.push([order[i], order[i + 1]]);
  if (order.length % 2 === 1 && order.length > 1) {
    const last = order[order.length - 1];
    const rival = order[Math.floor(Math.random() * (order.length - 1))];
    pairs.push([last, rival]);
  }
  // Random sides, so the order players were paired in doesn't decide who argues Pro.
  return pairs.map(([a, b]) => (Math.random() < 0.5 ? [a, b] : [b, a]));
}

/**
 * Give each debate one of the room's topics, preferring one neither debater
 * wrote and using every topic once before any repeats.
 */
export function assignTopics(pairs: [string, string][], topics: { author: string; text: string }[]): { author: string; text: string }[] {
  const unused = shuffle(topics);
  return pairs.map(([a, b]) => {
    if (!unused.length) unused.push(...shuffle(topics));
    let i = unused.findIndex((t) => t.author !== a && t.author !== b);
    if (i < 0) i = 0;
    return unused.splice(i, 1)[0];
  });
}

const pollKey = (state: GameState) => `debate-${state.gameData.currentRound}-${state.gameData.current}`;
const matchup = (state: GameState): Matchup => state.gameData.matchups[state.gameData.current];
const seatedIds = (state: GameState) => state.playerOrder.filter((pid) => state.players[pid] && !state.players[pid].left);
/** Everyone in the room who isn't in the current debate. */
const spectators = (state: GameState) => seatedIds(state).filter((pid) => !matchup(state).debaters.includes(pid));
const crowd = (state: GameState): Record<string, Side> => (state.gameData.sides[state.gameData.current] ||= {});

export const debateDuelLogic = {
  onStart: async (state: GameState, isNextRound = false) => {
    if (state.playerOrder.length < 2) return;
    const targetRounds = state.gameData?.targetRounds || 1;
    const currentRound = isNextRound && state.gameData ? state.gameData.currentRound + 1 : 0;
    state.gameData = {
      ...state.gameData,
      currentRound,
      targetRounds,
      topics: {},
      matchups: [],
      current: 0,
      sides: {},
      locked: {},
      ratings: {},
      proposals: {},
      lastHeckle: {},
      heckleSeq: state.gameData?.heckleSeq || 0,
    };
    startTopics(state);
  },

  processAction: async (state: GameState, playerId: string, action: any) => {
    switch (action.type) {
      case 'SUBMIT_TOPIC': {
        if (state.phase !== 'TOPIC' || !state.players[playerId]) return;
        const text = cleanTopic(action.text);
        if (!text) return;
        state.gameData.topics[playerId] = text;
        if (state.playerData[playerId]) state.playerData[playerId].topic = text;
        if (waitingFor(state, state.playerOrder).every((pid) => state.gameData.topics[pid])) buildMatchups(state);
        break;
      }

      case 'FORCE_MATCHUPS':
        if (playerId !== state.hostId || state.phase !== 'TOPIC') return;
        // Every debate needs a topic from the room; with none yet, give everyone more time.
        if (Object.keys(state.gameData.topics).length) buildMatchups(state);
        else startTopics(state, true);
        break;

      case 'START_PITCH':
        if (playerId !== state.hostId || state.phase !== 'UP_NEXT') return;
        startPitch(state);
        break;

      case 'SUBMIT_PITCH_LINE': {
        if (state.phase !== 'PITCH' || playerId !== state.hostData.speakerId) return;
        const text = typeof action.text === 'string' ? action.text.trim() : '';
        const typed = matchup(state).typed[state.hostData.stage];
        if (!text || typed.length >= MAX_TYPED_LINES) return;
        typed.push(text);
        state.hostData.typed = [...typed];
        break;
      }

      case 'SUBMIT_PITCH_DONE':
        if (state.phase !== 'PITCH' || playerId !== state.hostData.speakerId) return;
        endPitch(state);
        break;

      case 'END_PITCH':
        if (playerId !== state.hostId || state.phase !== 'PITCH') return;
        endPitch(state);
        break;

      case 'SUBMIT_HECKLE':
        if (!state.players[playerId]) return;
        if (addHeckle(state, playerId, state.players[playerId].name, action.text)) bumpStat(state, 'heckles', playerId);
        break;

      case 'SUBMIT_SIDE': {
        // Spectators move between Pro and Con whenever they like, until they lock in.
        if (!['UP_NEXT', 'PITCH', 'SWITCH', 'SWITCH_REVEAL', 'VERDICT'].includes(state.phase)) return;
        if (state.hostData.mode === 'rate' || !spectators(state).includes(playerId)) return;
        if (state.gameData.locked[playerId]) return;
        const side = action.side;
        if (side !== 0 && side !== 1) return;
        crowd(state)[playerId] = side;
        state.hostData.crowd = { ...crowd(state) };
        break;
      }

      case 'SUBMIT_SWITCH': {
        if (state.phase !== 'SWITCH' || !state.players[playerId]) return;
        const words = matchup(state).words;
        if (action.pass === true) {
          state.gameData.proposals[playerId] = 'pass';
        } else {
          const index = Number(action.index);
          const word = cleanSwitchWord(action.word);
          if (!Number.isInteger(index) || !words[index] || !isSwitchable(words[index]) || !word) return;
          if (word.toLowerCase() === wordCore(words[index]).toLowerCase()) return;
          state.gameData.proposals[playerId] = { index, word };
        }
        if (state.playerData[playerId]) state.playerData[playerId].proposed = true;
        state.hostData.proposed = Object.keys(state.gameData.proposals).length;
        if (waitingFor(state, seatedIds(state)).every((pid) => state.gameData.proposals[pid])) resolveSwitch(state);
        break;
      }

      case 'FORCE_SWITCH':
        if (playerId !== state.hostId || state.phase !== 'SWITCH') return;
        resolveSwitch(state);
        break;

      case 'NEXT_SPEECH':
        if (playerId !== state.hostId || state.phase !== 'SWITCH_REVEAL') return;
        upNext(state, 2);
        break;

      case 'SUBMIT_VOTE': {
        // The final call: lock in a side (pre-filled with wherever you were standing).
        if (state.phase !== 'VERDICT' || state.hostData.mode !== 'vote') return;
        const side = action.side;
        if (!spectators(state).includes(playerId) || (side !== 0 && side !== 1)) return;
        crowd(state)[playerId] = side;
        state.gameData.locked[playerId] = true;
        state.hostData.crowd = { ...crowd(state) };
        if (state.playerData[playerId]) state.playerData[playerId].chosen = side;
        if (waitingFor(state, spectators(state)).every((pid) => state.gameData.locked[pid])) tally(state);
        break;
      }

      case 'SUBMIT_RATING': {
        if (state.phase !== 'VERDICT' || state.hostData.mode !== 'rate') return;
        const m = matchup(state);
        const stars = Math.round(Number(action.stars));
        if (!m.debaters.includes(playerId) || !(stars >= 1 && stars <= 5)) return;
        // You rate the other debater.
        (state.gameData.ratings[state.gameData.current] ||= {})[playerId] = stars;
        if (state.playerData[playerId]) state.playerData[playerId].chosen = stars;
        if (waitingFor(state, m.debaters).every((pid) => state.gameData.ratings[state.gameData.current]?.[pid] !== undefined)) tally(state);
        break;
      }

      case 'FORCE_TALLY':
        if (playerId !== state.hostId || state.phase !== 'VERDICT') return;
        tally(state);
        break;

      case 'NEXT_MATCHUP':
        if (playerId !== state.hostId || state.phase !== 'VERDICT_RESULTS') return;
        state.gameData.current++;
        state.gameData.locked = {};
        state.gameData.proposals = {};
        if (state.gameData.current < state.gameData.matchups.length) {
          upNext(state, 0);
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

/** A heckle from a spectator or the audience. Returns false if it was dropped (too soon, empty, wrong moment, or from a debater). */
export function addHeckle(state: GameState, senderId: string, name: string, raw: unknown): boolean {
  if (state.gameType !== 'debate-duel' || state.phase !== 'PITCH') return false;
  if (matchup(state)?.debaters.includes(senderId)) return false;
  const text = typeof raw === 'string' ? raw.replace(/\s+/g, ' ').trim().slice(0, MAX_HECKLE) : '';
  if (!text) return false;
  const now = Date.now();
  if (now - (state.gameData.lastHeckle?.[senderId] || 0) < HECKLE_GAP_MS) return false;
  (state.gameData.lastHeckle ||= {})[senderId] = now;
  const id = (state.gameData.heckleSeq = (state.gameData.heckleSeq || 0) + 1);
  const heckles: Heckle[] = [...(state.hostData.heckles || []), { id, name, text }];
  state.hostData.heckles = heckles.slice(-MAX_HECKLES_SHOWN);
  return true;
}

function startTopics(state: GameState, again = false) {
  const now = Date.now();
  state.phase = 'TOPIC';
  state.hostData = {
    round: state.gameData.currentRound + 1,
    totalRounds: state.gameData.targetRounds,
    again,
    timerStart: now,
    timerDuration: TOPIC_SECONDS,
    autoAdvanceAt: now + TOPIC_SECONDS * 1000,
    autoAdvanceAction: 'FORCE_MATCHUPS',
  };
  for (const pid of state.playerOrder) {
    state.playerData[pid] = { phase: 'TOPIC', topic: state.gameData.topics[pid] || null };
  }
}

function buildMatchups(state: GameState) {
  const pairs = pairPlayers(seatedIds(state));
  const written = Object.entries(state.gameData.topics as Record<string, string>).map(([author, text]) => ({ author, text }));
  const topics = assignTopics(pairs, written);
  state.gameData.matchups = pairs.map((debaters, i): Matchup => {
    const words = toWords(topics[i].text);
    return { original: words, words, author: topics[i].author, debaters, switch: null, typed: [[], [], [], []] };
  });
  state.gameData.current = 0;
  upNext(state, 0);
}

function baseHostData(state: GameState) {
  const m = matchup(state);
  return {
    round: state.gameData.currentRound + 1,
    totalRounds: state.gameData.targetRounds,
    matchNumber: state.gameData.current + 1,
    totalMatches: state.gameData.matchups.length,
    debaters: m.debaters,
    author: m.author,
    original: m.original,
    words: m.words,
    switch: m.switch ? { ...m.switch, byName: state.players[m.switch.by]?.name || null } : null,
    crowd: { ...crowd(state) },
  };
}

/** Phone data for the current debate: where each player stands in it. */
function seatData(state: GameState, phase: string, pid: string) {
  const mySide = matchup(state).debaters.indexOf(pid);
  return { phase, mySide: mySide >= 0 ? mySide : null };
}

/** The moment before a speech: who's up, which side, and the topic. */
function upNext(state: GameState, stage: Stage) {
  const now = Date.now();
  const side = (stage % 2) as Side;
  const seconds = stage === 0 ? INTRO_SECONDS : HANDOFF_SECONDS;
  state.phase = 'UP_NEXT';
  state.hostData = {
    ...baseHostData(state),
    stage,
    debateRound: stage < 2 ? 1 : 2,
    speakerSide: side,
    speakerId: matchup(state).debaters[side],
    matchId: `${state.gameData.currentRound}.${state.gameData.current}.${stage}.next`,
    timerStart: now,
    timerDuration: seconds,
    autoAdvanceAt: now + seconds * 1000,
    autoAdvanceAction: 'START_PITCH',
  };
  for (const pid of state.playerOrder) state.playerData[pid] = seatData(state, 'UP_NEXT', pid);
}

function startPitch(state: GameState) {
  const now = Date.now();
  const stage = state.hostData.stage as Stage;
  const seconds = PITCH_SECONDS[stage < 2 ? 0 : 1];
  state.phase = 'PITCH';
  state.hostData = {
    ...baseHostData(state),
    stage,
    debateRound: stage < 2 ? 1 : 2,
    speakerSide: stage % 2,
    speakerId: state.hostData.speakerId,
    typed: [],
    heckles: [],
    matchId: `${state.gameData.currentRound}.${state.gameData.current}.${stage}.pitch`,
    timerStart: now,
    timerDuration: seconds,
    autoAdvanceAt: now + seconds * 1000,
    autoAdvanceAction: 'END_PITCH',
  };
  state.gameData.lastHeckle = {};
  for (const pid of state.playerOrder) state.playerData[pid] = seatData(state, 'PITCH', pid);
}

function endPitch(state: GameState) {
  const stage = state.hostData.stage as Stage;
  if (stage === 0 || stage === 2) upNext(state, (stage + 1) as Stage);
  else if (stage === 1) startSwitch(state);
  else startVerdict(state);
}

/** After the first round of speeches, anyone can edit a word of the topic. */
function startSwitch(state: GameState) {
  const now = Date.now();
  state.gameData.proposals = {};
  state.phase = 'SWITCH';
  state.hostData = {
    ...baseHostData(state),
    proposed: 0,
    matchId: `${state.gameData.currentRound}.${state.gameData.current}.switch`,
    timerStart: now,
    timerDuration: SWITCH_SECONDS,
    autoAdvanceAt: now + SWITCH_SECONDS * 1000,
    autoAdvanceAction: 'FORCE_SWITCH',
  };
  for (const pid of state.playerOrder) state.playerData[pid] = { ...seatData(state, 'SWITCH', pid), proposed: false };
}

/** Pick one of the room's edits at random and apply it. Nobody editing leaves the topic as it was. */
function resolveSwitch(state: GameState) {
  const now = Date.now();
  const m = matchup(state);
  const edits = Object.entries(state.gameData.proposals as Record<string, Proposal>)
    .filter((e): e is [string, { index: number; word: string }] => e[1] !== 'pass');
  const options = edits.map(([by, p]) => ({ by, byName: state.players[by]?.name || '?', index: p.index, word: p.word, words: switchWord(m.words, p.index, p.word) }));
  const chosen = options.length ? options[Math.floor(Math.random() * options.length)] : null;
  if (chosen) {
    m.switch = { index: chosen.index, from: wordCore(m.words[chosen.index]), to: chosen.word, by: chosen.by };
    m.words = chosen.words;
    if (state.players[chosen.by]) state.players[chosen.by].score += SWITCH_POINTS;
    bumpStat(state, 'switches', chosen.by);
  }
  state.phase = 'SWITCH_REVEAL';
  state.hostData = {
    ...baseHostData(state),
    // Everyone's edit, so the TV can show what might have been.
    options: options.map((o) => ({ byName: o.byName, text: o.words.join(' '), chosen: o === chosen })),
    matchId: `${state.gameData.currentRound}.${state.gameData.current}.reveal`,
    timerStart: now,
    timerDuration: SWITCH_REVEAL_SECONDS,
    autoAdvanceAt: now + SWITCH_REVEAL_SECONDS * 1000,
    autoAdvanceAction: 'NEXT_SPEECH',
  };
  for (const pid of state.playerOrder) state.playerData[pid] = seatData(state, 'SWITCH_REVEAL', pid);
}

function startVerdict(state: GameState) {
  const now = Date.now();
  const m = matchup(state);
  const mode = spectators(state).length ? 'vote' : 'rate';
  state.phase = 'VERDICT';
  state.hostData = {
    ...baseHostData(state),
    mode,
    typed: m.typed,
    matchId: `${state.gameData.currentRound}.${state.gameData.current}.verdict`,
    timerStart: now,
    timerDuration: VERDICT_SECONDS,
    autoAdvanceAt: now + VERDICT_SECONDS * 1000,
    autoAdvanceAction: 'FORCE_TALLY',
  };
  openAudienceVote(state, {
    key: pollKey(state),
    prompt: 'Who won the debate?',
    choices: m.debaters.map((pid, side) => ({ id: String(side), label: `${SIDE_LABELS[side]}: ${state.players[pid]?.name || '?'}` })),
  });
  for (const pid of state.playerOrder) {
    const mySide = m.debaters.indexOf(pid);
    if (mode === 'vote') {
      state.playerData[pid] = mySide >= 0
        ? { phase: 'VERDICT', mySide, waiting: true }
        : { phase: 'VERDICT', mySide: null, canVote: true, chosen: null };
    } else {
      state.playerData[pid] = mySide >= 0 ? { phase: 'VERDICT', mySide, canRate: true, chosen: null } : { phase: 'VERDICT', mySide: null, waiting: true };
    }
  }
}

function tally(state: GameState) {
  const now = Date.now();
  const idx: number = state.gameData.current;
  const m = matchup(state);
  const mode = state.hostData.mode as 'vote' | 'rate';
  const points: [number, number] = [0, 0];
  const counts: [number, number] = [0, 0];
  const voters: [string[], string[]] = [[], []];
  let micDrop: Side | null = null;

  if (mode === 'vote') {
    // Wherever each spectator ended up standing is their vote.
    for (const [pid, side] of Object.entries(crowd(state)) as [string, Side][]) {
      if (m.debaters.includes(pid) || !state.players[pid]) continue;
      counts[side]++;
      voters[side].push(pid);
    }
    points[0] = counts[0] * VOTE_POINTS;
    points[1] = counts[1] * VOTE_POINTS;
    const total = counts[0] + counts[1];
    const leader: Side | null = counts[0] === counts[1] ? null : counts[0] > counts[1] ? 0 : 1;
    if (leader !== null && total >= 2 && counts[leader] === total) {
      micDrop = leader;
      points[leader] += MIC_DROP_BONUS;
    }
  } else {
    // Each debater's rating is of the other's debating.
    const ratings: Record<string, number> = state.gameData.ratings[idx] || {};
    m.debaters.forEach((pid, side) => {
      const stars = ratings[pid] || 0;
      const rated = (1 - side) as Side;
      counts[rated] = stars;
      points[rated] = stars * STAR_POINTS;
    });
  }
  const winnerSide: Side | null = counts[0] === counts[1] ? null : counts[0] > counts[1] ? 0 : 1;

  const audience = closeAudienceVote(state, pollKey(state));
  const audienceFavorite: Side | null = audience.winner === '0' ? 0 : audience.winner === '1' ? 1 : null;
  if (audienceFavorite !== null) points[audienceFavorite] += AUDIENCE_FAVORITE_BONUS;

  m.debaters.forEach((pid, side) => {
    if (state.players[pid]) state.players[pid].score += points[side];
    if (mode === 'vote') bumpStat(state, 'votes', pid, counts[side]);
  });
  if (winnerSide !== null) bumpStat(state, 'debatesWon', m.debaters[winnerSide]);
  if (micDrop !== null) bumpStat(state, 'micDrop', m.debaters[micDrop]);
  if (audienceFavorite !== null) bumpStat(state, 'audienceFavorite', m.debaters[audienceFavorite]);

  state.phase = 'VERDICT_RESULTS';
  state.hostData = {
    ...baseHostData(state),
    mode,
    tally: counts,
    voters,
    points,
    winnerSide,
    micDrop,
    audienceTally: audience.total > 0 ? [audience.tally['0'] || 0, audience.tally['1'] || 0] : null,
    audienceFavorite,
    matchId: `${state.gameData.currentRound}.${idx}.results`,
    timerStart: now,
    timerDuration: RESULTS_SECONDS,
    autoAdvanceAt: now + RESULTS_SECONDS * 1000,
    autoAdvanceAction: 'NEXT_MATCHUP',
  };
  for (const pid of state.playerOrder) state.playerData[pid] = { phase: 'VERDICT_RESULTS' };
}
