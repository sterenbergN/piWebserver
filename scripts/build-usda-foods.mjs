// Rebuild lib/food/data/usda-foods.json.gz: the generic foods the food tracker
// can always search, with no API and no network. They come from USDA FoodData
// Central (public domain, CC0): the SR Legacy set (about 7,800 everyday foods,
// final release) plus the much smaller, newer Foundation Foods set.
//
//   node scripts/build-usda-foods.mjs
//
// Pass other download addresses if USDA moves or renames the files:
//
//   node scripts/build-usda-foods.mjs <sr-legacy-csv-zip-url> [<foundation-csv-zip-url>]
//
// The zips are downloaded into a fresh folder under the system temp folder (never
// the repo) and deleted afterwards. The current file is left alone if anything
// looks wrong.
import AdmZip from 'adm-zip';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';

const BASE = 'https://fdc.nal.usda.gov/fdc-datasets/';
const SR_URL = process.argv[2] || `${BASE}FoodData_Central_sr_legacy_food_csv_2018-04.zip`;
const FOUNDATION_URL = process.argv[3] || `${BASE}FoodData_Central_foundation_food_csv_2026-10-29.zip`;
const OUT = new URL('../lib/food/data/usda-foods.json.gz', import.meta.url);
const UA = 'PiDashboard-FoodTracker/1.0 (self-hosted)';

// FoodData Central nutrient ids, best first where several can stand in.
const NUTRIENTS = {
  kcal: [1008, 2047, 2048], // Energy (kcal), then the Atwater energies Foundation foods use
  protein: [1003],
  carbs: [1005, 1050], // by difference, then by summation
  fat: [1004, 1085],
  fiber: [1079],
  sugar: [2000, 1063],
  sodium: [1093], // mg
  satFat: [1258],
};
const ORDER = ['kcal', 'protein', 'carbs', 'fat', 'fiber', 'sugar', 'sodium', 'satFat'];
const WANTED = new Set(Object.values(NUTRIENTS).flat());

/**
 * Parse FoodData Central CSV into rows. Every field is quoted, but some text
 * fields hold a stray unescaped quote (like 12" for inches) or a line break, so
 * a strict CSV parser goes off the rails. Instead: a record is lines joined until
 * it has every column, split on the "," between fields.
 */
function parseCsv(text) {
  const lines = text.split(/\r?\n/);
  const header = lines[0].slice(1, -1).split('","');
  const rows = [header];
  let buf = '';
  for (const line of lines.slice(1)) {
    buf = buf ? `${buf}\n${line}` : line;
    if (!buf) continue;
    const fields = buf.endsWith('"') ? buf.slice(1, -1).split('","') : [];
    if (fields.length < header.length) continue;
    rows.push(fields.map((f) => f.replace(/""/g, '"')));
    buf = '';
  }
  return rows;
}

/** Rows as objects keyed by the header line. */
function table(zip, name) {
  const entry = zip.getEntries().find((e) => !e.isDirectory && path.posix.basename(e.entryName) === name);
  if (!entry) return [];
  const [header, ...rows] = parseCsv(entry.getData().toString('utf-8').replace(/^﻿/, ''));
  return rows.map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ''])));
}

async function download(url, dir) {
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  const file = path.join(dir, path.basename(new URL(url).pathname));
  await fs.writeFile(file, Buffer.from(await res.arrayBuffer()));
  return file;
}

const round = (n, places = 1) => Math.round(n * 10 ** places) / 10 ** places;
/** "Cheese, cheddar" stays; "CHEESE,CHEDDAR" style is left as USDA wrote it apart from spacing. */
const tidy = (s) => s.replace(/\s+/g, ' ').replace(/\s*,\s*/g, ', ').trim();

/** One dataset's foods: { fdcId, name, category, n: { kcal… per 100 g }, portions: [[label, grams]] }. */
function readDataset(zip, keepTypes) {
  const units = new Map(table(zip, 'measure_unit.csv').map((u) => [u.id, u.name]));
  const categories = new Map(table(zip, 'food_category.csv').map((c) => [c.id, c.description]));
  const foods = new Map();
  for (const f of table(zip, 'food.csv')) {
    if (!keepTypes.includes(f.data_type)) continue;
    foods.set(f.fdc_id, { fdcId: Number(f.fdc_id), name: tidy(f.description), category: categories.get(f.food_category_id) || '', raw: {}, portions: [] });
  }
  for (const n of table(zip, 'food_nutrient.csv')) {
    const food = foods.get(n.fdc_id);
    const id = Number(n.nutrient_id);
    if (!food || !WANTED.has(id) || n.amount === '') continue;
    const amount = Number(n.amount);
    if (Number.isFinite(amount)) food.raw[id] = amount;
  }
  for (const p of table(zip, 'food_portion.csv')) {
    const food = foods.get(p.fdc_id);
    const grams = Number(p.gram_weight);
    if (!food || !(grams > 0)) continue;
    const amount = Number(p.amount) > 0 ? Number(p.amount) : 1;
    const unit = units.get(p.measure_unit_id);
    const label = tidy([
      round(amount, 2),
      unit && unit !== 'undetermined' ? unit : '',
      p.portion_description && p.portion_description !== 'Quantity not specified' ? p.portion_description : '',
      p.modifier,
    ].filter(Boolean).join(' ')).slice(0, 60);
    if (label && !food.portions.some(([l]) => l === label)) food.portions.push([label, round(grams)]);
  }
  const out = [];
  for (const food of foods.values()) {
    const n = {};
    for (const key of ORDER) {
      const id = NUTRIENTS[key].find((i) => food.raw[i] !== undefined);
      n[key] = id === undefined ? null : food.raw[id];
    }
    // A food with no calories or macros at all is no use to a calorie tracker.
    if (n.kcal === null || n.protein === null || n.carbs === null || n.fat === null) continue;
    out.push({ ...food, n });
  }
  return out;
}

const dir = path.join(os.tmpdir(), `usda-fdc-${crypto.randomBytes(4).toString('hex')}`);
await fs.mkdir(dir, { recursive: true });
try {
  console.log('Downloading SR Legacy…');
  const sr = readDataset(new AdmZip(await download(SR_URL, dir)), ['sr_legacy_food']);
  console.log(`  ${sr.length} foods`);
  let foundation = [];
  try {
    console.log('Downloading Foundation Foods…');
    foundation = readDataset(new AdmZip(await download(FOUNDATION_URL, dir)), ['foundation_food']);
    console.log(`  ${foundation.length} foods`);
  } catch (error) {
    console.warn(`  skipped: ${error.message}`);
  }
  if (sr.length < 5000) throw new Error(`Only ${sr.length} SR Legacy foods; keeping the current file`);

  // Foundation foods are newer analyses, so they win when the name is the same.
  const byName = new Map();
  for (const f of [...sr, ...foundation]) byName.set(f.name.toLowerCase(), f);
  const all = [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
  const categories = [...new Set(all.map((f) => f.category))].sort();
  const catIndex = new Map(categories.map((c, i) => [c, i]));
  const packed = all.map((f) => [
    f.fdcId,
    f.name.slice(0, 160),
    catIndex.get(f.category),
    ORDER.map((k) => (f.n[k] === null ? null : round(f.n[k], k === 'sodium' ? 0 : 1))),
    f.portions.slice(0, 8),
  ]);
  const data = {
    v: 1,
    source: 'USDA FoodData Central (SR Legacy and Foundation Foods), public domain (CC0)',
    builtAt: new Date().toISOString().slice(0, 10),
    nutrients: ORDER,
    categories,
    foods: packed,
  };
  const json = JSON.stringify(data);
  const gz = zlib.gzipSync(json, { level: 9 });
  await fs.mkdir(new URL('.', OUT), { recursive: true });
  await fs.writeFile(OUT, gz);
  console.log(`Wrote ${packed.length} foods: ${(json.length / 1e6).toFixed(2)} MB of JSON, ${(gz.length / 1e6).toFixed(2)} MB gzipped`);
} finally {
  await fs.rm(dir, { recursive: true, force: true });
}
