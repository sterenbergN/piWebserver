import test from 'node:test';
import { strict as assert } from 'node:assert';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';

test('buildStarterWorkoutTypes creates 5 expected templates', async () => {
  const { buildStarterWorkoutTypes } = await import('./starter-types');
  const types = buildStarterWorkoutTypes('user-1');
  assert.equal(types.length, 5);
  assert.deepEqual(
    types.map((t) => [t.name, t.muscles]),
    [
      ['Push', ['Chest', 'Shoulders', 'Triceps']],
      ['Pull', ['Back', 'Biceps']],
      ['Legs', ['Quads', 'Hamstrings', 'Glutes', 'Calves']],
      ['Upper Body', ['Chest', 'Back', 'Shoulders', 'Biceps', 'Triceps']],
      ['Lower Body', ['Quads', 'Hamstrings', 'Glutes', 'Calves', 'Core']],
    ],
  );
  for (const t of types) {
    assert.equal(t.ownerId, 'user-1');
    assert.equal(t.intensity, 75);
    assert.equal(t.minReps, 8);
    assert.equal(t.maxReps, 12);
    assert.equal(t.sets, 4);
    assert.deepEqual(t.fixedLifts, []);
    assert.equal(t.isPublic, false);
    assert.ok(t.id.length > 0);
  }
  assert.equal(new Set(types.map((t) => t.id)).size, 5);
});

test('ensureStarterWorkoutTypes seeds once and respects seededUsers after deletion', async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'workout-starters-'));
  const originalCwd = process.cwd();
  process.chdir(tmp);
  try {
    const { ensureStarterWorkoutTypes, WORKOUT_TYPES_FILE } = await import('./starter-types');
    const { getWorkoutData, updateWorkoutData } = await import('./data');

    const first = await ensureStarterWorkoutTypes('u1');
    assert.equal(first, true);

    const afterFirst = await getWorkoutData<{ types: any[]; seededUsers: string[] }>(WORKOUT_TYPES_FILE, { types: [], seededUsers: [] });
    assert.equal(afterFirst.types.filter((t) => t.ownerId === 'u1').length, 5);
    assert.ok(afterFirst.seededUsers.includes('u1'));

    // Calling again is a no-op
    assert.equal(await ensureStarterWorkoutTypes('u1'), false);

    // User deletes all 5 starter types intentionally; should NOT be re-seeded
    await updateWorkoutData<{ types: any[]; seededUsers?: string[] }>(WORKOUT_TYPES_FILE, { types: [], seededUsers: [] }, (d) => {
      d.types = d.types.filter((t) => t.ownerId !== 'u1');
    });
    assert.equal(await ensureStarterWorkoutTypes('u1'), false);
    const afterDelete = await getWorkoutData<{ types: any[]; seededUsers: string[] }>(WORKOUT_TYPES_FILE, { types: [], seededUsers: [] });
    assert.equal(afterDelete.types.filter((t) => t.ownerId === 'u1').length, 0);
  } finally {
    process.chdir(originalCwd);
    await fs.rm(tmp, { recursive: true, force: true });
  }
});
