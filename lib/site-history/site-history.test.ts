import assert from 'node:assert/strict';
import { test } from 'node:test';
import { areaForPath, areasForCommit, areasFromMessage } from './areas.mjs';
import { LOG_FORMAT, RS, US, areaBirths, cleanBody, parseLog, shapeCommit } from './build.mjs';
import { parseGithubRemote, pickCheckpoints } from './checkpoints.mjs';
import { countsAsCode, renamedTo, routesFromPaths } from './files.mjs';
import {
  areaPalette, bigDays, checkpointTitle, checkpointView, coChange, collapseQuiet, filterCommits, groupTimeline, growth, heatmap, layoutGraph,
  milestones, punchcard, siteMap, sizeOverTime, streaks, summarize, timeAxis, topSiteAreas, weekStart, weeklyByArea, workSessions,
} from './stats';
import type { HistoryCommit, HistoryData } from './types';

test('paths map to site areas', () => {
  assert.equal(areaForPath('app/workout/active/Tracker.tsx'), 'Workout');
  assert.equal(areaForPath('lib/loop-lab/block-sim.ts'), 'Loop Lab');
  assert.equal(areaForPath('components/quick-notes/Panel.tsx'), 'Quick notes');
  assert.equal(areaForPath('app/api/admin/ai/route.ts'), 'Admin');
  assert.equal(areaForPath('app/api/reader/x/route.ts'), 'Reader');
  assert.equal(areaForPath('lib/account-export.test.ts'), 'Accounts');
  assert.equal(areaForPath('components/Navbar.tsx'), 'Navigation');
  assert.equal(areaForPath('app/page.tsx'), 'Navigation');
  assert.equal(areaForPath('app/layout.tsx'), 'Infrastructure');
  assert.equal(areaForPath('.github/workflows/release.yml'), 'Infrastructure');
  assert.equal(areaForPath('scripts/daily-generator/build.mjs'), 'Daily questions');
  assert.equal(areaForPath('docs/study/PLAN.md'), 'Study');
  assert.equal(areaForPath('package.json'), 'Infrastructure');
  assert.equal(areaForPath('components/wishlist/WishlistApp.tsx'), 'Wishlist');
  assert.equal(areaForPath('app/workout/food/page.tsx'), 'Workout');
});

test('message scopes: conventional and free-form', () => {
  assert.deepEqual(areasFromMessage('feat(workout,party,lab): starter templates'), ['Workout', 'Party', 'Loop Lab']);
  assert.deepEqual(areasFromMessage('Loop Lab phase 1: control strategy lab'), ['Loop Lab']);
  assert.deepEqual(areasFromMessage('Workout: edit past workouts'), ['Workout']);
  assert.deepEqual(areasFromMessage('🔒 Fix path traversal'), []);
  assert.deepEqual(areasFromMessage('Daily questions: reopen sums'), ['Daily questions']);
});

test('a commit combines message scopes and changed paths', () => {
  const files = [
    { path: 'app/skills/page.tsx', weight: 100 },
    { path: 'components/Navbar.tsx', weight: 4 },
    { path: 'lib/notes/a.ts', weight: 60 },
  ];
  const a = areasForCommit('feat(skills): thing', files);
  assert.deepEqual(a.slice(0, 2), ['Skills', 'Notes']);
  assert.ok(!a.includes('Navigation'), 'a small nav tweak is not a nav change');
  assert.deepEqual(areasForCommit('Misc', [{ path: 'LICENSE', weight: 1 }]), ['Infrastructure']);
  assert.deepEqual(areasForCommit('x', []), ['Other']);
});

test('what counts as code', () => {
  assert.equal(countsAsCode('package-lock.json', 10), false);
  assert.equal(countsAsCode('public/uploads/gallery/albums.json', 5), false);
  assert.equal(countsAsCode('daily-packs/a.json', 5), false);
  assert.equal(countsAsCode('app/x/photo.png', 0), false);
  assert.equal(countsAsCode('lib/data.json', 5000), false);
  assert.equal(countsAsCode('lib/data.json', 20), true);
  assert.equal(countsAsCode('app/workout/page.tsx', 900), true);
});

test('rename paths and routes', () => {
  assert.equal(renamedTo('lib/{old => new}/x.ts'), 'lib/new/x.ts');
  assert.equal(renamedTo('a.ts => b.ts'), 'b.ts');
  assert.equal(renamedTo('lib/{ => sub}/x.ts'), 'lib/sub/x.ts');
  assert.deepEqual(routesFromPaths(['app/page.tsx', 'app/stats/history/page.tsx', 'app/(g)/x/page.tsx', 'app/party/[roomCode]/page.tsx', 'app/api/x/route.ts', 'app/stats/layout.tsx']),
    ['/', '/party/[roomCode]', '/stats/history', '/x']);
});

test('bodies lose emails and trailers and are capped', () => {
  const body = 'Does a thing.\n\nCo-Authored-By: Claude <noreply@anthropic.com>\nPing someone@example.com now';
  const out = cleanBody(body);
  assert.ok(!out.includes('@') && !out.includes('Co-Authored'));
  assert.ok(cleanBody('word '.repeat(400)).length <= 502);
});

test('parseLog and shapeCommit', () => {
  const log = `${RS}aaaaaaaaaaaa${US}2026-04-01T10:00:00-05:00${US}feat(notes): hi${US}Body${US}\n\n3\t1\tlib/notes/a.ts\n-\t-\tpublic/x.png\n900\t0\tpackage-lock.json\n`;
  const [c] = parseLog(log);
  assert.equal(c.files.length, 3);
  const s = shapeCommit(c);
  assert.equal(s.d, '2026-04-01T10:00');
  assert.equal(s.ad, 3);
  assert.equal(s.de, 1);
  assert.equal(s.f, 1);
  assert.deepEqual(s.a, ['Notes']);
  assert.ok(LOG_FORMAT.includes('%H'));
  assert.ok(!LOG_FORMAT.includes('%ae') && !LOG_FORMAT.includes('%an'));
});

const mk = (d: string, a: string[], ad = 10, de = 0, s = 'x'): HistoryCommit => ({ h: d.replace(/\D/g, '').slice(0, 8), d, s, a, f: 1, ad, de, tf: [] });

test('checkpoints: first, each month, area births, latest, merged per commit', () => {
  const commits = [mk('2026-04-01T10:00', ['A']), mk('2026-04-02T10:00', ['B']), mk('2026-05-01T10:00', ['A']), mk('2026-05-09T10:00', ['C'])];
  const births = areaBirths(commits);
  assert.deepEqual(births, { A: 0, B: 1, C: 3 });
  const cps = pickCheckpoints(commits, births);
  assert.deepEqual(cps.map((c) => c.index), [0, 1, 2, 3]);
  assert.match(cps[0].label, /First commit · A is born/);
  assert.match(cps[2].label, /Start of May 2026/);
  assert.equal(cps[3].kind, 'area');
});

test('github remotes', () => {
  assert.deepEqual(parseGithubRemote('https://github.com/o/r.git'), { owner: 'o', repo: 'r' });
  assert.deepEqual(parseGithubRemote('git@github.com:o/r.git'), { owner: 'o', repo: 'r' });
  assert.equal(parseGithubRemote('https://example.com/o/r'), null);
});

test('summary, heatmap, size, week math', () => {
  const commits = [mk('2026-04-01T10:00', ['A'], 100, 10), mk('2026-04-01T12:00', ['A', 'Infrastructure'], 50, 5), mk('2026-04-09T10:00', ['B'], 20, 0)];
  const s = summarize(commits, '2026-04-11');
  assert.equal(s.commits, 3);
  assert.equal(s.activeDays, 2);
  assert.equal(s.daysSinceFirst, 10);
  assert.equal(s.net, 155);
  assert.equal(s.areas, 2);
  assert.equal(s.busiestWeek?.commits, 2);
  assert.equal(weekStart('2026-04-01'), '2026-03-30'); // a Wednesday
  const h = heatmap(commits);
  assert.equal(h.weeks.length, 2);
  assert.equal(h.max, 2);
  assert.equal(h.weeks[0][2]?.count, 2);
  assert.equal(h.weeks[0][0], null);
  assert.deepEqual(sizeOverTime(commits), [{ day: '2026-04-01', loc: 135 }, { day: '2026-04-09', loc: 155 }]);
});

test('co-change ignores support areas and sorts by weight', () => {
  const commits = [mk('2026-04-01T10:00', ['A', 'B', 'Infrastructure']), mk('2026-04-02T10:00', ['B', 'A']), mk('2026-04-03T10:00', ['A', 'C'])];
  const pairs = coChange(commits);
  assert.deepEqual(pairs[0], { a: 'A', b: 'B', n: 2 });
  assert.equal(pairs.length, 2);
});

test('graph layout is deterministic and inside the box', () => {
  const nodes = [{ name: 'A', count: 5 }, { name: 'B', count: 3 }, { name: 'C', count: 1 }];
  const edges = [{ a: 'A', b: 'B', n: 4 }, { a: 'B', b: 'C', n: 1 }];
  const one = layoutGraph(nodes, edges, 360, 340);
  assert.deepEqual(one, layoutGraph(nodes, edges, 360, 340));
  for (const n of one) assert.ok(n.x >= 0 && n.x <= 360 && n.y >= 0 && n.y <= 340);
});

test('timeline groups and filters', () => {
  const commits = [mk('2026-10-30T10:00', ['A'], 1, 0, 'old'), mk('2026-11-02T10:00', ['B'], 1, 0, 'newer thing'), mk('2026-11-12T10:00', ['A'], 1, 0, 'newest')];
  const g = groupTimeline(commits);
  assert.deepEqual(g.map((m) => m.key), ['2026-11', '2026-10']);
  assert.equal(g[0].weeks[0].commits[0].s, 'newest');
  assert.equal(filterCommits(commits, 'A', '').length, 2);
  assert.equal(filterCommits(commits, null, 'NEWER').length, 1);
});

test('checkpoint view lists new and removed pages', () => {
  const commits = [mk('2026-04-01T10:00', ['A'], 10), mk('2026-05-01T10:00', ['A'], 5, 2)];
  const data: HistoryData = {
    v: 1, generated: '2026-05-02T00:00:00Z', repo: null, shallow: false, routes: ['/', '/a', '/b'], commits,
    checkpoints: [{ c: 0, label: 'First', kind: 'start', r: [0, 1] }, { c: 1, label: 'Next', kind: 'month', r: [0, 2] }],
  };
  const v = checkpointView(data, 1)!;
  assert.deepEqual(v.added, ['/b']);
  assert.deepEqual(v.removed, ['/a']);
  assert.equal(v.loc, 13);
});

test('growth carries page counts from the latest checkpoint and merges each day', () => {
  const commits = [mk('2026-04-01T10:00', ['A'], 10), mk('2026-04-01T11:00', ['B'], 5), mk('2026-04-03T10:00', ['A'], 5, 2)];
  const data: HistoryData = {
    v: 1, generated: '2026-04-04T00:00:00Z', repo: null, shallow: false, routes: ['/', '/a', '/b'], commits,
    checkpoints: [{ c: 0, label: 'First', kind: 'start', r: [0] }, { c: 1, label: 'B is born', kind: 'area', r: [0, 1] }, { c: 2, label: 'Latest', kind: 'now', r: [0, 1, 2] }],
  };
  assert.deepEqual(growth(data), [
    { day: '2026-04-01', loc: 15, pages: 2, total: 2, commits: 2 },
    { day: '2026-04-03', loc: 18, pages: 3, total: 3, commits: 1 },
  ]);
});

test('milestones, top areas and the palette', () => {
  const commits = [mk('2026-04-01T10:00', ['Infrastructure']), mk('2026-04-02T10:00', ['B', 'A']), mk('2026-04-03T10:00', ['A']), mk('2026-04-04T10:00', ['C'])];
  assert.deepEqual(milestones(commits).map((m) => [m.area, m.index, m.count]), [['B', 1, 1], ['A', 1, 2], ['C', 3, 1]]);
  assert.deepEqual(topSiteAreas(commits, 2), ['A', 'B']);
  // Colours go by arrival, not by rank, and only to the top n.
  assert.deepEqual(areaPalette(commits, 2), { B: 'var(--habit-1)', A: 'var(--habit-2)' });
});

test('weekly areas split shared commits and fold the rest', () => {
  const commits = [mk('2026-04-01T10:00', ['A', 'B']), mk('2026-04-02T10:00', ['C']), mk('2026-04-15T10:00', ['A'])];
  const w = weeklyByArea(commits, ['A']);
  assert.deepEqual(w.weeks, ['2026-03-30', '2026-04-06', '2026-04-13']);
  assert.deepEqual(w.totals, [2, 0, 1]);
  assert.deepEqual(w.series.map((s) => s.name), ['A', 'Everything else']);
  assert.deepEqual(w.series[0].values, [0.5, 0, 1]);
  assert.deepEqual(w.series[1].values, [1.5, 0, 0]);
});

test('quiet runs collapse, short ones stay', () => {
  assert.deepEqual(collapseQuiet([1, 0, 0, 2, 0, 0, 0, 3, 0]), { segments: [[0, 3], [7, 7]], breaks: [{ after: 3, before: 7, empty: 3 }] });
  assert.deepEqual(collapseQuiet([0, 0]), { segments: [], breaks: [] });
});

test('time axis squeezes long gaps', () => {
  const ax = timeAxis(['2026-01-01', '2026-01-11', '2026-06-01', '2026-06-11'], 14, 4);
  // 10 days + 4 (the squeezed gap) + 10 days = 24 units.
  assert.equal(ax.at('2026-01-01'), 0);
  assert.equal(ax.at('2026-06-11'), 1);
  assert.ok(Math.abs(ax.at('2026-01-11') - 10 / 24) < 1e-9);
  assert.ok(Math.abs(ax.at('2026-06-01') - 14 / 24) < 1e-9);
  assert.ok(Math.abs(ax.dayWidth - 1 / 24) < 1e-9);
  assert.equal(ax.breaks.length, 1);
  assert.equal(ax.breaks[0].days, 141);
  assert.ok(Math.abs(ax.breaks[0].pos - 12 / 24) < 1e-9);
});

test('streaks: longest and still going', () => {
  const commits = ['2026-04-01', '2026-04-02', '2026-04-03', '2026-04-07', '2026-04-09', '2026-04-10'].map((d) => mk(`${d}T10:00`, ['A']));
  const s = streaks(commits, '2026-04-11');
  assert.deepEqual(s.longest, { start: '2026-04-01', end: '2026-04-03', days: 3 });
  assert.deepEqual(s.current, { start: '2026-04-09', end: '2026-04-10', days: 2 });
  assert.equal(streaks(commits, '2026-04-20').current, null);
});

test('work sessions join commits under two hours apart', () => {
  const commits = [mk('2026-04-01T10:00', ['A']), mk('2026-04-01T11:30', ['A']), mk('2026-04-01T15:00', ['A']), mk('2026-04-02T23:30', ['A']), mk('2026-04-03T00:30', ['A'])];
  const w = workSessions(commits);
  // 10:00-11:30 (90 + 30), 15:00 alone (30), 23:30-00:30 across midnight (60 + 30).
  assert.equal(w.sessions, 3);
  assert.equal(w.minutes, 120 + 30 + 90);
  assert.deepEqual(w.longest, { day: '2026-04-01', minutes: 120, commits: 2 });
  assert.deepEqual(workSessions([]), { sessions: 0, minutes: 0, longest: null });
});

test('punch card and big days', () => {
  const commits = [mk('2026-04-01T10:15', ['A'], 5, 1), mk('2026-04-01T10:45', ['A'], 5, 1), mk('2026-04-06T23:59', ['A'])];
  const p = punchcard(commits);
  assert.equal(p.grid[2][10], 2); // Wednesday, 10 am
  assert.equal(p.grid[0][23], 1); // Monday, 11 pm
  assert.equal(p.max, 2);
  assert.deepEqual(bigDays(commits, 5, 2), [{ day: '2026-04-01', commits: 2, added: 10, removed: 2 }]);
});

test('site map groups pages by section in order of arrival', () => {
  const order = ['/', '/workout', '/notes', '/workout/active'];
  const m = siteMap(['/workout/active', '/notes', '/', '/workout'], order);
  assert.deepEqual(m.map((s) => [s.label, s.area, s.pages]), [['Home', 'Navigation', ['/']], ['/workout', 'Workout', ['/workout', '/workout/active']], ['/notes', 'Notes', ['/notes']]]);
});

test('checkpoint titles', () => {
  assert.equal(checkpointTitle('Gallery is born · Blog is born', 'area'), 'Gallery and Blog arrived');
  assert.equal(checkpointTitle('A is born · B is born · C is born', 'area'), 'A, B and C arrived');
  assert.equal(checkpointTitle('Start of May 2026', 'month'), 'May 2026');
  assert.equal(checkpointTitle('First commit · Gallery is born', 'start'), 'Gallery arrived');
  assert.equal(checkpointTitle('First commit', 'start'), 'First commit');
  assert.equal(checkpointTitle('Latest', 'now'), 'Now');
});

test('commit times are shown in the home time zone, whatever zone they were stamped in', async () => {
  const { homeTime } = await import('./build.mjs');
  assert.equal(homeTime('2026-09-26T13:50:11Z', 'America/Chicago'), '2026-09-26T08:50');
  assert.equal(homeTime('2026-11-20T18:17:28-06:00', 'America/Chicago'), '2026-11-20T18:17');
  assert.equal(homeTime('2026-07-04T23:30:00-05:00', 'America/Chicago'), '2026-07-04T23:30');
  assert.equal(homeTime('not a date', 'America/Chicago'), 'not a date');
});
