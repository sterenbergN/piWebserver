import test from 'node:test';
import assert from 'node:assert/strict';
import { findReferenceLift, inferCalibrationsForWorkout, recalibrateAfterEdit, type CalibrationStore } from './calibration';
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

test('findReferenceLift and inferCalibrationsForWorkout prefer matching manufacturer/model over newer different-brand same-kind station', () => {
  const history: Parameters<typeof findReferenceLift>[0] = [
    {
      gymId: 'other-newer',
      gymName: 'Other Newer',
      timestamp: '2026-10-10T18:00:00Z',
      liftMeta: { rNew: { name: 'Chest Press', stationType: 'stack', stationId: 'st-cybex' } },
      logs: { rNew: [{ weight: 140, reps: 10 }] },
    },
    {
      gymId: 'other-older',
      gymName: 'Other Older',
      timestamp: '2026-10-01T18:00:00Z',
      liftMeta: { rOld: { name: 'Chest Press', stationType: 'stack', stationId: 'st-lf-old' } },
      logs: { rOld: [{ weight: 100, reps: 10 }] },
    },
  ];
  const stationKinds = new Map([
    ['st-cybex', 'chest press'],
    ['st-lf-old', 'chest press'],
    ['st-lf-new', 'chest press'],
  ]);
  const stationMakeModels = new Map([
    ['st-cybex', 'cybex eagle'],
    ['st-lf-old', 'life fitness insignia'],
    ['st-lf-new', 'life fitness insignia'],
  ]);

  const found = findReferenceLift(
    history,
    { liftKey: 'chest press', exerciseKey: 'chest press', kindKey: 'chest press', makeModelKey: 'life fitness insignia' },
    stationKinds,
    stationMakeModels,
  );
  assert.equal(found?.liftId, 'rOld');
  assert.equal(found?.workout.gymId, 'other-older');

  const currentWorkout = {
    gymId: 'target-gym',
    timestamp: '2026-10-15T18:00:00Z',
    liftMeta: { rCurr: { name: 'Chest Press', stationType: 'stack', stationId: 'st-lf-new' } },
    logs: { rCurr: [{ weight: 100, reps: 10 }] },
  };
  const inferred = inferCalibrationsForWorkout(
    'me',
    currentWorkout,
    history,
    { calibrations: [] },
    calcAverage1RM,
    stationKinds,
    stationMakeModels,
  );
  assert.equal(inferred.length, 1);
  assert.equal(inferred[0].reference?.fromGymId, 'other-older');
  assert.equal(inferred[0].reference?.fromLiftId, 'rOld');
  assert.equal(inferred[0].scaleFactor, 1);
});
