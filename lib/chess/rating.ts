// A simple Elo-style puzzle rating, and picking the next puzzle near it.
// Shared by the server (signed in, kept per account) and the browser
// (signed out, kept on the device), so both behave the same.

export const START_RATING = 1100;
export const MIN_RATING = 400;
export const MAX_RATING = 2800;
/** How many recent puzzles are kept out of the next pick (solved or not). */
export const RECENT_KEPT = 40;

export type ChessProgress = {
  rating: number;
  /** Puzzles tried. */
  games: number;
  /** Ids solved cleanly: never offered again. */
  solved: string[];
  /** Ids tried lately (newest last), kept out of the next few picks. */
  recent: string[];
};

export const emptyChessProgress = (): ChessProgress => ({ rating: START_RATING, games: 0, solved: [], recent: [] });

/** Tidy up whatever was stored (or sent) into a usable progress record. */
export function normalizeChessProgress(raw: unknown): ChessProgress {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<ChessProgress>;
  const ids = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.length <= 16) : []);
  const rating = typeof r.rating === 'number' && Number.isFinite(r.rating) ? clamp(r.rating) : START_RATING;
  const games = typeof r.games === 'number' && Number.isFinite(r.games) && r.games >= 0 ? Math.floor(r.games) : 0;
  return { rating, games, solved: [...new Set(ids(r.solved))], recent: ids(r.recent).slice(-RECENT_KEPT) };
}

const clamp = (n: number) => Math.round(Math.max(MIN_RATING, Math.min(MAX_RATING, n)));

export const expectedSolve = (rating: number, puzzleRating: number) => 1 / (1 + 10 ** ((puzzleRating - rating) / 400));

/**
 * The rating after one puzzle. Like Lichess, only a clean solve counts as a
 * win; a wrong move or peeking at the answer is a loss. Moves fast at first,
 * so it finds your level in a dozen or so puzzles, then settles.
 */
export function updatedRating(rating: number, games: number, puzzleRating: number, cleanSolve: boolean): number {
  const k = games < 10 ? 60 : games < 30 ? 40 : 24;
  return clamp(rating + k * ((cleanSolve ? 1 : 0) - expectedSolve(rating, puzzleRating)));
}

/** Record one finished puzzle. Returns a new record (the old one is left alone). */
export function recordResult(progress: ChessProgress, puzzle: { id: string; rating: number }, cleanSolve: boolean): ChessProgress {
  const rating = updatedRating(progress.rating, progress.games, puzzle.rating, cleanSolve);
  const recent = [...progress.recent.filter((id) => id !== puzzle.id), puzzle.id].slice(-RECENT_KEPT);
  const solved = cleanSolve && !progress.solved.includes(puzzle.id) ? [...progress.solved, puzzle.id] : progress.solved;
  return { rating, games: progress.games + 1, solved, recent };
}

/**
 * A puzzle near the rating: one of the closest few that haven't been solved or
 * tried lately. When everything's been solved it starts over on the ones
 * solved longest ago rather than running dry. `random` is in [0, 1).
 */
export function pickPuzzle<P extends { id: string; rating: number }>(
  puzzles: P[], progress: Pick<ChessProgress, 'rating' | 'solved' | 'recent'>, options: { exclude?: string[]; random?: () => number } = {},
): P | null {
  const random = options.random ?? Math.random;
  const solved = new Set(progress.solved);
  const recent = new Set([...progress.recent, ...(options.exclude ?? [])]);
  const pools = [
    puzzles.filter((p) => !solved.has(p.id) && !recent.has(p.id)),
    puzzles.filter((p) => !solved.has(p.id) && !(options.exclude ?? []).includes(p.id)),
    puzzles.filter((p) => !recent.has(p.id)),
    puzzles,
  ];
  const pool = pools.find((p) => p.length) ?? [];
  if (!pool.length) return null;
  // A little easier than the rating on average, since it's between sets.
  const aim = progress.rating - 50;
  const closest = [...pool].sort((a, b) => Math.abs(a.rating - aim) - Math.abs(b.rating - aim)).slice(0, 8);
  return closest[Math.floor(random() * closest.length)] ?? null;
}
