// Every arcade game: its id (the ?game= value and leaderboard key), how it's
// listed, and what a believable score looks like (checked by the leaderboard API).

import { MAX_SCORE as SNAKE_MAX, POINTS_PER_FOOD } from './snake';
import { MAX_2048_SCORE } from './g2048';
import { MAX_BREAKOUT_SCORE } from './breakout';
import { MAX_BLOCKS_SCORE } from './blocks';
import { MAX_FLAP_SCORE } from './flap';
import { MAX_SETPOINT_SCORE } from './setpoint';
import { MAX_CHAIN_SCORE } from './chain';
import { MAX_MERGE_SCORE } from './mergesnake';

export type GameInfo = {
  id: string;
  emoji: string;
  label: string;
  /** Classic arcade game, or one made for this site. */
  kind: 'classic' | 'original';
  blurb: string;
  /** How you play, in a few words. */
  controls: string;
  /** Whether `score` could come from a real game. */
  valid: (score: number) => boolean;
};

export const GAMES = [
  { id: 'snake', emoji: '🐍', label: 'Snake', kind: 'classic', blurb: 'Eat, grow, don’t bite yourself.', controls: 'Arrow keys or swipe', valid: (s: number) => s <= SNAKE_MAX && s % POINTS_PER_FOOD === 0 },
  { id: '2048', emoji: '🔢', label: '2048', kind: 'classic', blurb: 'Slide and merge tiles.', controls: 'Arrow keys or swipe', valid: (s: number) => s <= MAX_2048_SCORE && s % 2 === 0 },
  { id: 'breakout', emoji: '🧱', label: 'Breakout', kind: 'classic', blurb: 'Bounce the ball, clear the wall.', controls: 'Mouse or drag; tap to launch', valid: (s: number) => s <= MAX_BREAKOUT_SCORE && s % 10 === 0 },
  { id: 'blocks', emoji: '🟪', label: 'Blocks', kind: 'classic', blurb: 'Falling blocks: fill lines to clear them.', controls: 'Arrow keys, or tap and drag', valid: (s: number) => s <= MAX_BLOCKS_SCORE },
  { id: 'flap', emoji: '🐤', label: 'Flap', kind: 'classic', blurb: 'Tap to flap through the gaps.', controls: 'Tap or press Space', valid: (s: number) => s <= MAX_FLAP_SCORE },
  { id: 'setpoint', emoji: '🎛️', label: 'Setpoint', kind: 'original', blurb: 'You’re the controller: hold the process in the band.', controls: 'Hold to drive up, let go to fall', valid: (s: number) => s <= MAX_SETPOINT_SCORE },
  { id: 'chain', emoji: '💥', label: 'Chain Reaction', kind: 'original', blurb: 'One tap. Set off the biggest chain you can.', controls: 'One tap per level', valid: (s: number) => s <= MAX_CHAIN_SCORE && s % 10 === 0 },
  { id: 'merge', emoji: '🔗', label: 'Merge Snake', kind: 'original', blurb: 'Snake meets 2048: eat numbers in the right order and your body merges.', controls: 'Arrow keys or the on-screen pad', valid: (s: number) => s <= MAX_MERGE_SCORE && s % 2 === 0 },
] as const satisfies readonly GameInfo[];

export type GameId = (typeof GAMES)[number]['id'];
export const isGameId = (g: unknown): g is GameId => GAMES.some((x) => x.id === g);
export const gameInfo = (id: GameId) => GAMES.find((g) => g.id === id)!;
