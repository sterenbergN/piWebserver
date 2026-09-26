// Golf round scoring. A round stores one par per hole (9 or 18) and each
// player's strokes per hole (null until entered).

export interface GolfPlayer { name: string; scores: (number | null)[] }
export interface GolfGame { id: string; date: string; courseName: string; pars: number[]; players: GolfPlayer[] }

export const MAX_PLAYERS = 6;

export function newGame(holes: 9 | 18, playerNames: string[], courseName = ''): GolfGame {
  return {
    id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    date: new Date().toISOString(),
    courseName: courseName.trim() || 'Round',
    pars: Array(holes).fill(4),
    players: playerNames.map((name, i) => ({ name: name.trim() || `Player ${i + 1}`, scores: Array(holes).fill(null) })),
  };
}

/** Clean up a stored round (older versions always had 4 players and 18 holes). */
export function normalizeGame(raw: any): GolfGame | null {
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.pars) || !Array.isArray(raw.players)) return null;
  const holes = raw.pars.length === 9 ? 9 : 18;
  const pars = Array.from({ length: holes }, (_, i) => { const p = Number(raw.pars[i]); return p >= 3 && p <= 6 ? p : 4; });
  const players = raw.players
    .filter((p: any) => p && typeof p.name === 'string')
    .map((p: any) => ({ name: p.name, scores: Array.from({ length: holes }, (_, i) => { const s = Number(p.scores?.[i]); return s >= 1 && s <= 20 ? s : null; }) }))
    .slice(0, MAX_PLAYERS);
  if (!players.length) return null;
  return { id: String(raw.id || Date.now()), date: raw.date || new Date().toISOString(), courseName: String(raw.courseName || 'Round'), pars, players };
}

export type PlayerSummary = { strokes: number; par: number; toPar: number; played: number; projected: number | null };

/** Totals over the holes a player has scored (so "to par" is fair mid-round). */
export function summarize(player: GolfPlayer, pars: number[], from = 0, to = pars.length): PlayerSummary {
  let strokes = 0, par = 0, played = 0;
  for (let i = from; i < to; i++) {
    const s = player.scores[i];
    if (s) { strokes += s; par += pars[i]; played++; }
  }
  const holes = to - from;
  const coursePar = pars.slice(from, to).reduce((a, b) => a + b, 0);
  const projected = played > 0 && played < holes ? Math.round(coursePar + ((strokes - par) / played) * holes) : null;
  return { strokes, par, toPar: strokes - par, played, projected };
}

export const formatToPar = (n: number) => (n > 0 ? `+${n}` : n === 0 ? 'E' : `${n}`);

/** Name for a score relative to par, for colouring and labels. */
export function scoreName(strokes: number | null, par: number): 'eagle' | 'birdie' | 'par' | 'bogey' | 'double' | null {
  if (!strokes) return null;
  const d = strokes - par;
  return d <= -2 ? 'eagle' : d === -1 ? 'birdie' : d === 0 ? 'par' : d === 1 ? 'bogey' : 'double';
}

/** First hole where anyone still needs a score, for resuming a round. */
export function nextHole(game: GolfGame): number {
  const i = game.pars.findIndex((_, h) => game.players.some((p) => !p.scores[h]));
  return i === -1 ? game.pars.length - 1 : i;
}
