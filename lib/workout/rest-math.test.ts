import test from 'node:test';
import { strict as assert } from 'node:assert';
import { judge, makeProblem, MAX_LEVEL, nextLevel } from './rest-math';

// A seeded random, so a failure can be replayed.
function seeded(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
}

test('every level gives whole answers from 0 up that match the sum shown', () => {
  const random = seeded(7);
  for (let level = 1; level <= MAX_LEVEL; level++) {
    for (let i = 0; i < 400; i++) {
      const p = makeProblem(level, random);
      assert.ok(Number.isInteger(p.answer) && p.answer >= 0, `level ${level}: ${p.text} = ${p.answer}`);
      const expr = p.text.replace(/×/g, '*').replace(/÷/g, '/').replace(/−/g, '-').replace(/(\d+)²/, '$1*$1').replace(/(\d+)% of (\d+)/, '$1*$2/100');
      assert.equal(Function(`return ${expr}`)(), p.answer, p.text);
    }
  }
});

test('levels go up after a run of right answers and down after a miss', () => {
  assert.deepEqual(nextLevel(1, 0, true), { level: 1, streak: 1 });
  assert.deepEqual(nextLevel(1, 2, true), { level: 2, streak: 0 });
  assert.deepEqual(nextLevel(3, 2, false), { level: 2, streak: 0 });
  assert.deepEqual(nextLevel(1, 0, false), { level: 1, streak: 0 });
  assert.deepEqual(nextLevel(MAX_LEVEL, 2, true), { level: MAX_LEVEL, streak: 0 });
});

test('judge waits for enough digits', () => {
  assert.equal(judge('1', 12), 'more');
  assert.equal(judge('12', 12), 'right');
  assert.equal(judge('13', 12), 'wrong');
  assert.equal(judge('0', 0), 'right');
});
