import test from 'node:test';
import assert from 'node:assert/strict';
import { angleBetween, bearing, distance, project } from './geo';
import { angleSpread, defaultDistance, distanceSpread, fadeSide, searchArea, whereInArea } from './lost-disc';
import type { ThrowRecord } from './stats';

const from = { lat: 44.98, lon: -93.27 };
const at = new Date().toISOString();
const throwOf = (discId: string, metres: number, angle: number | null = null): ThrowRecord => ({
  roundId: 'r', hole: 0, kind: 'drive', discId, distance: metres, offline: null, angle,
  from: { ...from, acc: 5, at }, to: { ...from, acc: 5, at },
});
const speeds: Record<string, number> = { d: 12, f: 7, p: 2 };
const speedOf = (id: string) => speeds[id];

test('distance: a guess from speed until there are three throws, then your own median', () => {
  assert.equal(distanceSpread({ id: 'd', speed: 12 }, [], speedOf).source, 'guess');
  assert.equal(distanceSpread({ id: 'd', speed: 12 }, [], speedOf).mean, defaultDistance(12));
  const mine = [throwOf('d', 90), throwOf('d', 100), throwOf('d', 110), throwOf('d', 300)];
  const s = distanceSpread({ id: 'd', speed: 12 }, mine, speedOf);
  assert.equal(s.source, 'disc');
  assert.equal(s.mean, 105);
  assert.ok(s.sd < 25, 'one huge throw does not blow up the spread');
});

test('distance: borrows from discs of similar speed, not putters', () => {
  const s = distanceSpread({ id: 'new', speed: 11 }, [throwOf('d', 100), throwOf('d', 100), throwOf('d', 100), throwOf('p', 40)], speedOf);
  assert.equal(s.source, 'similar');
  assert.equal(s.mean, 100);
});

test('direction: a stable disc leans toward its fade side until you have throws', () => {
  assert.equal(fadeSide('RHBH'), -1);
  assert.equal(fadeSide('RHFH'), 1);
  assert.ok(angleSpread({ id: 'd', turn: -1, fade: 3 }, 'RHBH', []).mean < 0, 'right-hand backhand finishes left');
  assert.ok(angleSpread({ id: 'd', turn: -1, fade: 3 }, 'RHFH', []).mean > 0);
  const mine = [throwOf('d', 90, 6), throwOf('d', 90, 8), throwOf('d', 90, 10)];
  assert.equal(angleSpread({ id: 'd', turn: 0, fade: 3 }, 'RHBH', mine).mean, 8, 'your misses win over the flight numbers');
});

test('searchArea: centred down the line at your distance, and the 90% area holds the 70% one', () => {
  const area = searchArea({
    from, heading: 90, headingError: 15, gpsError: 5, feel: 'normal',
    distance: { mean: 100, sd: 10, samples: 5, source: 'disc' },
    angle: { mean: -5, sd: 6, samples: 5, source: 'disc' },
  });
  assert.ok(Math.abs(distance(from, area.center) - 100) < 0.5);
  assert.ok(Math.abs(angleBetween(90, bearing(from, area.center)) + 5) < 0.1);
  const reach = (pts: typeof area.areas[70]) => Math.max(...pts.map((p) => distance(from, p)));
  assert.ok(reach(area.areas[90]) > reach(area.areas[70]));
  assert.deepEqual(area.areas[70][0], area.areas[70].at(-1), 'outline is closed');
});

test('searchArea: a throw that felt big moves the area out', () => {
  const base = { from, heading: 0, headingError: 15, gpsError: 5, distance: { mean: 100, sd: 10, samples: 5, source: 'disc' as const }, angle: { mean: 0, sd: 6, samples: 5, source: 'disc' as const } };
  assert.ok(distance(from, searchArea({ ...base, feel: 'big' }).center) > distance(from, searchArea({ ...base, feel: 'short' }).center) + 20);
});

test('whereInArea: the middle is likely, a bit off is possible, the tee is outside', () => {
  const area = searchArea({
    from, heading: 0, headingError: 5, gpsError: 3, feel: 'normal',
    distance: { mean: 100, sd: 10, samples: 5, source: 'disc' },
    angle: { mean: 0, sd: 5, samples: 5, source: 'disc' },
  });
  assert.equal(whereInArea(area, area.center), 'likely');
  assert.equal(whereInArea(area, project(from, 118, 0)), 'possible');
  assert.equal(whereInArea(area, from), 'outside');
});
