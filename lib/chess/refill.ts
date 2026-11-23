import * as zlib from 'node:zlib';
import { replaysCleanly, type Puzzle } from './puzzle';

const zstdDecompressSync = (zlib as unknown as { zstdDecompressSync?: (buf: Uint8Array) => Buffer }).zstdDecompressSync;

// Streams new puzzles from the Lichess CC0 puzzle dump (pzstd CSV) into the
// server's extra-puzzle pool, aborting the download as soon as enough puzzles
// in the requested rating bands are collected.

export const LICHESS_DUMP_URL = 'https://database.lichess.org/lichess_db_puzzle.csv.zst';

const QUICK_THEMES = new Set([
  'mateIn1', 'mateIn2', 'oneMove', 'short', 'fork', 'hangingPiece',
  'pin', 'skewer', 'backRankMate', 'discoveredAttack',
]);

const KEEP_THEMES = new Set([
  ...QUICK_THEMES,
  'mate', 'opening', 'middlegame', 'endgame', 'crushing', 'advantage', 'sacrifice', 'promotion',
  'attraction', 'deflection', 'trappedPiece', 'doubleCheck', 'smotheredMate', 'kingsideAttack',
  'queensideAttack', 'defensiveMove', 'quietMove', 'capturingDefender', 'exposedKing',
]);

const DEFAULT_MIN_RATING = 600;
const DEFAULT_MAX_RATING = 2400;
const DEFAULT_MAX_BYTES = 35 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 35_000;
const MAX_SOLUTION_PLIES = 4;

export type ParseRowOptions = {
  existingIds?: Set<string>;
  minRating?: number;
  maxRating?: number;
  maxSolutionPlies?: number;
};

/** Parse and validate one CSV row from Lichess's puzzle dump. */
export function parseLichessPuzzleRow(line: string, opts: ParseRowOptions = {}): Puzzle | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  const parts = trimmed.split(',');
  if (parts.length < 8) return null;
  const [id, fen, moveText, ratingText, deviationText, popularityText, playsText, themeText] = parts;
  if (!id || id === 'PuzzleId' || opts.existingIds?.has(id)) return null;

  const rating = Number(ratingText);
  const minRating = opts.minRating ?? DEFAULT_MIN_RATING;
  const maxRating = opts.maxRating ?? DEFAULT_MAX_RATING;
  if (!Number.isFinite(rating) || rating < minRating || rating > maxRating) return null;

  if (Number(deviationText) > 90 || Number(popularityText) < 85 || Number(playsText) < 300) return null;

  const moves = moveText.trim().split(/\s+/);
  const maxPlies = opts.maxSolutionPlies ?? MAX_SOLUTION_PLIES;
  if (moves.length < 2 || moves.length - 1 > maxPlies) return null;

  const rawThemes = themeText.trim().split(/\s+/);
  if (!rawThemes.some((t) => QUICK_THEMES.has(t))) return null;

  const puzzle: Puzzle = {
    id,
    fen: fen.trim(),
    moves,
    rating: Math.round(rating),
    themes: rawThemes.filter((t) => KEEP_THEMES.has(t)),
  };
  return replaysCleanly(puzzle) ? puzzle : null;
}

export type FetchPuzzlesOptions = {
  existingIds?: Iterable<string>;
  count: number;
  minRating?: number;
  maxRating?: number;
  maxBytes?: number;
  timeoutMs?: number;
  url?: string;
  fetcher?: typeof fetch;
};

export type FetchPuzzlesResult = {
  added: Puzzle[];
  rowsScanned: number;
  bytesRead: number;
};

/**
 * Download and filter up to `count` new puzzles from the Lichess zstd CSV dump.
 * Aborts the HTTP stream immediately once `count` puzzles are collected.
 */
export async function fetchLichessPuzzles(options: FetchPuzzlesOptions): Promise<FetchPuzzlesResult> {
  if (typeof zstdDecompressSync !== 'function') {
    throw new Error('Zstd decompression is unavailable in this Node runtime');
  }
  const targetCount = Math.max(1, Math.min(2000, Math.floor(options.count)));
  const minRating = Math.max(400, Math.min(2700, Math.floor(options.minRating ?? DEFAULT_MIN_RATING)));
  const maxRating = Math.max(minRating + 100, Math.min(2800, Math.floor(options.maxRating ?? DEFAULT_MAX_RATING)));
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const fetcher = options.fetcher ?? fetch;
  const url = options.url ?? LICHESS_DUMP_URL;

  const bandCount = Math.max(1, Math.ceil((maxRating - minRating) / 100));
  const perBand = Math.max(1, Math.ceil(targetCount / bandCount));
  const bands = new Array<number>(bandCount).fill(0);
  const seen = new Set(options.existingIds ?? []);

  const added: Puzzle[] = [];
  let rowsScanned = 0;
  let bytesRead = 0;
  let buffered = '';
  let headerSeen = false;
  let done = false;

  const takeLines = (text: string) => {
    buffered += text;
    const lines = buffered.split('\n');
    buffered = lines.pop() ?? '';
    for (const line of lines) {
      if (!headerSeen) {
        headerSeen = true;
        if (line.startsWith('PuzzleId,')) continue;
      }
      rowsScanned++;
      const puzzle = parseLichessPuzzleRow(line, { existingIds: seen, minRating, maxRating });
      if (!puzzle) continue;
      const band = Math.min(bandCount - 1, Math.max(0, Math.floor((puzzle.rating - minRating) / 100)));
      if (bands[band] >= perBand) continue;
      bands[band]++;
      seen.add(puzzle.id);
      added.push(puzzle);
      if (added.length >= targetCount) {
        done = true;
        return;
      }
    }
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error('Timed out downloading Lichess puzzles')), timeoutMs);

  let res: Response;
  try {
    res = await fetcher(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'PiDashboard/1.0 (self-hosted)' },
    });
  } catch (err) {
    clearTimeout(timer);
    throw new Error(err instanceof Error ? err.message : 'Failed to connect to Lichess puzzle dump');
  }

  if (!res.ok || !res.body) {
    clearTimeout(timer);
    throw new Error(`Lichess puzzle dump returned HTTP ${res.status}`);
  }

  const reader = res.body.getReader();
  let pending: Buffer<ArrayBufferLike> = Buffer.alloc(0);
  let need: number | null = null;
  let plainStream = false;

  try {
    while (!done) {
      const { value, done: ended } = await reader.read();
      if (ended) break;
      bytesRead += value.byteLength;
      pending = Buffer.concat([pending, Buffer.from(value)]);

      if (plainStream) {
        if (bytesRead > maxBytes) break;
        continue;
      }

      for (;;) {
        if (need === null) {
          if (pending.length < 8) break;
          const magic = pending.readUInt32LE(0);
          if (magic === 0xfd2fb528) {
            plainStream = true;
            break;
          }
          if ((magic & 0xfffffff0) !== 0x184d2a50) {
            throw new Error('Unexpected frame format in Lichess puzzle dump');
          }
          const size = pending.readUInt32LE(4);
          if (pending.length < 8 + size) break;
          need = size === 4 ? pending.readUInt32LE(8) : null;
          pending = pending.subarray(8 + size);
          if (need === null) continue;
        }
        if (pending.length < need) break;
        takeLines(zstdDecompressSync(pending.subarray(0, need)).toString('utf8'));
        pending = pending.subarray(need);
        need = null;
        if (done) break;
      }

      if (bytesRead > maxBytes) break;
    }

    if (plainStream && pending.length > 0 && !done) {
      takeLines(zstdDecompressSync(pending).toString('utf8'));
    }
    if (!done && buffered.trim()) {
      takeLines('\n');
    }
  } finally {
    clearTimeout(timer);
    controller.abort();
    await reader.cancel().catch(() => {});
  }

  return { added, rowsScanned, bytesRead };
}
