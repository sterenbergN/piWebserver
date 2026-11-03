import test from 'node:test';
import assert from 'node:assert/strict';
import { applyOps, canAccess, cleanOp, createRound, fromLegacy, hitGreen, isComplete, nextHole, normalizeRound, playerTotals, scoreName, summarize } from './round';
import type { Round } from './types';

const players = [{ id: 'a', name: 'Ann', userId: 'u1' }, { id: 'b', name: 'Bo' }];
const fresh = () => createRound({ sport: 'golf', holes: 9, players, scorerId: 'u1', courseName: 'Muni' });
const t = (s: number) => new Date(Date.UTC(2026, 10, 3, 12, 0, s)).toISOString();

test('createRound takes pars and the rating from the layout', () => {
  const layout = { id: 'l1', name: 'Blue', rating: 71.2, slope: 128, holes: [{ n: 1, par: 4, si: 2 }, { n: 2, par: 3, si: 1 }] };
  const course = { id: 'c1', sport: 'golf' as const, name: 'Hills', layouts: [layout], createdBy: null, createdAt: t(0), updatedAt: t(0) };
  const r = createRound({ sport: 'golf', course, layout, players, scorerId: 'u1' });
  assert.deepEqual(r.pars, [4, 3]);
  assert.equal(r.rating, 71.2);
  assert.equal(r.slope, 128);
  assert.deepEqual(r.si, [2, 1]);
  assert.equal(r.courseName, 'Hills');
  assert.match(r.joinCode, /^[A-Z2-9]{6}$/);
  assert.equal(createRound({ sport: 'disc', holes: 18, players, scorerId: null }).pars[0], 3, 'disc golf starts at par 3');
});

test('applyOps: the newer change wins, whichever phone it came from', () => {
  const r = fresh();
  applyOps(r, [{ type: 'score', playerId: 'a', hole: 0, score: { strokes: 5, at: t(2) }, at: t(2) }]);
  applyOps(r, [{ type: 'score', playerId: 'a', hole: 0, score: { strokes: 4, at: t(1) }, at: t(1) }]);
  assert.equal(r.scores.a[0]?.strokes, 5, 'an older edit arriving late is ignored');
  applyOps(r, [{ type: 'score', playerId: 'a', hole: 0, score: null, at: t(3) }]);
  assert.equal(r.scores.a[0], null, 'clearing a score is a change too');
  applyOps(r, [{ type: 'par', hole: 2, par: 5, at: t(4) }, { type: 'par', hole: 2, par: 3, at: t(0) }]);
  assert.equal(r.pars[2], 5);
});

test('applyOps: shots are added once and replaced by newer versions', () => {
  const r = fresh();
  const shot = { id: 's1', playerId: 'a', hole: 0, kind: 'drive' as const, from: { lat: 1, lon: 1, acc: 4, at: t(1) }, at: t(1) };
  applyOps(r, [{ type: 'shot', shot }, { type: 'shot', shot }]);
  assert.equal(r.shots.length, 1);
  applyOps(r, [{ type: 'shot', shot: { ...shot, to: { lat: 1.001, lon: 1, acc: 4, at: t(2) }, at: t(2) } }]);
  assert.ok(r.shots[0].to);
});

test('applyOps: players can be renamed and added, but accounts are never taken away', () => {
  const r = fresh();
  applyOps(r, [{ type: 'players', players: [{ id: 'a', name: 'Annie' }, { id: 'c', name: 'Cy', userId: 'u9' }], at: t(1) }]);
  assert.equal(r.players[0].name, 'Annie');
  assert.equal(r.players[0].userId, 'u1');
  assert.equal(r.players.length, 3, 'nobody is dropped');
  assert.equal(r.players[2].userId, undefined, 'a new player can\'t be linked to an account this way');
  assert.equal(r.scores.c.length, 9);
});

test('cleanOp rejects unknown players, holes out of range and junk', () => {
  const r = fresh();
  assert.equal(cleanOp({ type: 'score', playerId: 'zz', hole: 0, score: { strokes: 4 } }, r), null);
  assert.equal(cleanOp({ type: 'par', hole: 99, par: 4 }, r), null);
  assert.equal(cleanOp({ type: 'nope' }, r), null);
  const ok = cleanOp({ type: 'score', playerId: 'a', hole: 1, score: { strokes: 40, putts: 9, fairway: 'sideways' }, at: t(5) }, r);
  assert.deepEqual(ok, { type: 'score', playerId: 'a', hole: 1, score: { strokes: 20, putts: 9, at: t(5) }, at: t(5) });
});

test('totals, next hole and completeness', () => {
  const r = fresh();
  r.pars = [4, 3, 5, 4, 4, 3, 5, 4, 4];
  r.scores.a[0] = { strokes: 5, putts: 2, at: t(0) };
  r.scores.a[1] = { strokes: 3, putts: 1, at: t(0) };
  r.scores.b[0] = { strokes: 4, at: t(0) };
  const ann = playerTotals(r, 'a');
  assert.deepEqual([ann.strokes, ann.toPar, ann.played, ann.putts], [8, 1, 2, 3]);
  assert.equal(nextHole(r), 1, 'Bo still needs hole 2');
  assert.equal(isComplete(r), false);
});

test('scoreName and greens in regulation', () => {
  assert.equal(scoreName(1, 3), 'ace');
  assert.equal(scoreName(3, 5), 'eagle');
  assert.equal(scoreName(7, 4), 'worse');
  assert.equal(hitGreen({ strokes: 4, putts: 2, at: '' }, 4), true);
  assert.equal(hitGreen({ strokes: 5, putts: 2, at: '' }, 4), false);
  assert.equal(hitGreen({ strokes: 4, at: '' }, 4), null);
});

test('summary and access list everyone with an account', () => {
  const r = fresh();
  assert.deepEqual(summarize(r).userIds, ['u1']);
  assert.ok(canAccess(r, 'u1'));
  assert.ok(!canAccess(r, 'u2'));
});

test('normalizeRound drops scores for unknown players and keeps a valid copy', () => {
  const r = fresh() as Round & { scores: Record<string, unknown> };
  (r.scores as any).ghost = [{ strokes: 3 }];
  const back = normalizeRound(JSON.parse(JSON.stringify(r)))!;
  assert.equal('ghost' in back.scores, false);
  assert.equal(normalizeRound({ id: 'x', players: [] }), null, 'a round needs a player');
});

test('fromLegacy brings an old scorecard over and links the chosen name to the account', () => {
  const old = { id: 'abc', date: t(0), courseName: 'Old muni', pars: Array(9).fill(4), players: [{ name: 'Noah', scores: Array(9).fill(5) }, { name: 'Sam', scores: [4, null, 4, 4, 4, 4, 4, 4, 4] }] };
  const r = fromLegacy(old, 'u1', 'Noah')!;
  assert.equal(r.id, 'oldabc');
  assert.equal(r.players[0].userId, 'u1');
  assert.equal(r.players[1].userId, undefined);
  assert.equal(playerTotals(r, r.players[0].id).strokes, 45);
  assert.equal(r.scores[r.players[1].id][1], null);
  assert.equal(r.finishedAt, null, 'Sam never finished, so the round stays open');
});
