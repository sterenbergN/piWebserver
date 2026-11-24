import test, { after, before } from 'node:test';
import { strict as assert } from 'node:assert';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { applyAutoIssue, fingerprintOf, isNoise, MAX_NEW_PER_DAY, normalizeMessage, normalizePage, type AutoIssue } from './auto';
import { buildPrompt } from './prompt';
import type { Ticket } from './tickets';

let n = 0;
const newId = () => `auto${++n}`;
const at = (iso: string) => new Date(iso);
const hydration: AutoIssue = { source: 'browser', title: 'Uncaught Error: Minified React error #418; visit https://react.dev/errors/418?args[]=HTML (/_next/static/chunks/0syo_s819fkte.js:1)', page: '/workout/practice?tab=math', build: 'build-1 abc' };

test('noise is ignored and what varies is taken out before grouping', () => {
  assert.ok(isNoise('Script error.'));
  assert.ok(isNoise('TypeError: Failed to fetch'));
  assert.ok(isNoise('Unhandled rejection: TypeError: Failed to fetch'), 'wrapped by the browser');
  assert.ok(isNoise('Uncaught TypeError: Load failed (/_next/static/chunks/a.js:1)'));
  assert.ok(isNoise('ResizeObserver loop completed with undelivered notifications.'));
  assert.ok(!isNoise('TypeError: Cannot read properties of undefined (reading \'map\')'));
  assert.equal(normalizeMessage(hydration.title), 'uncaught error: minified react error ##; visit <url> <chunk>');
  // The same error from another build's chunk groups with it.
  assert.equal(fingerprintOf(hydration), fingerprintOf({ ...hydration, title: hydration.title.replace('0syo_s819fkte', '1abc_x77zzqq') }));
  assert.notEqual(fingerprintOf(hydration), fingerprintOf({ ...hydration, source: 'server' }));
  assert.equal(normalizePage('/study/tests/sets/3c7uUJl3Ber7?x=1'), '/study/tests/sets/:id');
  assert.equal(normalizePage('/workout/practice'), '/workout/practice');
});

test('the same problem adds to one ticket; a new one is filed as a bug by the site', () => {
  const tickets: Ticket[] = [];
  assert.equal(applyAutoIssue(tickets, hydration, at('2026-11-24T10:00:00Z'), newId), 'added');
  assert.equal(applyAutoIssue(tickets, { ...hydration, page: '/workout/practice', count: 3 }, at('2026-11-24T11:00:00Z'), newId), 'counted');
  assert.equal(applyAutoIssue(tickets, { ...hydration, page: '/workout', build: 'build-2 def' }, at('2026-11-24T12:00:00Z'), newId), 'counted');
  assert.equal(tickets.length, 1);
  const t = tickets[0];
  assert.equal(t.userId, 'site');
  assert.equal(t.kind, 'bug');
  assert.equal(t.status, 'open');
  assert.match(t.message, /^Error in a browser: Uncaught Error/);
  assert.equal(t.auto!.count, 5);
  assert.deepEqual(t.auto!.pages, ['/workout/practice', '/workout']);
  assert.deepEqual(t.auto!.builds, ['build-1 abc', 'build-2 def']);
  assert.equal(t.auto!.lastSeen, '2026-11-24T12:00:00.000Z');
});

test('a done ticket reopens only when the problem shows up on a newer build', () => {
  const tickets: Ticket[] = [];
  applyAutoIssue(tickets, hydration, at('2026-11-24T10:00:00Z'), newId);
  tickets[0].status = 'done';
  tickets[0].seenAt = '2026-11-24T10:30:00Z';
  // Still the old build running: the fix isn't installed yet.
  assert.equal(applyAutoIssue(tickets, hydration, at('2026-11-24T11:00:00Z'), newId), 'counted');
  assert.equal(tickets[0].status, 'done');
  assert.equal(applyAutoIssue(tickets, { ...hydration, build: 'build-2 def' }, at('2026-11-25T09:00:00Z'), newId), 'reopened');
  assert.equal(tickets[0].status, 'open');
  assert.equal(tickets[0].seenAt, undefined);
  assert.equal(tickets[0].auto!.reopened, 1);
  // Won't fix stays won't fix, but keeps counting.
  tickets[0].status = 'wontfix';
  assert.equal(applyAutoIssue(tickets, { ...hydration, build: 'build-3 ghi' }, at('2026-11-26T09:00:00Z'), newId), 'counted');
  assert.equal(tickets[0].status, 'wontfix');
});

test('a flood of different errors stops at the daily cap', () => {
  const tickets: Ticket[] = [];
  for (let i = 0; i < MAX_NEW_PER_DAY + 5; i++) applyAutoIssue(tickets, { source: 'server', title: `Different problem ${'abcdefghijklmnopqrstuvwxyz'[i % 26]}${'zyxwvutsrqponmlkjihgfedcba'[Math.floor(i / 26)]}` }, at('2026-11-24T10:00:00Z'), newId);
  assert.equal(tickets.length, MAX_NEW_PER_DAY);
  assert.equal(applyAutoIssue(tickets, { source: 'server', title: 'one more' }, at('2026-11-25T10:00:00Z'), newId), 'added');
});

test('Copy for Claude says it was filed by the site and quotes the samples', () => {
  const tickets: Ticket[] = [];
  applyAutoIssue(tickets, { ...hydration, detail: 'at Page (chunk.js:1:2)' }, at('2026-11-24T10:00:00Z'), newId);
  const prompt = buildPrompt(tickets, at('2026-11-24T12:00:00Z'));
  assert.match(prompt, /Filed automatically by the site \(an error in someone’s browser\): seen 1 time/);
  assert.match(prompt, /> Uncaught Error: Minified React error #418/);
  assert.match(prompt, /have no person behind them/);
});

// ── The queue that writes them ────────────────────────────────────────────────

const original = process.cwd();
let dir = '';
before(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'auto-tickets-'));
  process.chdir(dir);
});
after(async () => {
  process.chdir(original);
  await fs.rm(dir, { recursive: true, force: true });
});

test('a burst of the same error is written once, with its count', async () => {
  const { recordAutoIssue, flushAutoIssues } = await import('./auto-store');
  for (let i = 0; i < 40; i++) recordAutoIssue({ source: 'server', title: 'Workout save failed: TypeError: x is undefined', build: 'b1' });
  recordAutoIssue({ source: 'browser', title: 'Script error.' });
  await flushAutoIssues();
  const stored = JSON.parse(await fs.readFile(path.join(dir, '.data', 'tickets', 'tickets.json'), 'utf8'));
  assert.equal(stored.tickets.length, 1);
  assert.equal(stored.tickets[0].auto.count, 40);
});

test('a rolled-back install noted by deploy.sh becomes a ticket, once', async () => {
  const { fileDeployEvents } = await import('./deploy-events');
  const { flushAutoIssues } = await import('./auto-store');
  const data = path.join(dir, '.data');
  await fs.mkdir(data, { recursive: true });
  await fs.writeFile(path.join(data, 'deploy-events.jsonl'), `${JSON.stringify({ at: '2026-11-24T20:00:00Z', kind: 'rolled-back', tag: 'build-20261124-abc1234', previous: 'build-20261123-def5678', message: 'smoke check failed: /workout (500)' })}\nnot json\n`);
  assert.equal(await fileDeployEvents(data), 1);
  assert.equal(await fileDeployEvents(data), 0);
  await flushAutoIssues();
  const stored = JSON.parse(await fs.readFile(path.join(data, 'tickets', 'tickets.json'), 'utf8'));
  const t = stored.tickets.find((x: { auto?: { source: string } }) => x.auto?.source === 'deploy');
  assert.match(t.message, /^Install rolled back: Installing build-20261124-abc1234 was rolled back: smoke check failed: \/workout \(500\)/);
  assert.equal(t.severity, 'annoying');
});
