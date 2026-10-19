import test from 'node:test';
import assert from 'node:assert/strict';
import { inferCalibrationsForWorkout, recalibrateAfterEdit, type CalibrationStore } from './calibration';
import { calcAverage1RM } from './analytics';

const homeRow = { gymId: 'home', timestamp: '2026-10-01T18:00:00Z', logs: { r1: [{ weight: 100, reps: 10 }] }, liftMeta: { r1: { name: 'Machine Row', stationType: 'stack' } } };
const gymRow = { gymId: 'gym', timestamp: '2026-10-08T18:00:00Z', logs: { r2: [{ weight: 150, reps: 10 }] }, liftMeta: { r2: { name: 'Machine Row', stationType: 'stack' } } };

test('editing the workout a calibration came from redoes it', () => {
  const inferred = inferCalibrationsForWorkout('me', gymRow, [homeRow], { calibrations: [] }, calcAverage1RM);
  assert.equal(inferred.length, 1);
  const store: CalibrationStore = { calibrations: inferred };
  const fixed = { ...gymRow, logs: { r2: [{ weight: 120, reps: 10 }] } };
  const redone = recalibrateAfterEdit('me', gymRow, fixed, [homeRow], store, calcAverage1RM);
  assert.equal(redone.length, 1);
  assert.ok(redone[0].scaleFactor > inferred[0].scaleFactor); // lighter numbers here → this machine reads lighter
  assert.equal(redone[0].reference?.currentWeight, 120);
});

test('a hand-set calibration is left alone', () => {
  const store: CalibrationStore = { calibrations: [{ userId: 'me', gymId: 'gym', liftKey: 'machine row', stationType: 'stack', scaleFactor: 1.1, confidence: 0.8, updatedAt: '' }] };
  assert.deepEqual(recalibrateAfterEdit('me', gymRow, { ...gymRow, logs: { r2: [{ weight: 120, reps: 10 }] } }, [homeRow], store, calcAverage1RM), []);
});
