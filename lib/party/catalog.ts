// The one list of party games. The picker, game switchers, rules modal and engine all read from
// here, so adding or hiding a game is a single change. Safe to import from client components.

import type { GameType } from './types';

export type GameCategory = 'race' | 'comedy' | 'deception' | 'minds';
export type GameColor = 'cyan' | 'yellow' | 'red' | 'purple-lt' | 'green';

export interface GameInfo {
  id: GameType;
  name: string;
  emoji: string;
  color: GameColor;
  category: GameCategory;
  blurb: string;
  minPlayers: number;
  maxPlayers: number;
  /** Drawn on one shared screen, so a phones-only room can't play it. */
  tvOnly?: boolean;
}

export const GAME_CATEGORIES: { id: GameCategory; label: string; emoji: string }[] = [
  { id: 'race', label: 'Race & Bet', emoji: '🏁' },
  { id: 'comedy', label: 'Funny Answers', emoji: '😂' },
  { id: 'deception', label: 'Lies & Spies', emoji: '🕵️' },
  { id: 'minds', label: 'Brains & Instincts', emoji: '🧠' },
];

export const GAME_CATALOG: GameInfo[] = [
  { id: 'kart-clash', name: 'Kart Clash', emoji: '🏎️', color: 'cyan', category: 'race', blurb: '3D kart racing on the TV. Your phone is the steering wheel.', minPlayers: 1, maxPlayers: 16, tvOnly: true },
  { id: 'ready-set-bet', name: 'Ready Set Bet', emoji: '🐎', color: 'green', category: 'race', blurb: 'Bet live as dice-powered horses race to the finish.', minPlayers: 1, maxPlayers: 16 },
  { id: 'quip-clash', name: 'Quip Clash', emoji: '⚡', color: 'yellow', category: 'comedy', blurb: 'Answer silly prompts, then vote for the funniest.', minPlayers: 3, maxPlayers: 8 },
  { id: 'bracket-battles', name: 'Bracket Battles', emoji: '🏆', color: 'cyan', category: 'comedy', blurb: 'Your wildest answers fight it out, tournament-style.', minPlayers: 3, maxPlayers: 16 },
  { id: 'emoji-telephone', name: 'Emoji Telephone', emoji: '🔗', color: 'green', category: 'comedy', blurb: 'Translate to emoji, decode, and watch the chain derail.', minPlayers: 3, maxPlayers: 12 },
  { id: 'the-faker', name: 'The Faker', emoji: '🕵️', color: 'red', category: 'deception', blurb: 'Everyone gets a task except the Faker. Vote them out.', minPlayers: 3, maxPlayers: 8 },
  { id: 'spyfall', name: 'Spyfall', emoji: '🕵️‍♀️', color: 'red', category: 'deception', blurb: 'One spy doesn’t know the location. Question each other.', minPlayers: 3, maxPlayers: 12 },
  { id: 'bluff-clash', name: 'Bluff Clash', emoji: '🤥', color: 'yellow', category: 'deception', blurb: 'Write believable fakes for bizarre facts and fool friends.', minPlayers: 3, maxPlayers: 16 },
  { id: 'trivia-death', name: 'Trivia Death', emoji: '💀', color: 'purple-lt', category: 'minds', blurb: 'Answer right or face the Killing Floor. Die, become a ghost.', minPlayers: 3, maxPlayers: 8 },
  { id: 'wavelength', name: 'Wavelength', emoji: '📡', color: 'cyan', category: 'minds', blurb: 'One clue on a wild spectrum. Dial in the bullseye.', minPlayers: 2, maxPlayers: 16 },
  { id: 'herd-mentality', name: 'Herd Mentality', emoji: '🐄', color: 'purple-lt', category: 'minds', blurb: 'Think like the crowd, or get stuck with the Pink Cow.', minPlayers: 3, maxPlayers: 16 },
];

export const GAME_INFO = Object.fromEntries(GAME_CATALOG.map((g) => [g.id, g])) as Record<GameType, GameInfo>;

/** Display name with its emoji, e.g. "🏎️ Kart Clash". */
export const gameLabel = (g: GameInfo) => `${g.emoji} ${g.name}`;

export const gamePlayersLabel = (g: GameInfo) => `${g.minPlayers}–${g.maxPlayers}`;

/** The games a room can offer. Phones-only rooms never see TV-only games at all. */
export function gamesForRoom(phonesOnly: boolean): GameInfo[] {
  return phonesOnly ? GAME_CATALOG.filter((g) => !g.tvOnly) : GAME_CATALOG;
}

export const PLAYER_BUCKETS = [
  { id: 'any', label: 'Any', min: 1, max: 16 },
  { id: '1-2', label: '1–2', min: 1, max: 2 },
  { id: '3-4', label: '3–4', min: 3, max: 4 },
  { id: '5-8', label: '5–8', min: 5, max: 8 },
  { id: '9+', label: '9+', min: 9, max: 16 },
] as const;
export type PlayerBucket = (typeof PLAYER_BUCKETS)[number]['id'];

export function fitsBucket(game: GameInfo, bucketId: PlayerBucket): boolean {
  const bucket = PLAYER_BUCKETS.find((b) => b.id === bucketId) || PLAYER_BUCKETS[0];
  return game.minPlayers <= bucket.max && game.maxPlayers >= bucket.min;
}
