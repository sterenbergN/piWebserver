import test from 'node:test';
import assert from 'node:assert/strict';
import { project } from './geo';
import { createRound } from './round';
import { golfStats, holeAverages, pct, summarizeThrows, throwsFor } from './stats';
import type { Course, Round, Sport } from './types';

const at = '2026-11-03T12:00:00.000Z';
function played(sport: Sport, strokes: number[], opts: Partial<Round> = {}, putts?: number[]): Round {
  const r = createRound({ sport, holes: strokes.length, players: [{ id: 'me', name: 'Me', userId: 'u1' }, { id: 'g', name: 'Guest' }], scorerId: 'u1' });
  r.pars = strokes.map(() => (sport === 'golf' ? 4 : 3));
  r.scores.me = strokes.map((s, i) => ({ strokes: s, at, ...(putts ? { putts: putts[i] } : {}) }));
  r.scores.g = strokes.map(() => ({ strokes: 9, at }));
  r.finishedAt = at;
  return Object.assign(r, opts);
}

test('golfStats keeps 9 and 18 hole averages apart and ignores other sports and unfinished rounds', () => {
  const rounds = [
    played('golf', Array(18).fill(5), { date: '2026-01-01' }),
    played('golf', Array(18).fill(4), { date: '2026-01-02' }),
    played('golf', Array(9).fill(5), { date: '2026-01-03' }),
    played('disc', Array(18).fill(3)),
    played('golf', Array(18).fill(9), { finishedAt: null }),
  ];
  const s = golfStats(rounds, 'u1', 'golf');
  assert.equal(s.rounds, 3);
  assert.equal(s.average[18].strokes, 81);
  assert.equal(s.average[18].toPar, 9);
  assert.equal(s.average[9].strokes, 45);
  assert.equal(s.best[18]?.toPar, 0);
  assert.equal(s.spread.par, 18);
  assert.equal(s.byPar[4], 0.6);
});

test('golfStats works out greens, scrambling and putts from strokes and putts', () => {
  // Par 4s: 4 with 2 putts = green hit; 4 with 1 putt = missed green, saved par; 5 with 3 putts = green hit.
  const s = golfStats([played('golf', [4, 4, 5], {}, [2, 1, 3])], 'u1', 'golf');
  assert.deepEqual(s.greens, { made: 2, tries: 3 });
  assert.deepEqual(s.scrambling, { made: 1, tries: 1 });
  assert.equal(s.puttsPerRound, 6);
  assert.equal(s.puttsPerGreen, 2.5);
});

test('golfStats compares a round with your other rounds on the same course', () => {
  const rounds = [52, 54, 56].map((total, i) => played('disc', [...Array(17).fill(3), total - 51], { courseId: 'c1', date: `2026-0${i + 1}-01` }));
  const s = golfStats(rounds, 'u1', 'disc');
  assert.deepEqual(s.trend.map((p) => p.vsCourse), [-3, 0, 3]);
});

test('putting circles add up made and tried', () => {
  const r = played('disc', [3, 3]);
  r.scores.me[0]!.c1 = [3, 4];
  r.scores.me[1]!.c1 = [1, 1];
  r.scores.me[1]!.c2 = [0, 2];
  const s = golfStats([r], 'u1', 'disc');
  assert.equal(pct(s.c1), 80);
  assert.equal(pct(s.c2), 0);
});

test('throwsFor measures marked drives against the hole line', () => {
  const tee = { lat: 40, lon: -105 };
  const target = project(tee, 300, 0);
  const course: Course = { id: 'c1', sport: 'disc', name: 'Park', createdBy: null, createdAt: at, updatedAt: at, layouts: [{ id: 'l1', name: 'Main', holes: [{ n: 1, par: 3, tee, target }] }] };
  const r = played('disc', [3], { courseId: 'c1', layoutId: 'l1' });
  const land = project(project(tee, 100, 0), 10, 90);
  r.shots = [
    { id: 's1', playerId: 'me', hole: 0, kind: 'drive', discId: 'd1', from: { ...tee, acc: 3, at }, to: { ...land, acc: 3, at }, at },
    { id: 's2', playerId: 'me', hole: 0, kind: 'drive', discId: 'd1', from: { ...tee, acc: 3, at }, lost: true, at },
    { id: 's3', playerId: 'g', hole: 0, kind: 'drive', from: { ...tee, acc: 3, at }, to: { ...land, acc: 3, at }, at },
  ];
  const throws = throwsFor([r], 'u1', [course]);
  assert.equal(throws.length, 1, 'only your finished, found throws');
  assert.ok(Math.abs(throws[0].distance - 100.5) < 1);
  assert.ok(Math.abs(throws[0].offline! - 10) < 0.5);
  assert.ok(throws[0].angle! > 5);
  assert.equal(summarizeThrows(throws)?.leftRight.right, 1);
});

test('holeAverages per hole of a layout', () => {
  const rounds = [played('golf', [4, 6], { courseId: 'c', layoutId: 'l' }), played('golf', [5, 6], { courseId: 'c', layoutId: 'l' })];
  assert.deepEqual(holeAverages(rounds, 'u1', 'c', 'l').map((h) => h?.average), [4.5, 6]);
});
