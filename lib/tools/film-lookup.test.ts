import test from 'node:test';
import assert from 'node:assert/strict';
import { pickFilmPage } from './film-lookup';

test('prefers the exact film page over similar titles', () => {
  const hits = ['Mirror Mirror (film)', 'Mirror (1975 film)', 'Mirror, Mirror (1990 film)', 'Mirrors (2008 film)'];
  assert.equal(pickFilmPage('Mirror', hits)[0], 'Mirror (1975 film)');
});

test('tries the bare title first, then film pages in search order', () => {
  assert.deepEqual(pickFilmPage('Playtime', ['Playtime (2024 film)', 'Playtime', 'Jacques Tati']), ['Playtime', 'Playtime (2024 film)']);
  assert.deepEqual(pickFilmPage('Heat', ['Heat', 'Heat (1995 film)', 'Heat (1972 film)']), ['Heat', 'Heat (1995 film)', 'Heat (1972 film)']);
});

test('accepts a bare title and ignores unrelated pages', () => {
  assert.deepEqual(pickFilmPage('Mulholland Drive', ['Mulholland Drive (film)', 'Mulholland Drive', 'David Lynch']), ['Mulholland Drive', 'Mulholland Drive (film)']);
  assert.deepEqual(pickFilmPage('Ordet', ['Carl Theodor Dreyer']), []);
});

test('matches titles with accents and symbols', () => {
  assert.equal(pickFilmPage('8½', ['Federico Fellini', '8½'])[0], '8½');
  assert.equal(pickFilmPage('Amélie', ['Amélie'])[0], 'Amélie');
});
