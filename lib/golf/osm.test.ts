import test from 'node:test';
import assert from 'node:assert/strict';
import { overpassQuery, parseOverpass } from './osm';

const square = (lat: number, lon: number, size: number) => [
  { lat, lon }, { lat: lat + size, lon }, { lat: lat + size, lon: lon + size }, { lat, lon: lon + size }, { lat, lon },
];

test('overpassQuery asks for course outlines and hole lines of the right sport', () => {
  const q = overpassQuery('disc', { lat: 1, lon: 2 });
  assert.match(q, /disc_golf_course/);
  assert.match(q, /"disc_golf"="hole"/);
  assert.match(overpassQuery('golf', { lat: 1, lon: 2 }), /"golf"="hole"/);
});

test('parseOverpass keeps holes inside each course, numbered and in order', () => {
  const json = {
    elements: [
      { type: 'way', id: 1, tags: { leisure: 'golf_course', name: 'Home' }, geometry: square(10, 10, 0.01) },
      { type: 'way', id: 2, tags: { leisure: 'golf_course', name: 'Next door' }, geometry: square(10.02, 10, 0.01) },
      { type: 'way', id: 3, tags: { golf: 'hole', ref: '2', par: '3' }, geometry: [{ lat: 10.001, lon: 10.001 }, { lat: 10.002, lon: 10.002 }] },
      { type: 'way', id: 4, tags: { golf: 'hole', ref: '1', par: '5', handicap: '3' }, geometry: [{ lat: 10.003, lon: 10.003 }, { lat: 10.004, lon: 10.004 }] },
      { type: 'way', id: 5, tags: { golf: 'hole' }, geometry: [{ lat: 10.005, lon: 10.005 }, { lat: 10.006, lon: 10.006 }] },
      { type: 'way', id: 6, tags: { golf: 'hole', ref: '1' }, geometry: [{ lat: 10.021, lon: 10.001 }, { lat: 10.022, lon: 10.002 }] },
    ],
  };
  const courses = parseOverpass(json as any, { lat: 10.005, lon: 10.005 }, 'golf');
  assert.deepEqual(courses.map((c) => c.name), ['Home', 'Next door']);
  const home = courses[0];
  assert.equal(home.osm, 'way/1');
  assert.deepEqual(home.holes.map((h) => [h.n, h.par]), [[1, 5], [2, 3]]);
  assert.equal(home.holes[0].si, 3);
  assert.deepEqual(home.holes[1].tee, { lat: 10.001, lon: 10.001 });
  assert.deepEqual(home.holes[1].target, { lat: 10.002, lon: 10.002 });
});

test('parseOverpass returns nothing for junk', () => {
  assert.deepEqual(parseOverpass({} as any, { lat: 0, lon: 0 }, 'disc'), []);
});
