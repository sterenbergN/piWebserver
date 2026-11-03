import test from 'node:test';
import assert from 'node:assert/strict';
import { angleBetween, bearing, distance, formatDistance, offLine, project, unitFor } from './geo';

const tee = { lat: 39.74, lon: -104.99 };

test('distance: a degree of latitude is about 111 km, and a point is 0 from itself', () => {
  assert.equal(distance(tee, tee), 0);
  const d = distance({ lat: 0, lon: 0 }, { lat: 1, lon: 0 });
  assert.ok(Math.abs(d - 111195) < 5, `${d}`);
});

test('project then measure gives back the distance and bearing', () => {
  for (const b of [0, 45, 135, 270, 359]) {
    const p = project(tee, 250, b);
    assert.ok(Math.abs(distance(tee, p) - 250) < 0.01);
    assert.ok(Math.abs(angleBetween(bearing(tee, p), b)) < 0.01);
  }
});

test('angleBetween wraps through north and is positive to the right', () => {
  assert.equal(angleBetween(350, 10), 20);
  assert.equal(angleBetween(10, 350), -20);
  assert.equal(angleBetween(90, 270), -180);
});

test('offLine splits a shot into down the line and to the side', () => {
  const pin = project(tee, 300, 0);
  const right = project(project(tee, 200, 0), 20, 90);
  const r = offLine(tee, pin, right);
  assert.ok(Math.abs(r.along - 200) < 1.5, `${r.along}`);
  assert.ok(Math.abs(r.offline - 20) < 0.5, `${r.offline}`);
  const left = offLine(tee, pin, project(project(tee, 150, 0), 10, 270));
  assert.ok(left.offline < -9);
});

test('units: yards for golf, feet for disc golf, metres when metric', () => {
  assert.equal(unitFor('golf', 'imperial'), 'yd');
  assert.equal(unitFor('disc', 'imperial'), 'ft');
  assert.equal(unitFor('disc', 'metric'), 'm');
  assert.equal(formatDistance(100, 'yd'), '109 yd');
  assert.equal(formatDistance(100, 'ft'), '328 ft');
});
