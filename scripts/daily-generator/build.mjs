// Turn question source files into a pack the site accepts.
//
//   node scripts/daily-generator/build.mjs daily-packs/src/2026-11-04.mjs [more.mjs …]
//
// Each source file exports an array of days (see INSTRUCTIONS.md and helpers.mjs),
// and may also export `practice` = { formulas: [...], questions: [...] } with
// practice-only questions. Writes daily-packs/<first date>_<last date>.json
// (or daily-packs/practice-<today>.json with no days) and prints its path.
// Check it afterwards with: npm run daily:validate -- <that file>

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
const practice = { formulas: [], questions: [] };
for (const source of sources) {
  // A backslash before a letter that isn't a JS escape (\a in \approx) silently
  // vanishes inside '...' or "...", so math must live in R`...` templates.
  fs.readFileSync(source, 'utf8').split('\n').forEach((line, i) => {
    if (/'[^'\n`]*\\[^'\n`]*'|"[^"\n`]*\\[^"\n`]*"/.test(line) && !/^\s*(import|\/\/)/.test(line)) {
      problems.push(`${source}:${i + 1}: backslash inside a quoted string; use R\`...\` for anything with LaTeX`);
    }
  });
  const mod = await import(pathToFileURL(path.resolve(source)).href);
  const list = Object.entries(mod).find(([name, v]) => name !== 'practice' && Array.isArray(v))?.[1];
  if (mod.practice) {
    practice.formulas.push(...(mod.practice.formulas ?? []));
    practice.questions.push(...(mod.practice.questions ?? []));
  }
  if (list) days.push(...list);
  else if (!mod.practice) problems.push(`${source}: exports no array of days (or practice set)`);
}

// …and \t in \tau or \f in \frac becomes a control character that still "renders".
const walk = (value, where) => {
  if (typeof value === 'string') {
    if (/[\t\f\b\v\r]/.test(value)) problems.push(`${where}: contains a control character (a LaTeX backslash in a plain string?)`);
  } else if (Array.isArray(value)) value.forEach((v, i) => walk(v, `${where}[${i}]`));
  else if (value && typeof value === 'object') for (const [k, v] of Object.entries(value)) walk(v, `${where}.${k}`);
};
days.forEach((d, i) => walk(d, d?.date ?? `day ${i}`));
walk(practice, 'practice');

if (!days.length && !practice.questions.length) problems.push('no days or practice questions found');
if (problems.length) {
  console.error(problems.join('\n'));
  process.exit(1);
}

days.sort((a, b) => String(a.date).localeCompare(String(b.date)));
const outDir = path.resolve('daily-packs');
fs.mkdirSync(outDir, { recursive: true });
const file = days.length
  ? path.join(outDir, `${days[0].date}_${days[days.length - 1].date}.json`)
  : path.join(outDir, `practice-${new Date().toISOString().slice(0, 10)}.json`);
fs.writeFileSync(file, JSON.stringify({ version: 1, days, ...(practice.questions.length ? { practice } : {}) }, null, 2));
console.log(path.relative(process.cwd(), file));
