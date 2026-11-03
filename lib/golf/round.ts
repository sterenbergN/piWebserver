// Rounds: making one, checking what comes in, and applying changes. The phone and
// the server run the same code, so a change made offline lands the same way later.
// Every score, par and shot carries the time it was changed and the newer one wins,
// so two phones scoring the same round can't wipe each other out.

import type { Course, Fairway, Fix, HoleScore, Layout, Player, Putts, Round, RoundOp, RoundSummary, Shot, Sport } from './types';

export const MAX_PLAYERS = 8;
/** Stands in for an account on rounds kept on a phone while signed out. */
export const DEVICE_PLAYER = 'device';
export const MAX_SHOTS = 600;
const FAIRWAYS: Fairway[] = ['hit', 'left', 'right', 'short'];

export function newId(length = 12) {
  try {
    return crypto.randomUUID().replace(/-/g, '').slice(0, length);
  } catch {
    return Array.from({ length }, () => Math.floor(Math.random() * 36).toString(36)).join('');
  }
}

/** Six letters and digits that are hard to mix up when read out. */
export function newJoinCode() {
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  const bytes = new Uint8Array(6);
  try { crypto.getRandomValues(bytes); } catch { bytes.forEach((_, i) => { bytes[i] = Math.floor(Math.random() * 256); }); }
  return [...bytes].map((b) => alphabet[b % alphabet.length]).join('');
}

const str = (v: unknown, max: number, fallback = '') => (typeof v === 'string' ? v.trim().slice(0, max) : fallback);
const int = (v: unknown, min: number, max: number): number | undefined => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : undefined;
};
/** A whole number in [0, length), or undefined: out-of-range positions are refused, not moved. */
const index = (v: unknown, length: number): number | undefined => {
  const n = Number(v);
  return Number.isInteger(n) && n >= 0 && n < length ? n : undefined;
};
const EPOCH = '1970-01-01T00:00:00.000Z';
const time = (v: unknown, fallback: string) => (typeof v === 'string' && !Number.isNaN(Date.parse(v)) ? new Date(v).toISOString() : fallback);
const isId = (v: unknown): v is string => typeof v === 'string' && /^[\w-]{1,64}$/.test(v);

export function defaultPar(sport: Sport) {
  return sport === 'golf' ? 4 : 3;
}

export function cleanFix(v: any): Fix | undefined {
  const lat = Number(v?.lat);
  const lon = Number(v?.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return undefined;
  const acc = Number(v?.acc);
  return { lat, lon, acc: Number.isFinite(acc) && acc >= 0 ? Math.min(5000, acc) : 50, at: time(v?.at, new Date().toISOString()) };
}

function cleanPutts(v: unknown): Putts | undefined {
  if (!Array.isArray(v)) return undefined;
  const tries = int(v[1], 0, 20);
  const made = int(v[0], 0, 20);
  if (tries === undefined || made === undefined || tries === 0) return undefined;
  return [Math.min(made, tries), tries];
}

export function cleanScore(v: any, now: string): HoleScore | null {
  const strokes = int(v?.strokes, 1, 20);
  if (!v || strokes === undefined) return null;
  const score: HoleScore = { strokes, at: time(v.at, now) };
  const putts = int(v.putts, 0, strokes);
  if (putts !== undefined && v.putts !== null && v.putts !== '') score.putts = putts;
  const penalties = int(v.penalties, 0, strokes);
  if (penalties) score.penalties = penalties;
  if (FAIRWAYS.includes(v.fairway)) score.fairway = v.fairway;
  const c1 = cleanPutts(v.c1);
  if (c1) score.c1 = c1;
  const c2 = cleanPutts(v.c2);
  if (c2) score.c2 = c2;
  return score;
}

export function cleanShot(v: any, holes: number, players: Player[], now: string): Shot | null {
  const from = cleanFix(v?.from);
  const hole = index(v?.hole, holes);
  if (!isId(v?.id) || !from || hole === undefined || !players.some((p) => p.id === v.playerId)) return null;
  const shot: Shot = {
    id: v.id,
    playerId: v.playerId,
    hole,
    kind: v.kind === 'drive' || v.kind === 'approach' ? v.kind : 'other',
    from,
    at: time(v.at, now),
  };
  const to = cleanFix(v.to);
  if (to) shot.to = to;
  if (isId(v.clubId)) shot.clubId = v.clubId;
  if (isId(v.discId)) shot.discId = v.discId;
  if (v.lost === true) shot.lost = true;
  if (v.deleted === true) shot.deleted = true;
  return shot;
}

function cleanPlayers(v: unknown): Player[] {
  if (!Array.isArray(v)) return [];
  const seen = new Set<string>();
  const out: Player[] = [];
  for (const p of v) {
    if (!isId(p?.id) || seen.has(p.id)) continue;
    seen.add(p.id);
    const player: Player = { id: p.id, name: str(p.name, 40) || `Player ${out.length + 1}` };
    if (isId(p.userId)) player.userId = p.userId;
    out.push(player);
    if (out.length === MAX_PLAYERS) break;
  }
  return out;
}

/** A round as stored or sent: anything malformed is dropped or put back in range. */
export function normalizeRound(raw: any): Round | null {
  if (!raw || typeof raw !== 'object' || !isId(raw.id)) return null;
  const now = new Date().toISOString();
  const sport: Sport = raw.sport === 'disc' ? 'disc' : 'golf';
  const holes = int(Array.isArray(raw.pars) ? raw.pars.length : 0, 1, 36) ?? 18;
  const pars = Array.from({ length: holes }, (_, i) => int(raw.pars?.[i], 2, 7) ?? defaultPar(sport));
  const parsAt = Array.from({ length: holes }, (_, i) => time(raw.parsAt?.[i], EPOCH));
  const players = cleanPlayers(raw.players);
  if (!players.length) return null;
  const scores: Round['scores'] = {};
  for (const p of players) {
    const list = Array.isArray(raw.scores?.[p.id]) ? raw.scores[p.id] : [];
    scores[p.id] = Array.from({ length: holes }, (_, i) => cleanScore(list[i], now));
  }
  const shots = (Array.isArray(raw.shots) ? raw.shots : [])
    .map((s: unknown) => cleanShot(s, holes, players, now))
    .filter((s: Shot | null): s is Shot => s !== null)
    .slice(-MAX_SHOTS);
  const rating = Number(raw.rating);
  const slope = Number(raw.slope);
  const round: Round = {
    id: raw.id,
    sport,
    courseId: isId(raw.courseId) ? raw.courseId : null,
    courseName: str(raw.courseName, 80) || 'Round',
    layoutId: isId(raw.layoutId) ? raw.layoutId : null,
    layoutName: str(raw.layoutName, 40) || null,
    date: time(raw.date, now),
    scorerId: isId(raw.scorerId) ? raw.scorerId : null,
    joinCode: typeof raw.joinCode === 'string' && /^[A-Z0-9]{6}$/.test(raw.joinCode) ? raw.joinCode : newJoinCode(),
    players,
    pars,
    parsAt,
    scores,
    shots,
    finishedAt: typeof raw.finishedAt === 'string' ? time(raw.finishedAt, now) : null,
    createdAt: time(raw.createdAt, now),
    updatedAt: time(raw.updatedAt, now),
  };
  if (sport === 'golf' && rating >= 20 && rating <= 90 && slope >= 55 && slope <= 155) {
    round.rating = Math.round(rating * 10) / 10;
    round.slope = Math.round(slope);
  }
  if (Array.isArray(raw.si) && raw.si.length === holes) {
    const si = raw.si.map((n: unknown) => int(n, 1, holes));
    if (si.every((n: number | undefined) => n !== undefined)) round.si = si as number[];
  }
  return round;
}

/** A new round on a course layout (or on no course: pars start at the sport's usual). */
export function createRound(input: {
  sport: Sport;
  course?: Course | null;
  layout?: Layout | null;
  courseName?: string;
  holes?: number;
  players: Player[];
  scorerId: string | null;
  date?: string;
}): Round {
  const now = new Date().toISOString();
  const { sport, course, layout } = input;
  const holes = layout?.holes.length || input.holes || 18;
  const round: Round = {
    id: newId(),
    sport,
    courseId: course?.id ?? null,
    courseName: course?.name || input.courseName?.trim() || 'Round',
    layoutId: layout?.id ?? null,
    layoutName: layout?.name ?? null,
    date: input.date || now,
    scorerId: input.scorerId,
    joinCode: newJoinCode(),
    players: input.players.slice(0, MAX_PLAYERS),
    pars: Array.from({ length: holes }, (_, i) => layout?.holes[i]?.par || defaultPar(sport)),
    // Pars from the card are a starting point: any change made on the course wins.
    parsAt: Array(holes).fill(EPOCH),
    scores: Object.fromEntries(input.players.map((p) => [p.id, Array(holes).fill(null)])),
    shots: [],
    finishedAt: null,
    createdAt: now,
    updatedAt: now,
  };
  if (sport === 'golf' && layout?.rating && layout.slope) {
    round.rating = layout.rating;
    round.slope = layout.slope;
  }
  if (layout && layout.holes.length && layout.holes.every((h) => h.si)) round.si = layout.holes.map((h) => h.si!);
  return round;
}

/** Check one incoming change. Returns null when it's malformed or out of range. */
export function cleanOp(raw: any, round: Round): RoundOp | null {
  const now = new Date().toISOString();
  const holes = round.pars.length;
  const at = time(raw?.at, now);
  switch (raw?.type) {
    case 'score': {
      const hole = index(raw.hole, holes);
      if (hole === undefined || !round.players.some((p) => p.id === raw.playerId)) return null;
      const score = raw.score === null ? null : cleanScore({ ...raw.score, at }, now);
      if (raw.score !== null && !score) return null;
      return { type: 'score', playerId: raw.playerId, hole, score, at };
    }
    case 'par': {
      const hole = index(raw.hole, holes);
      const par = int(raw.par, 2, 7);
      return hole === undefined || par === undefined ? null : { type: 'par', hole, par, at };
    }
    case 'shot': {
      const players = round.players;
      const shot = cleanShot(raw.shot, holes, players, now);
      return shot ? { type: 'shot', shot } : null;
    }
    case 'players': {
      const players = cleanPlayers(raw.players);
      return players.length ? { type: 'players', players, at } : null;
    }
    case 'finish':
      return { type: 'finish', finished: raw.finished === true, at };
    default:
      return null;
  }
}

const newer = (incoming: string, existing: string | undefined) => !existing || incoming >= existing;

/** Apply changes in place. Older changes than what's there are skipped. */
export function applyOps(round: Round, ops: RoundOp[]): Round {
  for (const op of ops) {
    if (op.type === 'score') {
      const list = round.scores[op.playerId];
      if (!list) continue;
      const existing = list[op.hole];
      if (!newer(op.at, existing?.at)) continue;
      list[op.hole] = op.score ? { ...op.score, at: op.at } : null;
    } else if (op.type === 'par') {
      if (!newer(op.at, round.parsAt[op.hole])) continue;
      round.pars[op.hole] = op.par;
      round.parsAt[op.hole] = op.at;
    } else if (op.type === 'shot') {
      const i = round.shots.findIndex((s) => s.id === op.shot.id);
      if (i === -1) {
        if (round.shots.length < MAX_SHOTS) round.shots.push(op.shot);
      } else if (newer(op.shot.at, round.shots[i].at)) {
        round.shots[i] = op.shot;
      }
    } else if (op.type === 'players') {
      // Renames and new guests. A player already claimed by an account keeps that account,
      // and nobody is dropped here: taking someone out goes through the server on its own.
      const byId = new Map(round.players.map((p) => [p.id, p]));
      for (const p of op.players) {
        const existing = byId.get(p.id);
        if (existing) existing.name = p.name;
        else if (round.players.length < MAX_PLAYERS) {
          const added: Player = { id: p.id, name: p.name };
          round.players.push(added);
          byId.set(p.id, added);
          round.scores[p.id] = Array(round.pars.length).fill(null);
        }
      }
    } else if (op.type === 'finish') {
      round.finishedAt = op.finished ? (round.finishedAt || op.at) : null;
    }
    round.updatedAt = new Date().toISOString();
  }
  return round;
}

export type PlayerTotals = { strokes: number; par: number; toPar: number; played: number; putts: number | null };

export function playerTotals(round: Round, playerId: string, from = 0, to = round.pars.length): PlayerTotals {
  let strokes = 0, par = 0, played = 0, putts = 0, puttHoles = 0;
  const list = round.scores[playerId] || [];
  for (let i = from; i < to; i++) {
    const s = list[i];
    if (!s) continue;
    strokes += s.strokes;
    par += round.pars[i];
    played++;
    if (s.putts !== undefined) { putts += s.putts; puttHoles++; }
  }
  return { strokes, par, toPar: strokes - par, played, putts: puttHoles ? putts : null };
}

export const formatToPar = (n: number) => (n > 0 ? `+${n}` : n === 0 ? 'E' : `${n}`);

export type ScoreName = 'ace' | 'albatross' | 'eagle' | 'birdie' | 'par' | 'bogey' | 'double' | 'worse';

export function scoreName(strokes: number | null | undefined, par: number): ScoreName | null {
  if (!strokes) return null;
  if (strokes === 1 && par > 1) return 'ace';
  const d = strokes - par;
  return d <= -3 ? 'albatross' : d === -2 ? 'eagle' : d === -1 ? 'birdie' : d === 0 ? 'par' : d === 1 ? 'bogey' : d === 2 ? 'double' : 'worse';
}

/** Golf: on the green in par − 2 strokes or fewer (penalty strokes count). Needs putts entered. */
export function hitGreen(score: HoleScore | null | undefined, par: number): boolean | null {
  if (!score || score.putts === undefined) return null;
  return score.strokes - score.putts <= par - 2;
}

/** The first hole someone still needs a score on, for picking a round back up. */
export function nextHole(round: Round): number {
  const i = round.pars.findIndex((_, h) => round.players.some((p) => !round.scores[p.id]?.[h]));
  return i === -1 ? round.pars.length - 1 : i;
}

/** Whether every player has a score on every hole. */
export function isComplete(round: Round) {
  return round.players.every((p) => round.scores[p.id]?.every(Boolean));
}

export function summarize(round: Round): RoundSummary {
  return {
    id: round.id,
    sport: round.sport,
    date: round.date,
    courseId: round.courseId,
    courseName: round.courseName,
    holes: round.pars.length,
    scorerId: round.scorerId,
    userIds: [...new Set([round.scorerId, ...round.players.map((p) => p.userId)].filter((id): id is string => !!id))],
    players: round.players.map((p) => p.name),
    finishedAt: round.finishedAt,
    updatedAt: round.updatedAt,
  };
}

/** Whether an account may see and change a round. */
export function canAccess(round: Round, userId: string) {
  return round.scorerId === userId || round.players.some((p) => p.userId === userId);
}

/** The player in a round who is this account, if any. */
export function playerFor(round: Round, userId: string | null | undefined) {
  return userId ? round.players.find((p) => p.userId === userId) || null : null;
}

/**
 * A round from the old Tools scorecard ({ courseName, pars, players: [{ name, scores }] }).
 * `meName` is the player who becomes this account.
 */
export function fromLegacy(raw: any, scorerId: string | null, meName: string | null): Round | null {
  if (!raw || !Array.isArray(raw.pars) || !Array.isArray(raw.players)) return null;
  const holes = raw.pars.length === 9 ? 9 : 18;
  const at = time(raw.date, new Date().toISOString());
  const players: Player[] = raw.players
    .filter((p: any) => p && typeof p.name === 'string')
    .slice(0, MAX_PLAYERS)
    .map((p: any, i: number) => {
      const player: Player = { id: `p${i + 1}`, name: str(p.name, 40) || `Player ${i + 1}` };
      if (scorerId && meName && player.name === meName) player.userId = scorerId;
      return player;
    });
  if (!players.length) return null;
  // Only the first player with that name is you.
  let claimed = false;
  for (const p of players) {
    if (p.userId && claimed) delete p.userId;
    if (p.userId) claimed = true;
  }
  const scores: Round['scores'] = {};
  raw.players.slice(0, players.length).forEach((p: any, i: number) => {
    scores[players[i].id] = Array.from({ length: holes }, (_, h) => {
      const s = int(p.scores?.[h], 1, 20);
      return s === undefined || !p.scores?.[h] ? null : { strokes: s, at };
    });
  });
  const round = normalizeRound({
    id: `old${str(String(raw.id ?? ''), 40).replace(/[^\w-]/g, '') || newId(8)}`.slice(0, 64),
    sport: 'golf',
    courseName: str(raw.courseName, 80) || 'Round',
    date: at,
    scorerId,
    players,
    pars: Array.from({ length: holes }, (_, i) => int(raw.pars[i], 3, 6) ?? 4),
    parsAt: Array(holes).fill(at),
    scores,
    shots: [],
    createdAt: at,
    updatedAt: at,
  });
  if (round && isComplete(round)) round.finishedAt = at;
  return round;
}
