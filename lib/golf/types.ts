// Golf and disc golf: one model for both sports. A round is stored once and
// belongs to every account playing in it; courses are shared by everyone.

export type Sport = 'golf' | 'disc';
export type LatLon = { lat: number; lon: number };
/** A GPS reading: `acc` is the phone's own accuracy estimate in metres. */
export type Fix = LatLon & { acc: number; at: string };

export type CourseHole = {
  n: number;
  par: number;
  /** Yards for golf, feet for disc golf, as printed on the card. */
  length?: number;
  /** Stroke index, 1 = hardest. */
  si?: number;
  tee?: LatLon;
  /** The pin or the basket. */
  target?: LatLon;
};

/** Golf: a set of tees. Disc golf: a layout (long tees, short tees, A pins…). */
export type Layout = {
  id: string;
  name: string;
  /** WHS course rating and slope, golf only. Both are needed for a handicap. */
  rating?: number;
  slope?: number;
  holes: CourseHole[];
};

export type Course = {
  id: string;
  sport: Sport;
  name: string;
  center?: LatLon;
  /** Set when the holes came from OpenStreetMap. */
  osm?: string;
  layouts: Layout[];
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
};

export type Fairway = 'hit' | 'left' | 'right' | 'short';
/** Made and tried putts in a putting circle (disc golf). */
export type Putts = [made: number, tries: number];

export type HoleScore = {
  strokes: number;
  putts?: number;
  penalties?: number;
  fairway?: Fairway;
  c1?: Putts;
  c2?: Putts;
  /** When this was last changed, so edits from two phones merge. */
  at: string;
};

export type Player = { id: string; name: string; userId?: string };

export type ShotKind = 'drive' | 'approach' | 'other';
export type Shot = {
  id: string;
  playerId: string;
  /** Hole index, from 0. */
  hole: number;
  kind: ShotKind;
  clubId?: string;
  discId?: string;
  from: Fix;
  to?: Fix;
  /** Thrown and not found (yet). */
  lost?: boolean;
  deleted?: boolean;
  at: string;
};

export type Round = {
  id: string;
  sport: Sport;
  courseId: string | null;
  courseName: string;
  layoutId: string | null;
  layoutName: string | null;
  /** Copied from the layout when the round starts, so later course edits don't rewrite history. */
  rating?: number;
  slope?: number;
  si?: number[];
  date: string;
  /** The account that started it; null for a round kept on a device. */
  scorerId: string | null;
  /** Lets a friend open the round and claim their name. */
  joinCode: string;
  players: Player[];
  pars: number[];
  parsAt: string[];
  /** scores[playerId][hole] */
  scores: Record<string, (HoleScore | null)[]>;
  shots: Shot[];
  finishedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

/** One change to a round. The server and the phone apply the same ones. */
export type RoundOp =
  | { type: 'score'; playerId: string; hole: number; score: HoleScore | null; at: string }
  | { type: 'par'; hole: number; par: number; at: string }
  | { type: 'shot'; shot: Shot }
  | { type: 'players'; players: Player[]; at: string }
  | { type: 'finish'; finished: boolean; at: string };

/** What a round list needs without opening every round. */
export type RoundSummary = {
  id: string;
  sport: Sport;
  date: string;
  courseId: string | null;
  courseName: string;
  holes: number;
  scorerId: string | null;
  userIds: string[];
  players: string[];
  finishedAt: string | null;
  updatedAt: string;
};

export type ThrowHand = 'RHBH' | 'RHFH' | 'LHBH' | 'LHFH';

export type Club = { id: string; name: string };
export type Disc = {
  id: string;
  name: string;
  brand?: string;
  plastic?: string;
  weight?: number;
  color?: string;
  speed: number;
  glide: number;
  turn: number;
  fade: number;
  inBag: boolean;
  lost?: { at: string; where: LatLon };
};

export type GolfUser = {
  clubs: Club[];
  discs: Disc[];
  hand: ThrowHand;
  units: 'imperial' | 'metric';
  /** Which shot screens keep the phone awake. */
  keepAwake: boolean;
};
