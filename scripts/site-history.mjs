// Writes public/site-history.json: the site's git history in a compact form, for /stats/history.
//   node scripts/site-history.mjs
// Run before every build (scripts/run-next.mjs) so the Pi's release carries it: the Pi has no .git.
// The output is gitignored, so building never dirties the working tree. Needs full history
// (CI checks out with fetch-depth: 0); with a shallow clone it still writes what it can.
// Never fails the build: without git it warns and leaves any existing file alone.
import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { LOG_FORMAT, areaBirths, parseLog, shapeCommit } from '../lib/site-history/build.mjs';
import { SUPPORT_AREAS } from '../lib/site-history/areas.mjs';
import { parseGithubRemote, pickCheckpoints } from '../lib/site-history/checkpoints.mjs';
import { routesFromPaths } from '../lib/site-history/files.mjs';

const root = process.cwd();
const outFile = path.join(root, 'public', 'site-history.json');

const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] });

// Link to GitHub only when the repository is public, so a private repo never gets dead links.
async function repoInfo() {
  let remote = null;
  try { remote = parseGithubRemote(git('remote', 'get-url', 'origin')); } catch { /* no remote */ }
  if (!remote) return null;
  const url = `https://github.com/${remote.owner}/${remote.repo}`;
  if (process.env.SITE_HISTORY_REPO_PUBLIC) return process.env.SITE_HISTORY_REPO_PUBLIC === '1' ? url : null;
  try {
    const headers = { accept: 'application/vnd.github+json', 'user-agent': 'site-history' };
    if (process.env.GITHUB_TOKEN) headers.authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
    const res = await fetch(`https://api.github.com/repos/${remote.owner}/${remote.repo}`, { headers, signal: AbortSignal.timeout(6000) });
    if (!res.ok) return null;
    const info = await res.json();
    return info.private === false ? url : null;
  } catch {
    return null;
  }
}

async function main() {
  let log;
  try {
    log = git('log', '--no-merges', '-M', '--numstat', '--date=iso-strict', `--format=${LOG_FORMAT}`);
  } catch {
    console.warn('site-history: git history not available, skipping.');
    return;
  }
  const minute = (iso) => Math.floor(Date.parse(iso) / 60_000) || 0;
  const parsed = parseLog(log)
    .map((c, i) => ({ c, i }))
    // Oldest first, by the minute (dates come in different time zones); git lists newest first.
    .sort((a, b) => minute(a.c.date) - minute(b.c.date) || b.i - a.i)
    .map((x) => x.c);
  if (!parsed.length) { console.warn('site-history: no commits found, skipping.'); return; }

  const commits = parsed.map(shapeCommit);
  const births = Object.fromEntries(Object.entries(areaBirths(commits)).filter(([a]) => !SUPPORT_AREAS.includes(a)));
  const picks = pickCheckpoints(commits, births);

  // Which pages existed at each checkpoint, read from the file list at that commit.
  const routes = [];
  const routeIndex = new Map();
  const checkpoints = picks.map((p) => {
    let names = [];
    try { names = git('ls-tree', '-r', '--name-only', parsed[p.index].hash, '--', 'app/').split('\n').filter(Boolean); } catch { /* tree unreadable */ }
    const r = routesFromPaths(names).map((route) => {
      if (!routeIndex.has(route)) { routeIndex.set(route, routes.length); routes.push(route); }
      return routeIndex.get(route);
    });
    return { c: p.index, label: p.label, kind: p.kind, r };
  });

  let shallow = false;
  try { shallow = git('rev-parse', '--is-shallow-repository').trim() === 'true'; } catch { /* old git */ }

  const data = { v: 1, generated: new Date().toISOString(), repo: await repoInfo(), shallow, routes, commits, checkpoints };
  await mkdir(path.dirname(outFile), { recursive: true });
  await writeFile(outFile, JSON.stringify(data));
  console.log(`site-history: ${commits.length} commits, ${checkpoints.length} checkpoints${shallow ? ' (shallow clone: history is partial)' : ''}${data.repo ? '' : ', no GitHub links'}`);
}

main().catch((err) => { console.warn('site-history: failed,', err?.message ?? err); });
