import test from 'node:test';
import { strict as assert } from 'node:assert';
import { createGame, queueDirection, step, POINTS_PER_FOOD, type SnakeState } from './snake';

test('two quick turns within one tick cannot reverse into the body', () => {
  let game: SnakeState = { ...createGame(), snake: [{ x: 5, y: 5 }, { x: 5, y: 6 }, { x: 5, y: 7 }], status: 'playing' };
  game = queueDirection(game, 'left');
  game = queueDirection(game, 'down'); // valid after left
  game = step(game); // moves left
  assert.deepEqual(game.snake[0], { x: 4, y: 5 });
  game = step(game); // then down
  assert.deepEqual(game.snake[0], { x: 4, y: 6 });
  assert.equal(game.status, 'playing');
});

test('reversing directly is ignored, first input starts the game', () => {
  let game: SnakeState = { ...createGame(), snake: [{ x: 5, y: 5 }, { x: 5, y: 6 }] };
  game = queueDirection(game, 'down'); // opposite of 'up'
  assert.equal(game.status, 'playing');
  assert.deepEqual(game.queue, []);
});

test('eating grows the snake and scores once; walls end the game', () => {
  let game: SnakeState = { ...createGame(), snake: [{ x: 1, y: 1 }], food: { x: 1, y: 0 }, status: 'playing' };
  game = step(game, () => 0);
  assert.equal(game.score, POINTS_PER_FOOD);
  assert.equal(game.snake.length, 2);
  assert.ok(!game.snake.some((s) => s.x === game.food.x && s.y === game.food.y));
  game = step(game);
  assert.equal(game.status, 'over');
});

test('moving into the cell the tail is leaving is allowed', () => {
  let game: SnakeState = {
    ...createGame(),
    snake: [{ x: 2, y: 2 }, { x: 3, y: 2 }, { x: 3, y: 3 }, { x: 2, y: 3 }],
    direction: 'left',
    status: 'playing',
  };
  game = queueDirection(game, 'down');
  game = step(game);
  assert.equal(game.status, 'playing');
});
