import test from 'node:test';
import { strict as assert } from 'node:assert';
import { followLevel, gainFor } from '../../components/notes/louder';

// How loud a recording is played back: the arithmetic, apart from the browser's sound graph.

test('a quiet recording is lifted, a loud one is left alone, and there is a limit', () => {
  assert.equal(gainFor(0), 1, 'nothing heard yet: as recorded');
  assert.equal(gainFor(0.3), 1, 'already loud: never turned down');
  assert.ok(Math.abs(gainFor(0.014) - 10) < 1e-9, 'ten times too quiet: ten times louder');
  assert.equal(gainFor(0.0001), 20, 'almost silent: no more than the limit');
});

test('the level follows speech up quickly and down slowly, and ignores the pauses', () => {
  assert.equal(followLevel(0, 0.02), 0.02, 'the first speech sets it at once');
  const up = followLevel(0.02, 0.1);
  assert.ok(up > 0.05 && up < 0.1, 'a louder moment pulls it most of the way');
  const down = followLevel(0.1, 0.02);
  assert.ok(down > 0.09, 'a quieter one barely moves it');
  assert.equal(followLevel(0.05, 0.0005), 0.05, 'a pause between sentences changes nothing');
  // Settles on a steady voice, so the gain stops moving.
  let level = 0;
  for (let i = 0; i < 400; i++) level = followLevel(level, 0.03);
  assert.ok(Math.abs(level - 0.03) < 1e-6);
});
