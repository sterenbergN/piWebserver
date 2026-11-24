import fs from 'fs/promises';
import path from 'path';
import { recordAutoIssue } from './auto-store';

// deploy.sh notes an install it had to roll back (the new build didn't come up, or a
// page failed its check) in .data/deploy-events.jsonl. The site that's running
// afterwards (the previous build) files each as one of its own tickets on start,
// then moves the lines to deploy-events.done.jsonl so they're filed once.

type DeployEvent = { at?: string; kind?: string; tag?: string; previous?: string; message?: string };

export async function fileDeployEvents(dataDir = path.join(process.cwd(), '.data')): Promise<number> {
  const file = path.join(dataDir, 'deploy-events.jsonl');
  const text = await fs.readFile(file, 'utf8').catch(() => '');
  if (!text.trim()) return 0;
  // Move them aside first, so a crash below can't file them twice.
  await fs.appendFile(path.join(dataDir, 'deploy-events.done.jsonl'), text);
  await fs.rm(file, { force: true });
  let filed = 0;
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    let e: DeployEvent;
    try { e = JSON.parse(line); } catch { continue; }
    recordAutoIssue({
      source: 'deploy',
      title: `Installing ${e.tag || 'a new build'} was rolled back: ${(e.message || 'it failed its checks').slice(0, 200)}`,
      detail: `${e.at ?? ''} · went back to ${e.previous || 'the previous build'}`,
      build: e.tag,
    });
    filed++;
  }
  return filed;
}
