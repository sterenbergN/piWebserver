import test from 'node:test';
import { strict as assert } from 'node:assert';
import * as breakout from './breakout';
import * as blocks from './blocks';
import * as flap from './flap';
import * as setpoint from './setpoint';
import * as chain from './chain';
import { GAMES, isGameId } from './registry';

const still = { move: 0 as const, target: null, launch: false };

test('breakout: the ball waits on the paddle, launches upward, and a lost ball costs a life', () => {
  let s = breakout.step(breakout.createGame(), 0.1, { ...still, target: 100 });
  assert.equal(s.stuck, true);
  assert.equal(s.ball.x, 100);
  s = breakout.step(s, 0.01, { ...still, launch: true }, () => 0.5);
  assert.equal(s.status, 'playing');
  assert.ok(s.ball.vy < 0);
  s = { ...s, ball: { x: 20, y: breakout.H + 30, vx: 0, vy: 100 } };
  s = breakout.step(s, 0.01, still);
  assert.equal(s.lives, 2);
  assert.equal(s.stuck, true);
});

test('breakout: hitting a brick breaks it, scores by row and bounces', () => {
  const r = breakout.brickRect(breakout.COLS * (breakout.ROWS - 1)); // bottom-left brick
  const s0 = { ...breakout.createGame(), stuck: false, status: 'playing' as const, ball: { x: r.x + breakout.BRICK_W / 2, y: r.y + breakout.BRICK_H + breakout.BALL_R + 2, vx: 0, vy: -300 } };
  const s = breakout.step(s0, 0.02, still);
  assert.equal(s.bricks.filter((b) => !b).length, 1);
  assert.equal(s.score, breakout.brickPoints(breakout.ROWS - 1));
  assert.ok(s.ball.vy > 0);
});

test('blocks: a full row clears and scores by level; hard drop scores per row', () => {
  const s0 = blocks.createGame(() => 0.3);
  const board = blocks.emptyBoard();
  board[blocks.ROWS - 1] = Array(blocks.COLS).fill('T');
  board[blocks.ROWS - 1][0] = null;
  assert.equal(blocks.clearRows(board).cleared, 0);
  board[blocks.ROWS - 1][0] = 'I';
  const { board: after, cleared } = blocks.clearRows(board);
  assert.equal(cleared, 1);
  assert.ok(after[blocks.ROWS - 1].every((c) => c === null));

  const dropped = blocks.hardDrop(s0);
  assert.ok(dropped.score >= 2 * 17, 'two points for each row it fell');
  assert.notEqual(dropped.piece, s0.piece);
});

test('blocks: pieces stop at walls, turn with a nudge, and hold once per piece', () => {
  let s = blocks.createGame(() => 0.1);
  for (let i = 0; i < 12; i++) s = blocks.shift(s, -1);
  assert.ok(blocks.cells(s.piece).every(([x]) => x >= 0));
  const turned = blocks.rotate(s);
  assert.ok(!blocks.collides(turned.board, turned.piece));
  const held = blocks.holdPiece(s);
  assert.equal(held.hold, s.piece.type);
  assert.equal(blocks.holdPiece(held), held, 'only once until the next piece');
});

test('flap: falls without flapping, scores a pipe once passed, crashes into one', () => {
  let s = flap.flap(flap.createGame());
  s = flap.step(s, 0.2);
  assert.equal(s.status, 'playing');
  const passed = { ...s, pipes: [{ x: flap.BIRD_X - flap.BIRD_R - flap.PIPE_W - 1, gapY: s.y, gap: 160, scored: false }] };
  assert.equal(flap.step(passed, 0.01).score, 1);
  assert.equal(flap.hitsPipe(100, { x: flap.BIRD_X - 10, gapY: 400, gap: 150, scored: false }), true);
  assert.equal(flap.hitsPipe(400, { x: flap.BIRD_X - 10, gapY: 400, gap: 150, scored: false }), false);
});

test('setpoint: points in the band, error out of it, and a trip at full error', () => {
  let s = setpoint.createGame(() => 0.5);
  assert.equal(setpoint.step(s, 0.1, false), s, 'waits for the first press');
  s = setpoint.step(s, 0.01, true);
  s = { ...s, pv: setpoint.setpointAt(s, s.t), vel: 0 };
  const inBand = setpoint.step(s, 0.15, true);
  assert.ok(inBand.score > 0);
  const far = setpoint.step({ ...s, pv: 0, vel: 0 }, 0.5, false);
  assert.ok(far.error > s.error);
  assert.equal(setpoint.step({ ...s, pv: 0, error: 0.999 }, 0.5, false).status, 'over');
});

test('chain: a tap catches dots, catches spread, and the level passes or costs a life', () => {
  let s = chain.createGame(() => 0.5);
  s = { ...s, dots: [
    { x: 100, y: 100, vx: 0, vy: 0, hue: 0, blast: null, gen: 0 },
    { x: 140, y: 100, vx: 0, vy: 0, hue: 0, blast: null, gen: 0 },
    { x: 400, y: 400, vx: 0, vy: 0, hue: 0, blast: null, gen: 0 },
  ] };
  s = chain.tap(s, 60, 100);
  for (let i = 0; i < 200; i++) s = chain.step(s, 0.02);
  assert.equal(s.popped, 2);
  assert.equal(s.status, 'cleared', `needs ${chain.needed(1)}`);
  assert.equal(s.score, chain.dotPoints(1) + chain.dotPoints(2));

  let miss = chain.tap(chain.createGame(() => 0.5), -500, -500);
  for (let i = 0; i < 200; i++) miss = chain.step(miss, 0.02);
  assert.equal(miss.status, 'failed');
  assert.equal(miss.lives, 2);
  assert.equal(chain.proceed(miss).level, 1);
});

test('the registry knows every game and rejects impossible scores', () => {
  assert.ok(isGameId('breakout') && !isGameId('pong'));
  const valid = (id: string, score: number) => GAMES.find((g) => g.id === id)!.valid(score);
  assert.ok(valid('breakout', 1680) && !valid('breakout', 1685));
  assert.ok(valid('chain', 30) && !valid('chain', 35));
  assert.ok(!valid('flap', 10_000_000));
});

test('merge snake: eating stacks numbers behind the head and matching fronts cascade', async () => {
  const ms = await import('./mergesnake');
  assert.deepEqual(ms.insertAndMerge([2, 4, 8, 16], 2), { values: [32], points: 4 + 8 + 16 + 32, chain: 4 });
  assert.deepEqual(ms.insertAndMerge([2, 4], 4), { values: [4, 2, 4], points: 0, chain: 0 }, 'the wrong number just adds length');

  let s = ms.createGame(() => 0.3);
  assert.ok(s.food.some((f) => f.value === 2), 'there is always a 2 to eat');
  // Put a matching 2 right in front of the head.
  s = { ...s, food: [{ x: s.cells[0].x, y: s.cells[0].y - 1, value: 2 }], status: 'playing' };
  s = ms.step(s, () => 0.5);
  assert.deepEqual(s.values, [4]);
  assert.equal(s.cells.length, 2, 'a merge cancels the growth');
  assert.equal(s.score, 2 + 4);
  assert.equal(s.food.length, 3);
  // A 2 now doesn't match the 4: the snake grows.
  s = { ...s, food: [{ x: s.cells[0].x, y: s.cells[0].y - 1, value: 2 }] };
  s = ms.step(s, () => 0.5);
  assert.deepEqual(s.values, [2, 4]);
  assert.equal(s.cells.length, 3);
  // Into the wall.
  for (let i = 0; i < ms.GRID; i++) s = ms.step({ ...s, food: [] }, () => 0.5);
  assert.equal(s.status, 'over');
  assert.ok(GAMES.find((g) => g.id === 'merge')!.valid(s.score));
});
