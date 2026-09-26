import test from 'node:test';
import { strict as assert } from 'node:assert';
import { canMove, createGame, move, slideLine, type G2048State } from './g2048';

test('slideLine merges each pair once, toward the front', () => {
  assert.deepEqual(slideLine([2, 2, 2, 2]), { line: [4, 4, 0, 0], gained: 8 });
  assert.deepEqual(slideLine([0, 2, 0, 2]), { line: [4, 0, 0, 0], gained: 4 });
  assert.deepEqual(slideLine([4, 4, 8, 0]), { line: [8, 8, 0, 0], gained: 8 });
  assert.deepEqual(slideLine([2, 4, 8, 16]), { line: [2, 4, 8, 16], gained: 0 });
});

test('moves in every direction and spawns one tile only when something moved', () => {
  const rng = () => 0; // first empty cell, always a 2
  const start: G2048State = { board: [[2, 0, 0, 2], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]], score: 0, won: false, over: false };
  const right = move(start, 'right', rng);
  assert.equal(right.board[0][3], 4);
  assert.equal(right.score, 4);
  assert.equal(right.board.flat().filter(Boolean).length, 2);
  const down = move(start, 'down', rng);
  assert.equal(down.board[3][0], 2);
  assert.equal(down.board[3][3], 2);
  // Nothing can slide left on a packed left edge → same state back.
  const packed: G2048State = { ...start, board: [[2, 4, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]] };
  assert.equal(move(packed, 'left', rng), packed);
});

test('detects a win and a dead board', () => {
  const nearWin: G2048State = { board: [[1024, 1024, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]], score: 0, won: false, over: false };
  assert.equal(move(nearWin, 'left', () => 0.5).won, true);
  assert.equal(canMove([[2, 4, 2, 4], [4, 2, 4, 2], [2, 4, 2, 4], [4, 2, 4, 2]]), false);
  assert.equal(canMove([[2, 2, 4, 8], [4, 8, 16, 32], [8, 16, 32, 64], [16, 32, 64, 128]]), true);
  assert.equal(createGame(() => 0.1).board.flat().filter(Boolean).length, 2);
});
