#!/usr/bin/env node
// After an install (deploy.sh) and in CI (release.yml): load the site's main pages and
// a few APIs on the build that just started, and fail if any answers with a server
// error. /api/health only says the server is up; this says the pages work.
// Ships inside each release, so a build checks its own pages.
//
//   node smoke-check.mjs http://127.0.0.1:3000
//
// Prints one line per address; the last line is a summary. Exit 1 if anything failed.

const base = (process.argv[2] || 'http://127.0.0.1:3000').replace(/\/+$/, '');

/** Pages anyone can open (signed-out views render too), and APIs that answer without an account. */
const SMOKE_PATHS = [
  '/', '/today', '/workout', '/workout/practice', '/workout/calculators', '/tools', '/recipes', '/journal',
  '/household', '/study', '/notes', '/reader', '/game', '/blog', '/gallery', '/party', '/login',
  '/api/health', '/api/ai', '/api/tools/convert', '/api/workout/chess?stats=1', '/api/home-icons',
];

async function check(path) {
  let last = '';
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(base + path, { redirect: 'manual', signal: AbortSignal.timeout(20_000) });
      const text = res.status === 200 && !path.startsWith('/api/') ? await res.text() : '';
      if (res.status >= 500) { last = `${res.status}`; continue; }
      // A page that answered 200 should be a page.
      if (text && !/<html[\s>]/i.test(text)) { last = '200 but not a page'; continue; }
      return { path, ok: true, status: res.status };
    } catch (error) {
      last = error instanceof Error ? error.message : String(error);
    }
    await new Promise((r) => setTimeout(r, 1500));
  }
  return { path, ok: false, status: last };
}

const results = [];
for (const path of SMOKE_PATHS) {
  const r = await check(path);
  results.push(r);
  console.log(`${r.ok ? 'ok  ' : 'FAIL'} ${path} ${r.status}`);
}
const failed = results.filter((r) => !r.ok);
console.log(failed.length ? `smoke check failed: ${failed.map((r) => `${r.path} (${r.status})`).join(', ')}` : `smoke check passed (${results.length} addresses)`);
process.exit(failed.length ? 1 : 0);
