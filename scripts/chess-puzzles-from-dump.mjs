// Fill lib/chess/data/puzzles.json from the Lichess puzzle database dump (CC0,
// https://database.lichess.org/#puzzles) instead of the rate-limited API. The
// dump is ~270 MB of zstd CSV, but its rows are in random order, so only the
// first few megabytes are read: the download stops once enough puzzles are kept.
//
//   node scripts/chess-puzzles-from-dump.mjs [target]     (default 400)
//
// Kept: well-tested, popular puzzles rated 750–1850 whose solution is at most
// four plies after the opponent's setup move, spread evenly over the ratings.
// Puzzles already in the file stay. Each one is replayed with chess.js first.
import { Chess } from 'chess.js';
import fs from 'node:fs/promises';
import { zstdDecompressSync } from 'node:zlib';

const URL_DUMP = 'https://database.lichess.org/lichess_db_puzzle.csv.zst';
const OUT = new URL('../lib/chess/data/puzzles.json', import.meta.url);
const TARGET = Number(process.argv[2]) || 2000;
const MIN_RATING = 600;
const MAX_RATING = 2400;
const BANDS = 18; // 100-point bands, filled evenly
const MAX_SOLUTION = 4;
const QUICK = new Set(['mateIn1', 'mateIn2', 'oneMove', 'short', 'fork', 'hangingPiece', 'pin', 'skewer', 'backRankMate', 'discoveredAttack']);
const KEEP_THEMES = new Set([...QUICK, 'mate', 'opening', 'middlegame', 'endgame', 'crushing', 'advantage', 'sacrifice', 'promotion',
  'attraction', 'deflection', 'trappedPiece', 'doubleCheck', 'smotheredMate', 'kingsideAttack', 'queensideAttack', 'defensiveMove',
  'quietMove', 'capturingDefender', 'exposedKing']);

function replays(fen, moves) {
  try {
    const chess = new Chess(fen);
    for (const uci of moves) {
      if (!chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] })) return false;
    }
    return true;
  } catch {
    return false;
  }
}

const existing = JSON.parse(await fs.readFile(OUT, 'utf8'));
const have = new Set(existing.map((p) => p.id));
const perBand = Math.ceil(TARGET / BANDS);
const bands = new Array(BANDS).fill(0);
for (const p of existing) bands[Math.min(BANDS - 1, Math.max(0, Math.floor((p.rating - MIN_RATING) / 100)))]++;
const added = [];

const controller = new AbortController();
const res = await fetch(URL_DUMP, { signal: controller.signal, headers: { 'User-Agent': 'PiDashboard/1.0 (self-hosted)' } });
if (!res.ok || !res.body) throw new Error(`Download failed: ${res.status}`);

let buffered = '';
let header = null;
let rows = 0;
let done = false;

function takeLines(text) {
  buffered += text;
  const lines = buffered.split('\n');
  buffered = lines.pop() ?? '';
  for (const line of lines) {
    if (!header) { header = line.split(','); continue; }
    rows++;
    const [id, fen, moveText, rating, deviation, popularity, plays, themeText] = line.split(',');
    const r = Number(rating);
    const moves = moveText.split(' ');
    const themes = themeText.split(' ');
    if (have.has(id) || r < MIN_RATING || r >= MIN_RATING + BANDS * 100 || r > MAX_RATING) continue;
    if (Number(deviation) > 90 || Number(popularity) < 85 || Number(plays) < 300) continue;
    if (moves.length - 1 > MAX_SOLUTION || !themes.some((t) => QUICK.has(t))) continue;
    const band = Math.floor((r - MIN_RATING) / 100);
    if (bands[band] >= perBand) continue;
    if (!replays(fen, moves)) continue;
    bands[band]++;
    have.add(id);
    added.push({ id, fen, moves, rating: r, themes: themes.filter((t) => KEEP_THEMES.has(t)) });
    if (existing.length + added.length >= TARGET) { done = true; return; }
  }
}

// The dump is pzstd's format: each zstd frame follows a 12-byte skippable frame
// holding its compressed size, which Node's streaming decoder won't read past.
// So frames are cut out one at a time and decompressed whole.
const reader = res.body.getReader();
let pending = Buffer.alloc(0);
let need = null; // compressed size of the next frame, once its header is read
while (!done) {
  const { value, done: ended } = await reader.read();
  if (ended) break;
  pending = Buffer.concat([pending, Buffer.from(value)]);
  for (;;) {
    if (need === null) {
      if (pending.length < 8) break;
      const magic = pending.readUInt32LE(0);
      if ((magic & 0xfffffff0) !== 0x184d2a50) throw new Error('Unexpected data in the dump');
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
}
controller.abort();

const all = [...existing, ...added].sort((a, b) => a.rating - b.rating || a.id.localeCompare(b.id));
await fs.writeFile(OUT, `[\n${all.map((p) => JSON.stringify(p)).join(',\n')}\n]\n`);
console.log(`Read ${rows} rows, added ${added.length}, now ${all.length} puzzles. Per 100-point band: ${bands.join(' ')}`);
