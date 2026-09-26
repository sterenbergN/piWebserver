import test from 'node:test';
import assert from 'node:assert/strict';
import { isOpenAt, parseOpeningHours } from './opening-hours';

const at = (h: number, m = 0) => h * 60 + m;
const MON = 1, FRI = 5, SAT = 6, SUN = 0;

test('weekday ranges with semicolons', () => {
  const s = 'Mo-Fr 08:00-17:00; Sa 09:00-14:00';
  assert.equal(isOpenAt(s, MON, at(9)), true);
  assert.equal(isOpenAt(s, MON, at(18)), false);
  assert.equal(isOpenAt(s, SAT, at(13, 59)), true);
  assert.equal(isOpenAt(s, SUN, at(12)), false);
});

test('comma-separated rules and sessions past midnight', () => {
  const s = 'Mo-Th 07:00-22:00, Fr 07:00-02:00, Sa 08:00-02:00, Su 08:00-21:00';
  assert.equal(isOpenAt(s, FRI, at(23, 30)), true);
  assert.equal(isOpenAt(s, SAT, at(1, 30)), true, 'Friday night runs into Saturday');
  assert.equal(isOpenAt(s, SAT, at(3)), false);
  assert.equal(isOpenAt(s, MON, at(1)), false, 'Sunday closes at 21:00');
});

test('day lists, split sessions, off and 24/7', () => {
  assert.equal(isOpenAt('Fr,Sa 10:00-23:00', SAT, at(22)), true);
  const lunch = 'Mo-Sa 11:00-14:00,17:00-22:00; Su off';
  assert.equal(isOpenAt(lunch, MON, at(15)), false);
  assert.equal(isOpenAt(lunch, MON, at(18)), true);
  assert.equal(isOpenAt(lunch, SUN, at(12)), false);
  assert.equal(isOpenAt('24/7', SUN, at(3)), true);
  assert.equal(isOpenAt('10:00-20:00', SUN, at(12)), true, 'no days means every day');
});

test('later rules override earlier ones', () => {
  assert.equal(isOpenAt('Mo-Su 09:00-17:00; We off', 3, at(10)), false);
});

test('unreadable hours give null', () => {
  assert.equal(isOpenAt(undefined, MON, at(9)), null);
  assert.equal(isOpenAt('Jan-Mar Mo-Fr 09:00-17:00', MON, at(9)), null);
  assert.equal(isOpenAt('by appointment', MON, at(9)), null);
  assert.equal(parseOpeningHours('sunrise-sunset'), null);
});
