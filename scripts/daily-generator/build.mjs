// Turn question source files into a pack the site accepts.
//
//   node scripts/daily-generator/build.mjs daily-packs/src/2026-11-04.mjs [more.mjs …]
//
// Each source file exports an array of days (see INSTRUCTIONS.md and helpers.mjs).
// Writes daily-packs/<first date>_<last date>.json and prints its path. Check it
// afterwards with: npm run daily:validate -- <that file>

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const sources = process.argv.slice(2);
if (!sources.length) {
  console.error('Usage: node scripts/daily-generator/build.mjs <source.mjs> [more.mjs …]');
  process.exit(2);
}

const problems = [];
const days = [];
for (const source of sources) {
  // A backslash before a letter that isn't a JS escape (\a in \approx) silently
  // vanishes inside '...' or "...", so math must live in R`...` templates.
  fs.readFileSync(source, 'utf8').split('\n').forEach((line, i) => {
    if (/'[^'\n`]*\\[^'\n`]*'|"[^"\n`]*\\[^"\n`]*"/.test(line) && !/^\s*(import|\/\/)/.test(line)) {
      problems.push(`${source}:${i + 1}: backslash inside a quoted string; use R\`...\` for anything with LaTeX`);
    }
  });
  const mod = await import(pathToFileURL(path.resolve(source)).href);
  const list = Object.values(mod).find(Array.isArray);
  if (!list) problems.push(`${source}: exports no array of days`);
  else days.push(...list);
}

// …and \t in \tau or \f in \frac becomes a control character that still "renders".
const walk = (value, where) => {
  if (typeof value === 'string') {
    if (/[\t\f\b\v\r]/.test(value)) problems.push(`${where}: contains a control character (a LaTeX backslash in a plain string?)`);
  } else if (Array.isArray(value)) value.forEach((v, i) => walk(v, `${where}[${i}]`));
  else if (value && typeof value === 'object') for (const [k, v] of Object.entries(value)) walk(v, `${where}.${k}`);
};
days.forEach((d, i) => walk(d, d?.date ?? `day ${i}`));

if (!days.length) problems.push('no days found');
if (problems.length) {
  console.error(problems.join('\n'));
  process.exit(1);
}

days.sort((a, b) => String(a.date).localeCompare(String(b.date)));
const outDir = path.resolve('daily-packs');
fs.mkdirSync(outDir, { recursive: true });
const file = path.join(outDir, `${days[0].date}_${days[days.length - 1].date}.json`);
fs.writeFileSync(file, JSON.stringify({ version: 1, days }, null, 2));
console.log(path.relative(process.cwd(), file));
