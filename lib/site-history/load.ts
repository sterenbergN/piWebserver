// Reads the generated history file (server only). It is made at build time by
// scripts/site-history.mjs and ships in the release's public/ folder. It is read with fs rather
// than imported, so a fresh clone (where the file doesn't exist yet) still typechecks and builds.
import { execFile } from 'node:child_process';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import type { HistoryData } from './types';

const FILE = path.join(process.cwd(), 'public', 'site-history.json');
const STALE_MS = 6 * 3_600_000;

async function readHistory(): Promise<HistoryData | null> {
  try {
    const data = JSON.parse(await readFile(FILE, 'utf8')) as HistoryData;
    return data && data.v === 1 && Array.isArray(data.commits) ? data : null;
  } catch {
    return null;
  }
}

function generate() {
  return new Promise<void>((resolve) => {
    execFile(process.execPath, [path.join(process.cwd(), 'scripts', 'site-history.mjs')], { cwd: process.cwd(), timeout: 60_000 }, () => resolve());
  });
}

/** The history, or null when it hasn't been generated (and, in development, couldn't be). */
export async function loadSiteHistory(): Promise<HistoryData | null> {
  // In development the file is made on demand, and refreshed when it gets old. A production
  // release only ever reads what the build wrote.
  if (process.env.NODE_ENV !== 'production') {
    const age = await stat(FILE).then((s) => Date.now() - s.mtimeMs).catch(() => Infinity);
    if (age > STALE_MS) await generate();
  }
  return readHistory();
}
