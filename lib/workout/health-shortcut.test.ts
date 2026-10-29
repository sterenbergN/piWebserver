import test from 'node:test';
import assert from 'node:assert/strict';
import { SYNC_EVERY_HOURS, SYNC_STAMP_FILE, shortcutPrompt } from './health-shortcut';

const url = 'https://example.test/api/workout/health/import';

test('the daily shortcut skips recent runs, remembers when it ran, and only notifies on an alert', () => {
  const prompt = shortcutPrompt('daily', { url, key: 'nsh_abc' });
  assert.ok(prompt.includes(`File Path: ${SYNC_STAMP_FILE}`));
  assert.ok(prompt.includes(`"is less than" ${SYNC_EVERY_HOURS * 60}`));
  assert.ok(prompt.indexOf('Stop This Shortcut') < prompt.indexOf('Find Health Samples'));
  assert.ok(prompt.indexOf('Save File') > prompt.indexOf('Get Contents of URL'));
  assert.ok(prompt.includes('the key "alert" from the variable Response'));
  assert.ok(!prompt.includes('the key "message"'));
  // Fixed ranges only: a run-time date as the search filter found nothing.
  assert.ok(!prompt.includes('/since'));
  assert.ok(!prompt.includes('Adjust Date'));
  assert.ok(prompt.includes('Heart Rate: last 1 day.'));
  assert.ok(prompt.includes('Steps: last 7 days'));
  assert.ok(prompt.includes('- key: nsh_abc'));
});

test('the 30-day shortcut runs by hand: no skip check, and it shows what arrived', () => {
  const prompt = shortcutPrompt('backfill', { url });
  assert.ok(!prompt.includes(SYNC_STAMP_FILE));
  assert.ok(prompt.includes('the key "message"'));
  // The day-by-day loop starts from tomorrow so its first day is the last 24 hours.
  assert.ok(prompt.includes('named "Tomorrow"'));
  assert.ok(prompt.includes('repeats 15 times'));
});
