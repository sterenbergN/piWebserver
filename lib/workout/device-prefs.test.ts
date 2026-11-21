import test from 'node:test';
import assert from 'node:assert/strict';
import { alertIsTooLate, LATE_ALERT_MS } from './device-prefs';

test('alerts on time or slightly late still fire', () => {
  assert.equal(alertIsTooLate(1000, 1000), false);
  assert.equal(alertIsTooLate(1000, 1000 + LATE_ALERT_MS), false);
});

test('alerts long after they were due are skipped', () => {
  assert.equal(alertIsTooLate(1000, 1000 + LATE_ALERT_MS + 1), true);
});
