// Rebuild lib/golf/disc-catalog.ts — the disc names and flight numbers the golf
// bag fills in from — from discit-api (https://github.com/cdleveille/discit-api),
// which mirrors Marshall Street's flight guide:
//
//   node scripts/update-disc-list.mjs
//
// Pass another address if the hosted copy has moved:
//
//   node scripts/update-disc-list.mjs https://example.com/disc
//
// Leaves the current file alone if the download fails or looks wrong.
import fs from 'node:fs/promises';

const SOURCE = process.argv[2] || 'https://discit-api.fly.dev/disc';
const OUT = new URL('../lib/golf/disc-catalog.ts', import.meta.url);

const res = await fetch(SOURCE, { headers: { 'User-Agent': 'NoahStufGolf/1.0', Accept: 'application/json' } });
if (!res.ok) throw new Error(`${SOURCE}: HTTP ${res.status}`);
const rows = await res.json();
if (!Array.isArray(rows)) throw new Error('Expected a list of discs');

const num = (v, min, max) => {
  const n = Number(v);
  return Number.isFinite(n) && n >= min && n <= max ? n : null;
};
const seen = new Set();
const discs = [];
for (const r of rows) {
  const name = String(r?.name || '').trim();
  const brand = String(r?.brand || '').trim();
  const flight = [num(r?.speed, 1, 15), num(r?.glide, 0, 7), num(r?.turn, -5, 2), num(r?.fade, 0, 6)];
  if (!name || !brand || flight.includes(null)) continue;
  const key = `${brand}|${name}`.toLowerCase();
  if (seen.has(key)) continue;
  seen.add(key);
  const [speed, glide, turn, fade] = flight;
  discs.push({ name: name.slice(0, 40), brand: brand.slice(0, 40), category: String(r?.category || '').slice(0, 30), speed, glide, turn, fade });
}
if (discs.length < 100) throw new Error(`Only ${discs.length} discs came back; keeping the current list`);
discs.sort((a, b) => a.brand.localeCompare(b.brand) || a.name.localeCompare(b.name));

const header = `// Discs and their flight numbers, for filling in the bag by name.
// Rebuilt by scripts/update-disc-list.mjs from discit-api (Marshall Street's flight
// guide) on ${new Date().toISOString().slice(0, 10)}; run it again to refresh. Don't edit by hand.

export type CatalogDisc = { name: string; brand: string; category: string; speed: number; glide: number; turn: number; fade: number };

export const DISC_CATALOG: CatalogDisc[] = [
`;
const body = discs.map((d) => `  ${JSON.stringify(d).replace(/"(\w+)":/g, '$1: ').replace(/,(?=\w+: )/g, ', ')},`).join('\n');
await fs.writeFile(OUT, `${header}${body}\n];\n`);
console.log(`Wrote ${discs.length} discs to lib/golf/disc-catalog.ts`);
