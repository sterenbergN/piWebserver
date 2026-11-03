import test from 'node:test';
import assert from 'node:assert/strict';
import { adjustedGross, courseHandicap, differential, handicapHistory, handicapIndex, strokesOnHole } from './handicap';
import { createRound } from './round';
import type { Round } from './types';

test('handicapIndex follows the WHS best-of table', () => {
  assert.equal(handicapIndex([10, 12]), null);
  assert.equal(handicapIndex([10, 12, 14]), 8); // lowest 1, minus 2
  assert.equal(handicapIndex([10, 12, 14, 9, 11, 13]), 8.5); // lowest 2 averaged, minus 1
  const twenty = Array.from({ length: 20 }, (_, i) => i + 1); // 1..20
  assert.equal(handicapIndex(twenty), 4.5); // average of 1..8
  assert.equal(handicapIndex([...Array(5).fill(30), ...twenty]), 4.5, 'only the last 20 count');
});

test('courseHandicap scales by slope and halves for nine holes', () => {
  assert.equal(courseHandicap(10, 113, 72, 72, 18), 10);
  assert.equal(courseHandicap(10, 130, 73.1, 72, 18), 13);
  assert.equal(courseHandicap(10, 113, 36, 36, 9), 5);
});

test('strokesOnHole hands out strokes from the hardest hole, and plus handicaps give back on the easiest', () => {
  assert.equal(strokesOnHole(20, 1, 18), 2);
  assert.equal(strokesOnHole(20, 3, 18), 1);
  assert.equal(strokesOnHole(0, 1, 18), 0);
  assert.equal(strokesOnHole(-2, 18, 18), -1);
  assert.equal(strokesOnHole(-2, 17, 18), -1);
  assert.equal(strokesOnHole(-2, 16, 18), 0);
});

function golfRound(strokes: number[], opts: Partial<Round> = {}): Round {
  const r = createRound({ sport: 'golf', holes: strokes.length, players: [{ id: 'me', name: 'Me', userId: 'u1' }], scorerId: 'u1' });
  r.scores.me = strokes.map((s) => ({ strokes: s, at: r.createdAt }));
  r.finishedAt = r.createdAt;
  return Object.assign(r, opts);
}

test('adjustedGross caps each hole at net double bogey, or par + 5 with no index', () => {
  const r = golfRound([12, ...Array(17).fill(4)]);
  assert.equal(adjustedGross(r, 'me', null), 9 + 17 * 4);
  assert.equal(adjustedGross(r, 'me', 0), 6 + 17 * 4);
  assert.equal(adjustedGross(r, 'me', 18), 7 + 17 * 4, 'one stroke on every hole');
  r.scores.me[3] = null;
  assert.equal(adjustedGross(r, 'me', 0), null, 'only finished cards count');
});

test('differential uses the round rating and slope', () => {
  assert.equal(differential(90, 72, 113), 18);
  assert.equal(differential(85, 70.5, 125), 13.1);
});

test('handicapHistory skips rounds with no rating and adds two nines together', () => {
  const day = (d: number) => `2026-0${d}-01T12:00:00.000Z`;
  const rounds = [
    golfRound(Array(18).fill(5), { date: day(1), rating: 72, slope: 113 }),
    golfRound(Array(18).fill(5), { date: day(2) }), // no rating: not counted
    golfRound(Array(9).fill(5), { date: day(3), rating: 36, slope: 113 }),
    golfRound(Array(9).fill(5), { date: day(4), rating: 36, slope: 113 }),
    golfRound(Array(18).fill(5), { date: day(5), rating: 72, slope: 113 }),
  ];
  const history = handicapHistory(rounds, (r) => r.players[0].id);
  assert.deepEqual(history.map((h) => h.differential), [18, 9, 9, 18]);
  assert.equal(history.at(-1)!.index, 16, 'three 18-hole differentials of 18: lowest minus 2');
});
