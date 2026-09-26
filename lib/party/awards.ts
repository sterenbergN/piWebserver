import type { GameState, GameType } from './types';

// Superlatives for the end-of-game screen. Games bump named counters while
// they run (`bumpStat`); at the end each game's award list picks whoever has
// the most (or, for "min" awards, the fewest) of a counter.

export function bumpStat(state: GameState, stat: string, playerId: string, amount = 1) {
  if (!state.players[playerId]) return;
  const stats = (state.gameData.stats ||= {}) as Record<string, Record<string, number>>;
  const bucket = (stats[stat] ||= {});
  bucket[playerId] = (bucket[playerId] || 0) + amount;
}

/** Keep the best value seen (e.g. biggest single-race win). */
export function maxStat(state: GameState, stat: string, playerId: string, value: number) {
  if (!state.players[playerId]) return;
  const stats = (state.gameData.stats ||= {}) as Record<string, Record<string, number>>;
  const bucket = (stats[stat] ||= {});
  bucket[playerId] = Math.max(bucket[playerId] ?? -Infinity, value);
}

type AwardDef = {
  stat: string;
  emoji: string;
  title: string;
  /** Detail line; `n` is the winning value. */
  detail: (n: number) => string;
  /** 'min' awards go to the lowest non-missing value among all players. */
  mode?: 'max' | 'min';
  /** Only award when the winning value reaches this. */
  atLeast?: number;
};

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

const AWARDS: Record<GameType, AwardDef[]> = {
  'quip-clash': [
    { stat: 'votes', emoji: '😂', title: 'Crowd Pleaser', detail: (n) => `${plural(n, 'vote')} in total`, atLeast: 1 },
    { stat: 'quiplash', emoji: '💥', title: 'Clean Sweep', detail: (n) => plural(n, 'unanimous win'), atLeast: 1 },
    { stat: 'audienceFavorite', emoji: '👀', title: 'Audience Darling', detail: (n) => `the audience's pick ${plural(n, 'time')}`, atLeast: 1 },
    { stat: 'votes', emoji: '🦗', title: 'Tough Crowd', detail: (n) => `only ${plural(n, 'vote')}`, mode: 'min' },
  ],
  'bracket-battles': [
    { stat: 'matchWins', emoji: '⚔️', title: 'Bracket Buster', detail: (n) => plural(n, 'match win'), atLeast: 1 },
    { stat: 'oracle', emoji: '🔮', title: 'Oracle', detail: () => 'called the champion', atLeast: 1 },
    { stat: 'votesReceived', emoji: '📣', title: 'Fan Favorite', detail: (n) => plural(n, 'vote'), atLeast: 1 },
  ],
  'the-faker': [
    { stat: 'escapes', emoji: '🎭', title: 'Master of Disguise', detail: (n) => `escaped ${plural(n, 'time')} as the faker`, atLeast: 1 },
    { stat: 'detective', emoji: '🔍', title: 'Detective', detail: (n) => `spotted the faker ${plural(n, 'time')}`, atLeast: 1 },
    { stat: 'suspected', emoji: '🤨', title: 'Most Suspicious', detail: (n) => `${plural(n, 'vote')} while innocent`, atLeast: 2 },
  ],
  'trivia-death': [
    { stat: 'correct', emoji: '🧠', title: 'Brainiac', detail: (n) => plural(n, 'right answer'), atLeast: 1 },
    { stat: 'survived', emoji: '🩸', title: 'Survivor', detail: (n) => `lived through the Killing Floor ${plural(n, 'time')}`, atLeast: 1 },
    { stat: 'resurrected', emoji: '🧟', title: 'Back From the Dead', detail: (n) => `resurrected ${plural(n, 'time')}`, atLeast: 1 },
    { stat: 'deaths', emoji: '⚰️', title: 'Frequent Ghost', detail: (n) => `died ${plural(n, 'time')}`, atLeast: 2 },
  ],
  'ready-set-bet': [
    { stat: 'bigWin', emoji: '💰', title: 'Big Winner', detail: (n) => `+$${n} in one race`, atLeast: 1 },
    { stat: 'bets', emoji: '🎰', title: 'High Roller', detail: (n) => plural(n, 'bet'), atLeast: 1 },
    { stat: 'longshots', emoji: '🐴', title: 'Longshot Legend', detail: (n) => `cashed ${plural(n, 'longshot')}`, atLeast: 1 },
  ],
};

export type Award = { emoji: string; title: string; detail: string; playerIds: string[] };

export function computeAwards(state: GameState): Award[] {
  const stats = (state.gameData?.stats || {}) as Record<string, Record<string, number>>;
  const awards: Award[] = [];
  for (const def of AWARDS[state.gameType] || []) {
    const bucket = stats[def.stat] || {};
    // 'min' awards compare every player (a missing counter counts as 0).
    const entries = def.mode === 'min'
      ? state.playerOrder.map((pid) => [pid, bucket[pid] || 0] as const)
      : Object.entries(bucket).filter(([pid]) => state.players[pid]);
    if (entries.length === 0) continue;
    const best = def.mode === 'min' ? Math.min(...entries.map(([, n]) => n)) : Math.max(...entries.map(([, n]) => n));
    if (def.atLeast !== undefined && best < def.atLeast) continue;
    const winners = entries.filter(([, n]) => n === best).map(([pid]) => pid);
    // A "min" award shared by everyone says nothing.
    if (def.mode === 'min' && winners.length === state.playerOrder.length) continue;
    awards.push({ emoji: def.emoji, title: def.title, detail: def.detail(best), playerIds: winners });
  }
  return awards;
}
