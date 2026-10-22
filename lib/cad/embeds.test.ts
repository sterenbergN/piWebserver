import test from 'node:test';
import assert from 'node:assert/strict';
import { cadBlock, cadHref, cadIdsIn } from './embeds';

test('cadIdsIn finds each model a post shows, once', () => {
  const md = ['Intro', '', cadBlock('bracket'), '', 'More', '', '~~~cad', '  gearbox  ', '~~~', '', cadBlock('bracket'), '', '```js', 'not-a-model', '```'].join('\n');
  assert.deepEqual(cadIdsIn(md), ['bracket', 'gearbox']);
});

test('cadIdsIn ignores other code and inline mentions', () => {
  assert.deepEqual(cadIdsIn('Use `cad` blocks like ```cad x``` inline.\n\n```cadquery\nbox()\n```'), []);
});

test('cadHref links to the card on the home page', () => {
  assert.equal(cadHref('bracket-v2'), '/#cad-bracket-v2');
});
