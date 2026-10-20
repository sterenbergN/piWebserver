// Check a daily question pack with the same validator the site uses.
//
//   npm run daily:validate -- daily-packs/2026-10-21.json
//
// Prints every problem (with where it is) and exits non-zero if there are any.

import fs from 'node:fs/promises';
import { validatePack } from '../lib/daily/validate';

async function main() {
  const file = process.argv[2];
  if (!file) {
    console.error('Usage: npm run daily:validate -- <pack.json>');
    process.exit(2);
  }
  let raw: unknown;
  try {
    raw = JSON.parse(await fs.readFile(file, 'utf-8'));
  } catch (error) {
    console.error(`Couldn't read ${file}: ${(error as Error).message}`);
    process.exit(2);
  }
  const { pack, errors } = validatePack(raw);
  if (!pack) {
    console.error(`${file}: ${errors.length} problem${errors.length === 1 ? '' : 's'}`);
    for (const e of errors) console.error(`  - ${e}`);
    process.exit(1);
  }
  const questions = pack.days.reduce((n, d) => n + 1 + d.bonus.length, 0);
  const dates = pack.days.map((d) => d.date).sort();
  console.log(`${file}: OK — ${pack.days.length} days (${dates[0]} … ${dates[dates.length - 1]}), ${questions} questions`);
}

main();
