import test from 'node:test';
import assert from 'node:assert/strict';
import { formatToPar, newGame, nextHole, normalizeGame, scoreName, summarize } from './golf';

test('newGame sets holes, par 4 and players', () => {
  const g = newGame(9, ['Ann', ''], 'Muni');
  assert.equal(g.pars.length, 9);
  assert.deepEqual(g.players.map((p) => p.name), ['Ann', 'Player 2']);
  assert.equal(g.players[0].scores.length, 9);
});

test('summarize compares only holes played and projects the rest', () => {
  const pars = [4, 3, 5, 4];
  const s = summarize({ name: 'A', scores: [5, 3, null, null] }, pars);
  assert.equal(s.strokes, 8);
  assert.equal(s.toPar, 1);
  assert.equal(s.played, 2);
  assert.equal(s.projected, 18); // par 16 + (+0.5 per hole × 4)
  assert.equal(summarize({ name: 'A', scores: [4, 3, 5, 4] }, pars).projected, null, 'no projection once finished');
});

test('front / back nine subtotals', () => {
  const pars = Array(18).fill(4);
  const scores = [...Array(9).fill(5), ...Array(9).fill(4)];
  assert.equal(summarize({ name: 'A', scores }, pars, 0, 9).toPar, 9);
  assert.equal(summarize({ name: 'A', scores }, pars, 9, 18).toPar, 0);
});

test('labels and helpers', () => {
  assert.equal(formatToPar(0), 'E');
  assert.equal(formatToPar(-2), '-2');
  assert.equal(formatToPar(3), '+3');
  assert.equal(scoreName(2, 4), 'eagle');
  assert.equal(scoreName(3, 4), 'birdie');
  assert.equal(scoreName(6, 4), 'double');
  assert.equal(scoreName(null, 4), null);
});

test('normalizeGame repairs old and bad rounds', () => {
  const old = { id: '1', date: '2025-01-01', courseName: 'X', pars: Array(18).fill(4), players: [{ name: 'P1', scores: [4, 0, 'x', 99] }] };
  const g = normalizeGame(old)!;
  assert.deepEqual(g.players[0].scores.slice(0, 4), [4, null, null, null]);
  assert.equal(normalizeGame({ pars: [] }), null);
  assert.equal(normalizeGame(null), null);
});

test('nextHole resumes at the first unfinished hole', () => {
  const g = newGame(9, ['A', 'B']);
  g.players[0].scores[0] = 4; g.players[1].scores[0] = 5; g.players[0].scores[1] = 3;
  assert.equal(nextHole(g), 1);
});
