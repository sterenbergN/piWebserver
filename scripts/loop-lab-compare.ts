import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { compareProcess, type Comparison } from '../lib/loop-lab/compare';
import { defaultParams } from '../lib/loop-lab/model';
import { PROCESSES } from '../lib/loop-lab/processes';

// Writes lib/loop-lab/compare-data.json: every controller auto-tuned on every
// process's default plant and put through its tests. It takes a few minutes, so
// the site reads the result instead of working it out on each visit. Run this
// again whenever a process, a controller or the tuning changes (the tests notice
// when the file has gone stale).
//   npm run looplab:compare             all of them
//   npm run looplab:compare flow hx     just these, keeping the rest

const FILE = path.join(process.cwd(), 'lib', 'loop-lab', 'compare-data.json');

async function main() {
  const only = process.argv.slice(2);
  let data: Record<string, Comparison> = {};
  if (only.length) {
    // Keep every other process as it is. If the file can't be read, stop rather than write back
    // only the ones asked for (it once dropped all the others this way).
    try {
      data = JSON.parse(readFileSync(FILE, 'utf-8'));
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
    }
  }
  for (const proc of PROCESSES) {
    if (only.length && !only.includes(proc.id)) continue;
    const t0 = Date.now();
    data[proc.id] = await compareProcess(proc, defaultParams(proc));
    console.log(`${proc.id}: ${data[proc.id].rows.length} controllers, ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  }
  const ordered = Object.fromEntries(PROCESSES.filter((p) => data[p.id]).map((p) => [p.id, data[p.id]]));
  writeFileSync(FILE, `${JSON.stringify(ordered)}\n`);
  console.log(`Wrote ${FILE}`);
}

void main();
