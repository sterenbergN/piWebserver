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
  // No run-time dates (they find nothing as a search filter): one fixed search, uploaded in batches by position.
  assert.ok(!prompt.includes('Adjust Date'));
  assert.ok(prompt.includes('type Heart Rate, filter "Start Date is in the last 14 days"'));
  assert.ok(prompt.includes('Count Items in AllHeartRate'));
  assert.ok(prompt.includes('Repeat Index × 2500'));
  assert.ok(prompt.includes('Get Items in Range, from index From to index Last, of AllEnergy'));
  // Each batch uploads only its own type.
  const heartBatch = prompt.slice(prompt.indexOf('of AllHeartRate'), prompt.indexOf('STEP 5'));
  assert.ok(heartBatch.includes('heartRateValues') && !heartBatch.includes('activeEnergyValues'));
});
