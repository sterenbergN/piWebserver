import path from 'path';
import { readJson, updateJson } from '@/lib/json-store';
import data from './data/puzzles.json';
import { type Puzzle } from './puzzle';
import { aimOffset, type ChessProgress } from './rating';
import { fetchLichessPuzzles } from './refill';

// The bundled puzzles (from the Lichess puzzle database, CC0; rebuilt by
// scripts/chess-puzzles-from-dump.mjs), plus any extra puzzles fetched on the
// server (auto-refill or admin load) stored in .data/workout/chess/extra-puzzles.json.

export const PUZZLES = data as Puzzle[];

export const puzzleById = (id: unknown) => (typeof id === 'string' ? PUZZLES.find((p) => p.id === id) ?? null : null);

export const MAX_EXTRA_PUZZLES = 10_000;
const AUTO_REFILL_THRESHOLD = 15;
const AUTO_REFILL_WINDOW = 150;
const REFILL_COOLDOWN_MS = 10 * 60_000;

type ExtraPoolFile = { puzzles: Puzzle[]; updatedAt?: string };

export type PuzzlePoolInfo = {
  total: number;
  bundled: number;
  extra: number;
  minRating: number;
  maxRating: number;
  refilling: boolean;
  lastRefillAt: string | null;
  lastRefillAdded: number;
  lastError: string | null;
};

let cachedExtra: Puzzle[] | null = null;
let inFlightRefill: Promise<{ added: number; pool: PuzzlePoolInfo }> | null = null;
let lastAttemptAt = 0;
let lastRefillAt: string | null = null;
let lastRefillAdded = 0;
let lastError: string | null = null;

const extraFile = () => path.join(process.cwd(), '.data', 'workout', 'chess', 'extra-puzzles.json');

function validStoredPuzzle(raw: unknown): raw is Puzzle {
  if (!raw || typeof raw !== 'object') return false;
  const r = raw as Partial<Puzzle>;
  return (
    typeof r.id === 'string' &&
    typeof r.fen === 'string' &&
    Array.isArray(r.moves) &&
    r.moves.length >= 2 &&
    typeof r.rating === 'number' &&
    Number.isFinite(r.rating) &&
    Array.isArray(r.themes)
  );
}

async function loadExtraPuzzles(): Promise<Puzzle[]> {
  if (cachedExtra !== null) return cachedExtra;
  const stored = await readJson<ExtraPoolFile>(extraFile(), { puzzles: [] });
  const bundledIds = new Set(PUZZLES.map((p) => p.id));
  const seen = new Set<string>();
  const valid: Puzzle[] = [];
  for (const p of Array.isArray(stored.puzzles) ? stored.puzzles : []) {
    if (validStoredPuzzle(p) && !bundledIds.has(p.id) && !seen.has(p.id)) {
      seen.add(p.id);
      valid.push(p);
    }
  }
  cachedExtra = valid;
  if (stored.updatedAt && !lastRefillAt) lastRefillAt = stored.updatedAt;
  return cachedExtra;
}

/** Combined bundled + server-fetched puzzle pool. */
export async function getAllPuzzles(): Promise<Puzzle[]> {
  const extra = await loadExtraPuzzles();
  return extra.length ? [...PUZZLES, ...extra] : PUZZLES;
}

/** Look up any puzzle by id across bundled and extra pools. */
export async function findPuzzleById(id: unknown): Promise<Puzzle | null> {
  if (typeof id !== 'string') return null;
  const local = puzzleById(id);
  if (local) return local;
  const extra = await loadExtraPuzzles();
  return extra.find((p) => p.id === id) ?? null;
}

function summarizePool(all: Puzzle[], extraCount: number): PuzzlePoolInfo {
  let minRating = Infinity;
  let maxRating = -Infinity;
  for (const p of all) {
    if (p.rating < minRating) minRating = p.rating;
    if (p.rating > maxRating) maxRating = p.rating;
  }
  return {
    total: all.length,
    bundled: PUZZLES.length,
    extra: extraCount,
    minRating: Number.isFinite(minRating) ? minRating : 0,
    maxRating: Number.isFinite(maxRating) ? maxRating : 0,
    refilling: inFlightRefill !== null,
    lastRefillAt,
    lastRefillAdded,
    lastError,
  };
}

export async function getPoolInfo(): Promise<PuzzlePoolInfo> {
  const extra = await loadExtraPuzzles();
  return summarizePool(extra.length ? [...PUZZLES, ...extra] : PUZZLES, extra.length);
}

/** How the background refill decides, for the admin page to explain it. */
export const AUTO_REFILL_RULES = {
  threshold: AUTO_REFILL_THRESHOLD,
  window: AUTO_REFILL_WINDOW,
  cooldownMinutes: REFILL_COOLDOWN_MS / 60_000,
  count: 120,
} as const;

/** Unsolved, non-recent puzzles within `window` of where this person's puzzles are aimed. */
export function puzzlesLeftNear(
  puzzles: Pick<Puzzle, 'id' | 'rating'>[],
  progress: Pick<ChessProgress, 'rating' | 'solved' | 'recent' | 'aim'>,
  window = AUTO_REFILL_WINDOW,
  stopAt = Infinity,
  siteAimOffset?: number,
): number {
  const solved = new Set(progress.solved);
  const recent = new Set(progress.recent);
  const aim = progress.rating - aimOffset(progress, siteAimOffset);
  let remaining = 0;
  for (const p of puzzles) {
    if (solved.has(p.id) || recent.has(p.id)) continue;
    if (Math.abs(p.rating - aim) <= window && ++remaining >= stopAt) break;
  }
  return remaining;
}

/** True when fewer than `threshold` unsolved, non-recent puzzles exist near where this person's puzzles are aimed. */
export function needsAutoRefill(
  puzzles: Pick<Puzzle, 'id' | 'rating'>[],
  progress: Pick<ChessProgress, 'rating' | 'solved' | 'recent' | 'aim'>,
  threshold = AUTO_REFILL_THRESHOLD,
  window = AUTO_REFILL_WINDOW,
): boolean {
  return puzzlesLeftNear(puzzles, progress, window, threshold) < threshold;
}

export type RatingBucket = { from: number; bundled: number; extra: number };

/** Puzzles per rating band (`from` to `from + size - 1`), lowest first, with no gaps between the ends. */
export function ratingBuckets(bundled: Pick<Puzzle, 'rating'>[], extra: Pick<Puzzle, 'rating'>[], size = 100): RatingBucket[] {
  const counts = new Map<number, RatingBucket>();
  const add = (list: Pick<Puzzle, 'rating'>[], key: 'bundled' | 'extra') => {
    for (const p of list) {
      const from = Math.floor(p.rating / size) * size;
      const bucket = counts.get(from) ?? { from, bundled: 0, extra: 0 };
      bucket[key]++;
      counts.set(from, bucket);
    }
  };
  add(bundled, 'bundled');
  add(extra, 'extra');
  if (!counts.size) return [];
  const froms = [...counts.keys()];
  const out: RatingBucket[] = [];
  for (let from = Math.min(...froms); from <= Math.max(...froms); from += size) out.push(counts.get(from) ?? { from, bundled: 0, extra: 0 });
  return out;
}

/** How many of the puzzles each player solved (so won't be offered again) fall in each 100-point band, keyed by the band's start. */
export function solvedByBand(puzzles: Pick<Puzzle, 'id' | 'rating'>[], solved: string[], size = 100): Record<number, number> {
  const ids = new Set(solved);
  const out: Record<number, number> = {};
  for (const p of puzzles) {
    if (!ids.has(p.id)) continue;
    const from = Math.floor(p.rating / size) * size;
    out[from] = (out[from] ?? 0) + 1;
  }
  return out;
}

/** The pool plus its rating spread and when the next automatic refill could run. */
export async function getPoolDetails(rules: RefillRules = AUTO_REFILL_RULES) {
  const extra = await loadExtraPuzzles();
  const pool = summarizePool(extra.length ? [...PUZZLES, ...extra] : PUZZLES, extra.length);
  return {
    pool,
    buckets: ratingBuckets(PUZZLES, extra),
    maxExtra: MAX_EXTRA_PUZZLES,
    autoRefill: { ...rules, nextPossibleAt: lastAttemptAt ? new Date(lastAttemptAt + rules.cooldownMinutes * 60_000).toISOString() : null },
  };
}

export type RefillRules = { threshold: number; window: number; count: number; cooldownMinutes: number };

/** One top-up, for the admin's numbers and tuning suggestions (.data/workout/chess/refill-log.json, the last 100). */
export type RefillLogEntry = { at: string; trigger: 'auto' | 'admin'; requested: number; added: number; forRating?: number; error?: string };
const refillLogFile = () => path.join(process.cwd(), '.data', 'workout', 'chess', 'refill-log.json');

export async function readRefillLog(): Promise<RefillLogEntry[]> {
  const stored = await readJson<{ entries?: RefillLogEntry[] }>(refillLogFile(), { entries: [] }).catch(() => ({ entries: [] }));
  return Array.isArray(stored.entries) ? stored.entries : [];
}

async function logRefill(entry: RefillLogEntry) {
  await updateJson<{ entries: RefillLogEntry[] }, void>(refillLogFile(), { entries: [] }, (stored) => {
    stored.entries = [...(Array.isArray(stored.entries) ? stored.entries : []), entry].slice(-100);
  }).catch(() => {});
}

export type RefillOptions = {
  /** Who asked: the background top-up or the admin (for the log). */
  trigger?: 'auto' | 'admin';
  /** The rating of the player the top-up was for. */
  forRating?: number;
  count?: number;
  minRating?: number;
  maxRating?: number;
  fetcher?: typeof fetch;
};

/**
 * Fetch new puzzles from the Lichess dump and merge them into
 * `.data/workout/chess/extra-puzzles.json`. Serializes overlapping calls.
 */
export async function refillPuzzlePool(options: RefillOptions = {}): Promise<{ added: number; pool: PuzzlePoolInfo }> {
  if (inFlightRefill) return inFlightRefill;

  const task = (async () => {
    lastAttemptAt = Date.now();
    try {
      const existingExtra = await loadExtraPuzzles();
      if (existingExtra.length >= MAX_EXTRA_PUZZLES) {
        lastError = null;
        return { added: 0, pool: summarizePool([...PUZZLES, ...existingExtra], existingExtra.length) };
      }

      const remainingCap = MAX_EXTRA_PUZZLES - existingExtra.length;
      const requested = Math.min(remainingCap, Math.max(1, Math.floor(options.count ?? 250)));
      const existingIds = new Set<string>([
        ...PUZZLES.map((p) => p.id),
        ...existingExtra.map((p) => p.id),
      ]);

      const { added } = await fetchLichessPuzzles({
        existingIds,
        count: requested,
        minRating: options.minRating,
        maxRating: options.maxRating,
        fetcher: options.fetcher,
      });

      const now = new Date().toISOString();
      const updated = await updateJson<ExtraPoolFile, Puzzle[]>(extraFile(), { puzzles: [] }, (stored) => {
        const bundledIds = new Set(PUZZLES.map((p) => p.id));
        const byId = new Map<string, Puzzle>();
        for (const p of Array.isArray(stored.puzzles) ? stored.puzzles : []) {
          if (validStoredPuzzle(p) && !bundledIds.has(p.id)) byId.set(p.id, p);
        }
        for (const p of added) {
          if (!bundledIds.has(p.id) && !byId.has(p.id) && byId.size < MAX_EXTRA_PUZZLES) {
            byId.set(p.id, p);
          }
        }
        const merged = [...byId.values()].sort((a, b) => a.rating - b.rating || a.id.localeCompare(b.id));
        stored.puzzles = merged;
        stored.updatedAt = now;
        return merged;
      });

      cachedExtra = updated;
      lastRefillAt = now;
      lastRefillAdded = added.length;
      lastError = null;
      void logRefill({ at: now, trigger: options.trigger ?? 'admin', requested, added: added.length, ...(options.forRating ? { forRating: options.forRating } : {}) });
      return { added: added.length, pool: summarizePool([...PUZZLES, ...updated], updated.length) };
    } catch (err) {
      lastError = err instanceof Error ? err.message : 'Failed to load puzzles from Lichess';
      void logRefill({ at: new Date().toISOString(), trigger: options.trigger ?? 'admin', requested: options.count ?? 0, added: 0, error: lastError });
      throw err;
    } finally {
      inFlightRefill = null;
    }
  })();

  inFlightRefill = task;
  return task;
}

/**
 * Trigger a non-blocking background refill when the signed-in user is running
 * low on unsolved puzzles near their current rating.
 */
export function maybeAutoRefill(progress: ChessProgress, currentPool?: Puzzle[], rules: RefillRules = AUTO_REFILL_RULES, siteAimOffset?: number): boolean {
  if (inFlightRefill) return false;
  if (Date.now() - lastAttemptAt < rules.cooldownMinutes * 60_000) return false;
  if (cachedExtra && cachedExtra.length >= MAX_EXTRA_PUZZLES) return false;

  const pool = currentPool ?? (cachedExtra ? [...PUZZLES, ...cachedExtra] : PUZZLES);
  if (!needsAutoRefill(pool, progress, rules.threshold, rules.window)) return false;

  // Around where this person's puzzles are aimed, not just their rating.
  const center = progress.rating - aimOffset(progress, siteAimOffset);
  const minRating = Math.max(400, Math.floor((center - 250) / 100) * 100);
  const maxRating = Math.min(2800, Math.ceil((center + 250) / 100) * 100);
  void refillPuzzlePool({ count: rules.count, minRating, maxRating, trigger: 'auto', forRating: progress.rating }).catch((err) => {
    console.error('Background chess puzzle refill failed:', err instanceof Error ? err.message : err);
  });
  return true;
}
