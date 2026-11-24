import test from 'node:test';
import { strict as assert } from 'node:assert';
import { DEFAULT_TUNING, normalizeTuning } from './site';
import { applySuggestion, suggestTuning } from './suggest';

const NOW = new Date('2026-11-24T12:00:00Z');
const site = () => normalizeTuning({});

test('site values stay within limits', () => {
  assert.deepEqual(normalizeTuning(null), DEFAULT_TUNING);
  const t = normalizeTuning({ mathStreakUp: 9, chessAimOffset: -500, refill: { count: 5, threshold: 12.4 } });
  assert.equal(t.mathStreakUp, 5);
  assert.equal(t.chessAimOffset, -100);
  assert.equal(t.refill.count, 25);
  assert.equal(t.refill.threshold, 12);
});

test('new people start where tuned people settled', () => {
  const s = suggestTuning(site(), [{ name: 'a', mathStreakUp: 4 }, { name: 'b', mathStreakUp: 4 }, { name: 'c', mathStreakUp: 2, chessAimOffset: 110 }], [], NOW);
  const math = s.find((x) => x.id === 'math-streak')!;
  assert.equal(math.suggested, 4);
  assert.match(math.why, /2 of 3 people/);
  assert.equal(s.find((x) => x.id === 'chess-aim')!.suggested, 100, 'rounded to a step of 25');
  assert.deepEqual(suggestTuning(site(), [{ name: 'a' }], [], NOW), [], 'nobody tuned: nothing to suggest');
});

test('the puzzle top-up gets bigger when it keeps running, and calmer when it keeps failing', () => {
  const auto = (daysAgo: number, error?: string) => ({ at: new Date(NOW.getTime() - daysAgo * 86_400_000).toISOString(), trigger: 'auto' as const, requested: 120, added: error ? 0 : 120, ...(error ? { error } : {}) });
  const s = suggestTuning(site(), [], [auto(1), auto(3), auto(5), auto(9), auto(20), auto(2, 'HTTP 503'), auto(4, 'HTTP 503'), auto(6, 'timeout')], NOW);
  assert.equal(s.find((x) => x.id === 'refill-count')!.suggested, 180);
  assert.equal(s.find((x) => x.id === 'refill-cooldown')!.suggested, 60);
  assert.deepEqual(suggestTuning(site(), [], [auto(1), auto(2), auto(3)], NOW), [], 'three in two weeks is fine');
});

test('accepting changes the value and logs it; dismissing hides that suggestion until it changes', () => {
  const t = site();
  const [s] = suggestTuning(t, [{ name: 'a', mathStreakUp: 4 }], [], NOW);
  applySuggestion(t, s, NOW);
  assert.equal(t.mathStreakUp, 4);
  assert.deepEqual(t.log, [{ at: NOW.toISOString(), what: s.title, from: '3', to: '4' }]);
  const d = site();
  d.dismissed['math-streak'] = '4';
  assert.deepEqual(suggestTuning(d, [{ name: 'a', mathStreakUp: 4 }], [], NOW), []);
  assert.equal(suggestTuning(d, [{ name: 'a', mathStreakUp: 5 }], [], NOW)[0].suggested, 5, 'a different value is suggested again');
});
