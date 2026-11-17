import { GameState } from '../types';
import { waitingFor } from '../presence';
import { drawGameContent } from '../prompts';
import { closeAudienceVote, openAudienceVote } from '../audience';
import { bumpStat } from '../awards';
import { DEBATE_HOUSE_WORDS, DEBATE_TEMPLATES } from '../default-game-content';
import { cleanSwitchWord, isSwitchable, switchWord, toWords, wordCore as core } from '../debate-words';

// Debate Duel: a spoken debate game. Everyone suggests a couple of things,
// which fill in silly propositions. Players are paired off, one Pro and one
// Con, and each gets 30 seconds to argue out loud (or type, if they can't
// talk). Partway through a pitch the room switches a word of the proposition,
// so the speaker has to pivot mid-sentence, and anyone watching can heckle.
// Then everyone else votes; in a two-player room the debaters rate each other.

export const SUGGEST_SECONDS = 45;
export const INTRO_SECONDS = 7;
export const HANDOFF_SECONDS = 5;
export const PITCH_SECONDS = 30;
/** Seconds into a pitch before the room may switch a word. */
export const SWITCH_OPENS_AFTER = 8;
/** If nobody has switched by now, the game switches a word itself. */
export const HOUSE_SWITCH_AFTER = 16;
export const VERDICT_SECONDS = 25;
export const RESULTS_SECONDS = 9;

export const VOTE_POINTS = 500;
/** Every vote (at least two of them) went one way. */
export const MIC_DROP_BONUS = 500;
export const STAR_POINTS = 200;
export const AUDIENCE_FAVORITE_BONUS = 250;
export const SWITCH_POINTS = 100;

const SUGGESTIONS_EACH = 2;
const MAX_SUGGESTION = 30;
const MAX_HECKLE = 60;
const HECKLE_GAP_MS = 2500;
const MAX_HECKLES_SHOWN = 20;
const MAX_TYPED_LINES = 6;

export { cleanSwitchWord, isSwitchable, switchWord, toWords };

export const SIDE_LABELS = ['Pro', 'Con'] as const;
export type Side = 0 | 1;

interface SwitchInfo {
  index: number;
  from: string;
  to: string;
  /** Who switched it; null when the game did. */
  by: string | null;
}

interface Pitch {
  words: string[];
  switch: SwitchInfo | null;
  typed: string[];
}

interface Matchup {
  words: string[];
  /** [Pro, Con] */
  debaters: [string, string];
  pitches: [Pitch, Pitch];
}

interface Heckle { id: number; name: string; text: string }

// ─── Propositions ──────────────────────────────────────────────────────────────

/** A topic from the Prompt Manager as a statement to argue Pro or Con. Older "A vs B" topics read as "A over B". */
export function topicToProposition(raw: string): string {
  const text = raw.trim().replace(/\s+/g, ' ');
  const vs = text.match(/^(?:(.+?)[:?]\s+)?(.+?)\s+vs\.?\s+(.+)$/i);
  if (vs) return `${vs[1] ? `${vs[1].trim()}: ` : ''}${vs[2].trim()} over ${vs[3].trim()}`;
  return text;
}

/** Fill a template's {X} and {Y} with suggestions. */
export function fillTemplate(template: string, things: string[]): string {
  let i = 0;
  return template.replace(/\{[XY]\}/g, () => things[i++] || DEBATE_HOUSE_WORDS[0]);
}

const slotCount = (template: string) => (template.match(/\{[XY]\}/g) || []).length;

function shuffle<T>(list: T[]): T[] {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// ─── Game ──────────────────────────────────────────────────────────────────────

const pollKey = (state: GameState) => `debate-${state.gameData.currentRound}-${state.gameData.current}`;
const matchup = (state: GameState): Matchup => state.gameData.matchups[state.gameData.current];

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
  // Random sides, so the suggestion order doesn't decide who argues Pro.
  return pairs.map(([a, b]) => (Math.random() < 0.5 ? [a, b] : [b, a]));
}

export const debateDuelLogic = {
  onStart: async (state: GameState, isNextRound = false) => {
    if (state.playerOrder.length < 2) return;
    const targetRounds = state.gameData?.targetRounds || 1;
    const currentRound = isNextRound && state.gameData ? state.gameData.currentRound + 1 : 0;
    state.gameData = {
      ...state.gameData,
      currentRound,
      targetRounds,
      suggestions: {},
      matchups: [],
      current: 0,
      votes: {},
      ratings: {},
      lastHeckle: {},
      heckleSeq: state.gameData?.heckleSeq || 0,
    };

    state.phase = 'SUGGEST';
    state.hostData = {
      round: currentRound + 1,
      totalRounds: targetRounds,
      timerStart: Date.now(),
      timerDuration: SUGGEST_SECONDS,
      autoAdvanceAt: Date.now() + SUGGEST_SECONDS * 1000,
      autoAdvanceAction: 'FORCE_MATCHUPS',
    };
    for (const pid of state.playerOrder) state.playerData[pid] = { phase: 'SUGGEST', written: ['', ''] };
  },

  processAction: async (state: GameState, playerId: string, action: any) => {
    switch (action.type) {
      case 'SUBMIT_SUGGESTION': {
        if (state.phase !== 'SUGGEST') return;
        const slot = action.slot;
        const text = typeof action.text === 'string' ? action.text.replace(/\s+/g, ' ').trim().slice(0, MAX_SUGGESTION) : '';
        const pd = state.playerData[playerId];
        if (!pd || (slot !== 0 && slot !== 1) || !text) return;
        pd.written[slot] = text;
        state.gameData.suggestions[playerId] = pd.written.filter(Boolean);
        if (waitingFor(state, state.playerOrder).every((pid) => state.playerData[pid]?.written?.every(Boolean))) {
          await buildMatchups(state);
        }
        break;
      }

      case 'FORCE_MATCHUPS':
        if (playerId !== state.hostId || state.phase !== 'SUGGEST') return;
        await buildMatchups(state);
        break;

      case 'START_PITCH':
        if (playerId !== state.hostId || state.phase !== 'UP_NEXT') return;
        startPitch(state);
        break;

      case 'SUBMIT_PITCH_LINE': {
        if (state.phase !== 'PITCH' || playerId !== state.hostData.speakerId) return;
        const text = typeof action.text === 'string' ? action.text.trim() : '';
        const pitch = currentPitch(state);
        if (!text || pitch.typed.length >= MAX_TYPED_LINES) return;
        pitch.typed.push(text);
        state.hostData.typed = [...pitch.typed];
        break;
      }

      case 'SUBMIT_PITCH_DONE':
        if (state.phase !== 'PITCH' || playerId !== state.hostData.speakerId) return;
        endPitch(state);
        break;

      case 'SUBMIT_HECKLE': {
        if (state.phase !== 'PITCH' || playerId === state.hostData.speakerId || !state.players[playerId]) return;
        if (addHeckle(state, playerId, state.players[playerId].name, action.text)) bumpStat(state, 'heckles', playerId);
        break;
      }

      case 'SUBMIT_SWITCH': {
        if (state.phase !== 'PITCH' || state.hostData.switch) return;
        if (matchup(state).debaters.includes(playerId)) return; // the debaters can't sabotage
        if (Date.now() < state.hostData.switchOpensAt) return;
        const index = Number(action.index);
        const words: string[] = state.hostData.words;
        const word = cleanSwitchWord(action.word);
        if (!Number.isInteger(index) || !words[index] || !isSwitchable(words[index]) || !word) return;
        if (word.toLowerCase() === core(words[index]).toLowerCase()) return;
        applySwitch(state, index, word, playerId);
        if (state.players[playerId]) state.players[playerId].score += SWITCH_POINTS;
        bumpStat(state, 'switches', playerId);
        break;
      }

      case 'HOUSE_SWITCH':
        if (playerId !== state.hostId || state.phase !== 'PITCH' || state.hostData.switch) return;
        houseSwitch(state);
        break;

      case 'END_PITCH':
        if (playerId !== state.hostId || state.phase !== 'PITCH') return;
        endPitch(state);
        break;

      case 'SUBMIT_VOTE': {
        if (state.phase !== 'VERDICT' || state.hostData.mode !== 'vote') return;
        const m = matchup(state);
        const side = action.side;
        if (m.debaters.includes(playerId) || !state.players[playerId] || (side !== 0 && side !== 1)) return;
        (state.gameData.votes[state.gameData.current] ||= {})[playerId] = side;
        if (state.playerData[playerId]) state.playerData[playerId].chosen = side;
        const judges = waitingFor(state, state.playerOrder.filter((pid) => !m.debaters.includes(pid)));
        if (judges.every((pid) => state.gameData.votes[state.gameData.current]?.[pid] !== undefined)) tally(state);
        break;
      }

      case 'SUBMIT_RATING': {
        if (state.phase !== 'VERDICT' || state.hostData.mode !== 'rate') return;
        const m = matchup(state);
        const stars = Math.round(Number(action.stars));
        const mySide = m.debaters.indexOf(playerId);
        if (mySide < 0 || !(stars >= 1 && stars <= 5)) return;
        // You rate the other debater's pitch.
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

/** A heckle from a player or the audience. Returns false if it was dropped (too soon, empty, wrong moment). */
export function addHeckle(state: GameState, senderId: string, name: string, raw: unknown): boolean {
  if (state.gameType !== 'debate-duel' || state.phase !== 'PITCH' || senderId === state.hostData.speakerId) return false;
  const text = typeof raw === 'string' ? raw.replace(/\s+/g, ' ').trim().slice(0, MAX_HECKLE) : '';
  if (!text) return false;
  const now = Date.now();
  const last = state.gameData.lastHeckle?.[senderId] || 0;
  if (now - last < HECKLE_GAP_MS) return false;
  (state.gameData.lastHeckle ||= {})[senderId] = now;
  const id = (state.gameData.heckleSeq = (state.gameData.heckleSeq || 0) + 1);
  const heckles: Heckle[] = [...(state.hostData.heckles || []), { id, name, text }];
  state.hostData.heckles = heckles.slice(-MAX_HECKLES_SHOWN);
  return true;
}

async function buildMatchups(state: GameState) {
  const pairs = pairPlayers(state.playerOrder.filter((pid) => state.players[pid] && !state.players[pid].left));
  const things = shuffle(Object.values(state.gameData.suggestions as Record<string, string[]>).flat());
  const topics = await drawGameContent('debateTopics', pairs.length, state.settings?.packs);
  const templates = shuffle(DEBATE_TEMPLATES);

  state.gameData.matchups = pairs.map((debaters, i): Matchup => {
    const template = templates[i % templates.length];
    const need = slotCount(template);
    // Mostly the room's own suggestions; a written topic when they've run out (or now and then for variety).
    const useSuggestions = things.length >= need && (Math.random() < 0.8 || !topics[i]);
    const text = useSuggestions ? fillTemplate(template, things.splice(0, need)) : topicToProposition(topics[i] || fillTemplate(template, shuffle(DEBATE_HOUSE_WORDS)));
    const words = toWords(text.charAt(0).toUpperCase() + text.slice(1));
    return { words, debaters, pitches: [{ words, switch: null, typed: [] }, { words, switch: null, typed: [] }] };
  });
  state.gameData.current = 0;
  upNext(state, 0);
}

function speakerOf(state: GameState, side: Side) {
  return matchup(state).debaters[side];
}

function currentPitch(state: GameState): Pitch {
  return matchup(state).pitches[state.hostData.speakerSide as Side];
}

function baseHostData(state: GameState) {
  const m = matchup(state);
  return {
    round: state.gameData.currentRound + 1,
    totalRounds: state.gameData.targetRounds,
    matchNumber: state.gameData.current + 1,
    totalMatches: state.gameData.matchups.length,
    debaters: m.debaters,
    proposition: m.words,
  };
}

/** The moment before a pitch: who's up, which side, and the proposition. */
function upNext(state: GameState, side: Side) {
  const m = matchup(state);
  const seconds = side === 0 ? INTRO_SECONDS : HANDOFF_SECONDS;
  state.phase = 'UP_NEXT';
  state.hostData = {
    ...baseHostData(state),
    speakerSide: side,
    speakerId: speakerOf(state, side),
    matchId: `${state.gameData.currentRound}.${state.gameData.current}.${side}.next`,
    timerStart: Date.now(),
    timerDuration: seconds,
    autoAdvanceAt: Date.now() + seconds * 1000,
    autoAdvanceAction: 'START_PITCH',
  };
  for (const pid of state.playerOrder) {
    const mySide = m.debaters.indexOf(pid);
    state.playerData[pid] = { phase: 'UP_NEXT', mySide: mySide >= 0 ? mySide : null };
  }
}

function startPitch(state: GameState) {
  const side = state.hostData.speakerSide as Side;
  const pitch = matchup(state).pitches[side];
  const now = Date.now();
  state.phase = 'PITCH';
  state.hostData = {
    ...baseHostData(state),
    speakerSide: side,
    speakerId: speakerOf(state, side),
    words: pitch.words,
    switch: null,
    switchOpensAt: now + SWITCH_OPENS_AFTER * 1000,
    typed: [],
    heckles: [],
    matchId: `${state.gameData.currentRound}.${state.gameData.current}.${side}.pitch`,
    pitchEndsAt: now + PITCH_SECONDS * 1000,
    timerStart: now,
    timerDuration: PITCH_SECONDS,
    autoAdvanceAt: now + HOUSE_SWITCH_AFTER * 1000,
    autoAdvanceAction: 'HOUSE_SWITCH',
  };
  state.gameData.lastHeckle = {};
  for (const pid of state.playerOrder) {
    const mySide = matchup(state).debaters.indexOf(pid);
    state.playerData[pid] = { phase: 'PITCH', mySide: mySide >= 0 ? mySide : null, speaking: mySide === side };
  }
}

function applySwitch(state: GameState, index: number, word: string, by: string | null) {
  const pitch = currentPitch(state);
  const from = core(pitch.words[index]);
  pitch.words = switchWord(pitch.words, index, word);
  pitch.switch = { index, from, to: word, by };
  const byName = by ? state.players[by]?.name || null : null;
  state.hostData = {
    ...state.hostData,
    words: pitch.words,
    switch: { ...pitch.switch, byName },
    matchId: `${state.hostData.matchId}.switched`,
    // The rest of the pitch runs on; the timer now only needs to end it.
    autoAdvanceAt: state.hostData.pitchEndsAt,
    autoAdvanceAction: 'END_PITCH',
  };
}

function houseSwitch(state: GameState) {
  const words: string[] = state.hostData.words;
  const candidates = words.map((w, i) => i).filter((i) => isSwitchable(words[i]));
  if (!candidates.length) {
    state.hostData = { ...state.hostData, autoAdvanceAt: state.hostData.pitchEndsAt, autoAdvanceAction: 'END_PITCH' };
    return;
  }
  const index = candidates[Math.floor(Math.random() * candidates.length)];
  const from = core(words[index]).toLowerCase();
  const pool = DEBATE_HOUSE_WORDS.filter((w) => w.toLowerCase() !== from);
  applySwitch(state, index, pool[Math.floor(Math.random() * pool.length)], null);
}

function endPitch(state: GameState) {
  const side = state.hostData.speakerSide as Side;
  if (side === 0) upNext(state, 1);
  else startVerdict(state);
}

function startVerdict(state: GameState) {
  const m = matchup(state);
  const judges = state.playerOrder.filter((pid) => !m.debaters.includes(pid) && state.players[pid] && !state.players[pid].left);
  const mode = judges.length ? 'vote' : 'rate';
  state.phase = 'VERDICT';
  state.hostData = {
    ...baseHostData(state),
    mode,
    pitches: m.pitches.map((p) => ({ words: p.words, switch: p.switch, typed: p.typed })),
    matchId: `${state.gameData.currentRound}.${state.gameData.current}.verdict`,
    timerStart: Date.now(),
    timerDuration: VERDICT_SECONDS,
    autoAdvanceAt: Date.now() + VERDICT_SECONDS * 1000,
    autoAdvanceAction: 'FORCE_TALLY',
  };
  openAudienceVote(state, {
    key: pollKey(state),
    prompt: 'Who argued it better?',
    choices: m.debaters.map((pid, side) => ({ id: String(side), label: `${SIDE_LABELS[side]}: ${state.players[pid]?.name || '?'}` })),
  });
  for (const pid of state.playerOrder) {
    const mySide = m.debaters.indexOf(pid);
    if (mode === 'vote') {
      state.playerData[pid] = mySide >= 0
        ? { phase: 'VERDICT', mySide, waiting: true }
        : { phase: 'VERDICT', canVote: true, chosen: null };
    } else {
      state.playerData[pid] = mySide >= 0 ? { phase: 'VERDICT', mySide, canRate: true, chosen: null } : { phase: 'VERDICT', waiting: true };
    }
  }
}

function tally(state: GameState) {
  const idx: number = state.gameData.current;
  const m = matchup(state);
  const mode = state.hostData.mode as 'vote' | 'rate';
  const points: [number, number] = [0, 0];
  const tallyArr: [number, number] = [0, 0];
  const voters: [string[], string[]] = [[], []];
  let micDrop: Side | null = null;

  if (mode === 'vote') {
    for (const [voter, side] of Object.entries(state.gameData.votes[idx] || {}) as [string, Side][]) {
      tallyArr[side]++;
      voters[side].push(voter);
    }
    points[0] = tallyArr[0] * VOTE_POINTS;
    points[1] = tallyArr[1] * VOTE_POINTS;
    const total = tallyArr[0] + tallyArr[1];
    const leader: Side | null = tallyArr[0] === tallyArr[1] ? null : tallyArr[0] > tallyArr[1] ? 0 : 1;
    if (leader !== null && total >= 2 && tallyArr[leader] === total) {
      micDrop = leader;
      points[leader] += MIC_DROP_BONUS;
    }
  } else {
    // Each debater's rating is of the other's pitch.
    const ratings: Record<string, number> = state.gameData.ratings[idx] || {};
    m.debaters.forEach((pid, side) => {
      const stars = ratings[pid] || 0;
      const rated = (1 - side) as Side;
      tallyArr[rated] = stars;
      points[rated] = stars * STAR_POINTS;
    });
  }
  const winnerSide: Side | null = tallyArr[0] === tallyArr[1] ? null : tallyArr[0] > tallyArr[1] ? 0 : 1;

  const audience = closeAudienceVote(state, pollKey(state));
  const audienceFavorite: Side | null = audience.winner === '0' ? 0 : audience.winner === '1' ? 1 : null;
  if (audienceFavorite !== null) points[audienceFavorite] += AUDIENCE_FAVORITE_BONUS;

  m.debaters.forEach((pid, side) => {
    if (state.players[pid]) state.players[pid].score += points[side];
    if (mode === 'vote') bumpStat(state, 'votes', pid, tallyArr[side]);
  });
  if (winnerSide !== null) bumpStat(state, 'debatesWon', m.debaters[winnerSide]);
  if (micDrop !== null) bumpStat(state, 'micDrop', m.debaters[micDrop]);
  if (audienceFavorite !== null) bumpStat(state, 'audienceFavorite', m.debaters[audienceFavorite]);

  state.phase = 'VERDICT_RESULTS';
  state.hostData = {
    ...baseHostData(state),
    mode,
    pitches: m.pitches.map((p) => ({ words: p.words, switch: p.switch, typed: p.typed })),
    tally: tallyArr,
    voters,
    points,
    winnerSide,
    micDrop,
    audienceTally: audience.total > 0 ? [audience.tally['0'] || 0, audience.tally['1'] || 0] : null,
    audienceFavorite,
    matchId: `${state.gameData.currentRound}.${idx}.results`,
    timerStart: Date.now(),
    timerDuration: RESULTS_SECONDS,
    autoAdvanceAt: Date.now() + RESULTS_SECONDS * 1000,
    autoAdvanceAction: 'NEXT_MATCHUP',
  };
  for (const pid of state.playerOrder) state.playerData[pid] = { phase: 'VERDICT_RESULTS' };
}
