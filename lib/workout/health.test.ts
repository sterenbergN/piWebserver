import test from 'node:test';
import assert from 'node:assert/strict';
import { alignSets, applyHealthImport, parseSyncBody, dayKeyAt, describeSync, detailSinceMinutes, matchChecks, syncAlert, emptyUserHealth, parseHealthDate, parseList, parseNumber, refreshWorkoutHealth, sleepStage, workoutHealth, workoutWindow } from './health';

const NOW = Date.parse('2026-10-20T20:00:00-05:00');

test('lists come as arrays or newline text, numbers tolerate units and separators', () => {
  assert.deepEqual(parseList('1\n2\r\n\n3'), ['1', '2', '3']);
  assert.deepEqual(parseList([1, 2]), ['1', '2']);
  assert.deepEqual(parseList(undefined), []);
  assert.equal(parseNumber('10,234'), 10234);
  assert.equal(parseNumber('72 count/min'), 72);
  assert.equal(parseNumber('0.18'), 0.18);
  assert.ok(Number.isNaN(parseNumber('n/a')));
});

test('dates keep the phone time zone when ISO, and Shortcuts default text still parses', () => {
  const iso = parseHealthDate('2026-10-19T23:30:00-05:00')!;
  assert.equal(iso.offsetMin, -300);
  assert.equal(dayKeyAt(iso.ms, iso.offsetMin), '2026-10-19'); // 04:30 UTC on the 20th
  const plain = parseHealthDate('Oct 19, 2026 at 11:30 PM')!;
  assert.equal(plain.offsetMin, null);
  assert.equal(parseHealthDate('soon'), null);
});

test('steps, weight and body fat land on their days; re-sending replaces instead of adding', () => {
  const body = {
    stepsValues: '8123\n10,422',
    stepsDates: '2026-10-18T00:00:00-05:00\n2026-10-19T00:00:00-05:00',
    weightValues: '182.4\n181.9',
    weightDates: '2026-10-19T06:40:00-05:00\n2026-10-19T07:10:00-05:00',
    bodyFat: { values: ['0.186'], dates: ['2026-10-19T07:10:00-05:00'] },
  };
  const first = applyHealthImport(emptyUserHealth(), body, NOW);
  assert.deepEqual(first.health.days['2026-10-18'], { steps: 8123 });
  assert.deepEqual(first.health.days['2026-10-19'], { steps: 10422, weight: 181.9, bodyFat: 18.6 });
  assert.deepEqual(first.weights, [{ date: '2026-10-19', weight: 181.9 }]);
  const again = applyHealthImport(first.health, body, NOW);
  assert.equal(again.health.days['2026-10-19'].steps, 10422);
});

test('weight in kg is converted and nonsense values are skipped', () => {
  const { health } = applyHealthImport(emptyUserHealth(), { weightValues: '82.5\n4', weightDates: '2026-10-18T07:00:00Z\n2026-10-19T07:00:00Z', weightUnit: 'kg' }, NOW);
  assert.equal(health.days['2026-10-18'].weight, 181.9);
  assert.equal(health.days['2026-10-19'], undefined);
});

test('sleep stages become one night, overlapping phone and watch segments counted once', () => {
  assert.equal(sleepStage('Asleep (Core)'), 'core');
  assert.equal(sleepStage('REM'), 'rem');
  assert.equal(sleepStage('In Bed'), 'inBed');
  const { health } = applyHealthImport(emptyUserHealth(), {
    sleepValues: 'In Bed\nCore\nDeep\nREM\nAwake\nAsleep',
    sleepStarts: ['2026-10-19T22:45:00-05:00', '2026-10-19T23:00:00-05:00', '2026-10-20T01:00:00-05:00', '2026-10-20T02:00:00-05:00', '2026-10-20T03:00:00-05:00', '2026-10-19T23:00:00-05:00'].join('\n'),
    sleepEnds: ['2026-10-20T06:45:00-05:00', '2026-10-20T01:00:00-05:00', '2026-10-20T02:00:00-05:00', '2026-10-20T03:00:00-05:00', '2026-10-20T03:10:00-05:00', '2026-10-20T06:30:00-05:00'].join('\n'),
  }, NOW);
  const night = health.days['2026-10-20'].sleep!;
  // Core/deep/REM sit inside the phone's 23:00–06:30 "Asleep", so asleep is 7.5 h, not more.
  assert.equal(night.asleepMin, 450);
  assert.equal(night.deepMin, 60);
  assert.equal(night.remMin, 60);
  assert.equal(night.inBedMin, 480);
  assert.equal(night.awakeMin, 10);
});

test('a night cut short by the upload range does not replace a fuller one', () => {
  const full = applyHealthImport(emptyUserHealth(), { sleepValues: 'Core', sleepStarts: '2026-10-19T23:00:00-05:00', sleepEnds: '2026-10-20T06:00:00-05:00' }, NOW);
  const partial = applyHealthImport(full.health, { sleepValues: 'Core', sleepStarts: '2026-10-20T04:00:00-05:00', sleepEnds: '2026-10-20T06:00:00-05:00' }, NOW);
  assert.equal(partial.health.days['2026-10-20'].sleep!.asleepMin, 420);
  // A complete night with the same bedtime corrects an earlier, wrong (longer) one.
  const corrected = applyHealthImport(full.health, { sleepValues: 'Core', sleepStarts: '2026-10-19T23:00:00-05:00', sleepEnds: '2026-10-20T05:30:00-05:00' }, NOW);
  assert.equal(corrected.health.days['2026-10-20'].sleep!.asleepMin, 390);
});

const workout = {
  id: 'w1',
  timestamp: '2026-10-20T18:00:00-05:00',
  durationSecs: 3600,
  logs: { bench: [{ timestamp: Date.parse('2026-10-20T17:05:00-05:00') }] },
};

test('a workout runs from end minus duration (or its first set) to when it was saved', () => {
  assert.deepEqual(workoutWindow(workout), [Date.parse('2026-10-20T17:00:00-05:00'), Date.parse('2026-10-20T18:00:00-05:00')]);
  assert.deepEqual(workoutWindow({ timestamp: '2026-10-20T18:00:00Z', logs: { a: [{ timestamp: Date.parse('2026-10-20T17:30:00Z') }] } }), [Date.parse('2026-10-20T17:29:00Z'), Date.parse('2026-10-20T18:00:00Z')]);
});

test('heart rate and active energy during the workout are summarised', () => {
  const t0 = Date.parse('2026-10-20T17:00:00-05:00') / 1000;
  const { health } = applyHealthImport(emptyUserHealth(), {
    heartRateValues: [80, 120, 150, 130, 110, 140, 90].join('\n'),
    heartRateDates: [-600, 0, 60, 600, 1200, 2400, 7200].map((s) => new Date((t0 + s) * 1000).toISOString()).join('\n'),
    activeEnergyValues: '100\n100',
    activeEnergyStarts: `${new Date((t0 - 1800) * 1000).toISOString()}\n${new Date((t0 + 1800) * 1000).toISOString()}`,
    activeEnergyEnds: `${new Date((t0 + 1800) * 1000).toISOString()}\n${new Date((t0 + 1900) * 1000).toISOString()}`,
  }, NOW);
  const result = workoutHealth(workout, health)!;
  assert.equal(result.avgHr, 130); // 120, 150, 130, 110, 140 — not the 80 before or 90 after
  assert.equal(result.maxHr, 150);
  assert.equal(result.kcal, 150); // half of the first sample + all of the second
  assert.deepEqual(result.trace?.[0], [0, 120]);
  assert.equal(refreshWorkoutHealth(health, [workout], NOW), true);
  assert.equal(refreshWorkoutHealth(health, [workout], NOW), false);
});

test('a watch session sets the window and its calories win', () => {
  const { health } = applyHealthImport(emptyUserHealth(), {
    workoutsNames: 'Traditional Strength Training',
    workoutsStarts: '2026-10-20T16:55:00-05:00',
    workoutsEnds: '2026-10-20T17:58:00-05:00',
    workoutsCalories: '412',
  }, NOW);
  const result = workoutHealth(workout, health)!;
  assert.equal(result.watch, true);
  assert.equal(result.kcal, 412);
  assert.equal(result.start, new Date('2026-10-20T16:55:00-05:00').toISOString());
});

test('raw samples older than two weeks are dropped', () => {
  const { health } = applyHealthImport(emptyUserHealth(), { heartRateValues: '70\n71', heartRateDates: '2026-09-01T10:00:00Z\n2026-10-20T10:00:00Z' }, NOW);
  assert.equal(health.hr.length, 1);
});

test('resting heart rate and HRV are averaged per day', () => {
  const { health, summary } = applyHealthImport(emptyUserHealth(), {
    restingHeartRateValues: '52\n54',
    restingHeartRateDates: '2026-10-18T08:00:00-05:00\n2026-10-19T08:00:00-05:00',
    hrvValues: '40\n60\n55',
    hrvDates: '2026-10-19T02:00:00-05:00\n2026-10-19T04:00:00-05:00\n2026-10-18T03:00:00-05:00',
  }, NOW);
  assert.equal(health.days['2026-10-18'].restingHr, 52);
  assert.equal(health.days['2026-10-19'].hrv, 50);
  assert.equal(summary.hrv, 2);
});

test('lists of sample objects and other metric names are accepted too', () => {
  const { health, summary } = applyHealthImport(emptyUserHealth(), {
    stepCount: [{ value: '9,500', startDate: '2026-10-19T00:00:00-05:00' }],
    bodyMass: { values: ['180.2'], dates: ['2026-10-19T07:00:00-05:00'], unit: 'lb' },
    sleep: [{ Value: 'Core', 'Start Date': '2026-10-19T23:00:00-05:00', 'End Date': '2026-10-20T06:00:00-05:00' }],
  }, NOW);
  assert.equal(health.days['2026-10-19'].steps, 9500);
  assert.equal(health.days['2026-10-19'].weight, 180.2);
  assert.equal(health.days['2026-10-20'].sleep?.asleepMin, 420);
  assert.deepEqual(summary.ignored, []);
});

test('the sync message points at what to fix in the shortcut', () => {
  const { summary } = applyHealthImport(emptyUserHealth(), {
    key: 'nsh_x',
    stepsValues: '100\n200',
    stepsDates: 'yesterday\n2026-10-19T00:00:00-05:00',
    weightValues: '180\n181',
    weightDates: '2026-10-19T07:00:00-05:00',
    caloriesEaten: '2000',
  }, NOW);
  assert.equal(summary.unreadableDates, 1);
  assert.deepEqual(summary.mismatched, ['weight']);
  assert.deepEqual(summary.ignored, ['caloriesEaten']);
  const message = describeSync(summary);
  assert.match(message, /^Synced 1 day of steps, 1 weight\./);
  assert.match(message, /ISO 8601/);
  assert.match(message, /caloriesEaten/);
});

test('daily active calories add up energy samples and only grow as the day fills in', () => {
  const first = applyHealthImport(emptyUserHealth(), {
    activeEnergyValues: '100\n150\n80',
    activeEnergyStarts: '2026-10-19T09:00:00-05:00\n2026-10-19T18:00:00-05:00\n2026-10-20T08:00:00-05:00',
  }, NOW);
  assert.equal(first.health.days['2026-10-19'].activeKcal, 250);
  // A later upload that only covers the evening doesn't shrink the day.
  const later = applyHealthImport({ ...first.health, energy: [] }, {
    activeEnergyValues: '150', activeEnergyStarts: '2026-10-19T18:00:00-05:00',
  }, NOW);
  assert.equal(later.health.days['2026-10-19'].activeKcal, 250);
});

test('daily active and resting calorie totals are stored, and the exact total beats summed readings', () => {
  const { health, summary } = applyHealthImport(emptyUserHealth(), {
    activeEnergyDailyValues: '640\n710',
    activeEnergyDailyDates: '2026-10-18T00:00:00-05:00\n2026-10-19T00:00:00-05:00',
    restingEnergyValues: '1850\n1846',
    restingEnergyDates: '2026-10-18T00:00:00-05:00\n2026-10-19T00:00:00-05:00',
    activeEnergyValues: '900', activeEnergyStarts: '2026-10-19T12:00:00-05:00',
  }, NOW);
  assert.deepEqual(health.days['2026-10-19'], { activeKcal: 710, activeExact: true, restingKcal: 1846 });
  assert.equal(summary.dailyCalories, 4);
  assert.match(describeSync(summary), /4 daily calorie totals/);
});

/** Watch heart rate every 5 s through sets ending at `ends` (seconds): up through each set, peak just after, down through the rest. */
function setHeartRate(ends: number[]): [number, number][] {
  const beats: [number, number][] = [];
  for (let t = ends[0] - 600; t <= ends[ends.length - 1] + 600; t += 5) {
    let bpm = 95;
    for (const end of ends) {
      if (t >= end - 40 && t <= end + 15) bpm = Math.max(bpm, 95 + 40 * (t - end + 40) / 55);
      else if (t > end + 15) bpm = Math.max(bpm, 95 + 40 * Math.exp(-(t - end - 15) / 40));
    }
    beats.push([t, Math.round(bpm)]);
  }
  return beats;
}

test('logged sets are lined up with the heart rate they caused', () => {
  const t0 = Date.parse('2026-10-20T17:00:00Z') / 1000;
  const ends = [0, 170, 360, 540, 745, 920, 1100, 1310].map((s) => t0 + s);
  const beats = setHeartRate(ends);
  // Tapped done 75 s after each set finished.
  const late = alignSets(beats, ends.map((e) => (e + 75) * 1000));
  assert.ok(Math.abs(late + 75) <= 10, `offset ${late}`);
  // Tapped right away: nothing to move.
  assert.equal(alignSets(beats, ends.map((e) => (e + 5) * 1000)), 0);
  // A reading every 5 minutes (no Watch workout) can't place sets.
  assert.equal(alignSets(beats.filter(([t]) => t % 300 === 0), ends.map((e) => (e + 75) * 1000)), 0);
  // Flat heart rate: no shift fits better than none.
  assert.equal(alignSets(beats.map(([t]) => [t, 100]), ends.map((e) => (e + 75) * 1000)), 0);
});

test('a workout keeps the shift, and its window starts early enough for it', () => {
  const t0 = Date.parse('2026-10-20T17:00:00Z') / 1000;
  const ends = [0, 170, 360, 540, 745, 920].map((s) => t0 + s);
  const workout = {
    id: 'w', timestamp: new Date((t0 + 1100) * 1000).toISOString(),
    logs: { a: ends.map((e) => ({ timestamp: (e + 90) * 1000 })) },
  };
  const result = workoutHealth(workout, { hr: setHeartRate(ends), energy: [], watchWorkouts: [] })!;
  assert.ok(Math.abs(result.setOffsetSec! + 90) <= 10, `offset ${result.setOffsetSec}`);
  assert.ok(Date.parse(result.start) <= (ends[0] - 30) * 1000);
});

test('an automatic sync only alerts when something needs fixing', () => {
  const ok = { at: '', steps: 7, sleep: 7, weight: 0, bodyFat: 0, restingHr: 7, hrv: 7, dailyCalories: 14, heartRate: 900, activeEnergy: 800, workouts: 1 };
  assert.equal(syncAlert(ok), '');
  assert.match(syncAlert({ ...ok, unreadableDates: 3 }), /Check: 3 dates couldn't be read/);
  assert.equal(syncAlert({ ...ok, steps: 0, sleep: 0, restingHr: 0, hrv: 0, dailyCalories: 0, heartRate: 0, activeEnergy: 0, workouts: 0 }), 'Nothing usable in this upload.');
  // Daily data keeps coming but heart rate stopped days ago: say so.
  const now = Date.parse('2026-10-28T20:00:00Z');
  const noHr = { ...ok, heartRate: 0, activeEnergy: 0 };
  assert.match(syncAlert(noHr, Date.parse('2026-10-22T13:44:00Z'), now), /newest on the site is 6 days old/);
  assert.equal(syncAlert(noHr, now - 2 * 3_600_000, now), ''); // a quiet couple of hours
  assert.equal(syncAlert(noHr, null, now), ''); // never sent heart rate (no Watch)
  const old = Date.parse('2026-10-22T13:44:00Z');
  assert.match(syncAlert({ ...noHr, detail: { heartRate: 'missing', activeEnergy: 'missing' } }, old, now), /no heartRateValues/);
  assert.match(syncAlert({ ...noHr, detail: { heartRate: 'empty', activeEnergy: 'empty' } }, old, now), /Heart Rate search found nothing/);
  // Heart rate came, but starts well after the newest stored reading: a gap to backfill.
  assert.match(syncAlert({ ...ok, heartRateFrom: '2026-10-27T20:00:00Z' }, old, now), /missing for about 5 days.*Last 30 Days/);
  assert.equal(syncAlert({ ...ok, heartRateFrom: '2026-10-27T20:00:00Z' }, Date.parse('2026-10-28T17:00:00Z'), now), ''); // overlaps
});

test('the daily shortcut sends heart rate and energy from shortly before the newest reading on hand', () => {
  const now = Date.parse('2026-10-22T12:00:00Z');
  const s = (iso: string) => Date.parse(iso) / 1000;
  assert.equal(detailSinceMinutes({ hr: [], energy: [] }, now), 3 * 24 * 60);
  // Newest: heart rate 10:00, energy 9:00 → from 9:00 less 6 hours.
  assert.equal(detailSinceMinutes({ hr: [[s('2026-10-22T10:00:00Z'), 80]], energy: [[s('2026-10-22T08:59:00Z'), s('2026-10-22T09:00:00Z'), 2]] }, now), 180 + 360);
  // A week without a sync: capped at 3 days.
  assert.equal(detailSinceMinutes({ hr: [[s('2026-10-15T10:00:00Z'), 80]], energy: [[s('2026-10-15T10:00:00Z'), s('2026-10-15T10:01:00Z'), 2]] }, now), 3 * 24 * 60);
});

test('recent workouts without heart rate say what the site holds around them', () => {
  const now = Date.parse('2026-10-28T20:00:00Z');
  const s = (iso: string) => Date.parse(iso) / 1000;
  const workout = { id: 'w', timestamp: '2026-10-28T18:00:00Z', durationSecs: 3600 };
  const health = { ...emptyUserHealth(), hr: [[s('2026-10-28T16:30:00Z'), 70]] as [number, number][] };
  const [check] = matchChecks(health, [workout, { id: 'old', timestamp: '2026-10-20T18:00:00Z', durationSecs: 3600 }], now);
  assert.equal(check.id, 'w');
  assert.equal(check.from, '2026-10-28T17:00:00.000Z');
  assert.equal(check.heartRate, 0);
  assert.equal(check.newestHeartRate, '2026-10-28T16:30:00.000Z');
  assert.deepEqual(matchChecks({ ...health, workouts: { w: { start: '', end: '', kcal: 1 } } }, [workout], now), []);
});

test('an upload says whether heart rate fields were sent, empty, or missing', () => {
  const sent = applyHealthImport(emptyUserHealth(), { heartRateValues: '80', heartRateDates: '2026-10-20T10:00:00-05:00' }, NOW).summary;
  assert.deepEqual(sent.detail, { heartRate: 'ok', activeEnergy: 'missing' });
  const empty = applyHealthImport(emptyUserHealth(), { stepsValues: '10', stepsDates: '2026-10-20T00:00:00-05:00', heartRateValues: '', heartRateDates: '' }, NOW).summary;
  assert.equal(empty.detail?.heartRate, 'empty');
});

test('an upload is read as JSON or form fields, and an unreadable one says what came', () => {
  assert.deepEqual(parseSyncBody('{"key":"nsh_x","stepsValues":"1"}', 'application/json'), { key: 'nsh_x', stepsValues: '1' });
  assert.deepEqual(parseSyncBody('key=nsh_x&stepsValues=1%0A2', 'application/x-www-form-urlencoded'), { key: 'nsh_x', stepsValues: '1\n2' });
  assert.throws(() => parseSyncBody('', ''), /The upload was empty/);
  assert.throws(() => parseSyncBody('{"key":"nsh_abcdefghijklmnopqrstuv","steps', 'application/json'), /cut off/);
  assert.throws(() => parseSyncBody('<plist>nsh_abcdefghijklmnopqrstuv</plist>', 'application/x-plist'), (e: Error) => /application\/x-plist/.test(e.message) && !e.message.includes('abcdef'));
});

test('heart rate readings leave a daily average, lowest and highest behind', () => {
  // A quiet day at 60–70 bpm every 5 minutes, plus a half-hour workout at 150 every 5 seconds.
  const hrValues: number[] = [];
  const hrDates: string[] = [];
  const at = (h: number, m: number, s = 0) => `2026-10-20T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}-05:00`;
  for (let h = 8; h < 20; h++) for (let m = 0; m < 60; m += 5) { hrValues.push(60 + (m % 20) / 2); hrDates.push(at(h, m)); }
  for (let s = 0; s < 1800; s += 5) { hrValues.push(150); hrDates.push(at(17, Math.floor(s / 60), s % 60)); }
  const day = applyHealthImport(emptyUserHealth(), { heartRateValues: hrValues.join('\n'), heartRateDates: hrDates.join('\n') }, NOW).health.days['2026-10-20'];
  assert.equal(day.hrMin, 60);
  assert.equal(day.hrMax, 150);
  // Averaged per 5 minutes: the workout's 360 readings count as 6 of 144 slots, not as most of the day.
  assert.ok(day.hrAvg! > 60 && day.hrAvg! < 75, `avg ${day.hrAvg}`);
});
