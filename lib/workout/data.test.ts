import test from 'node:test';
import { strict as assert } from 'node:assert';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';

test('concurrent updates are serialized and none are lost', async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'workout-data-'));
  const originalCwd = process.cwd();
  process.chdir(tmp);
  try {
    const { updateWorkoutData, getWorkoutData } = await import('./data');
    await Promise.all(
      Array.from({ length: 25 }, (_, i) =>
        updateWorkoutData('counter.json', { items: [] as number[] }, async (data) => {
          const snapshot = [...data.items];
          await new Promise((resolve) => setTimeout(resolve, Math.random() * 5));
          data.items = [...snapshot, i];
        })
      )
    );
    const result = await getWorkoutData('counter.json', { items: [] as number[] });
    assert.equal(result.items.length, 25);
  } finally {
    process.chdir(originalCwd);
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test('a corrupt data file is never silently replaced with defaults', async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'workout-data-'));
  const originalCwd = process.cwd();
  process.chdir(tmp);
  try {
    const { updateWorkoutData, ensureWorkoutDir } = await import('./data');
    await ensureWorkoutDir();
    const file = path.join(tmp, '.data', 'workouts', 'broken.json');
    await fs.writeFile(file, '{"history": [ {"id": 1}');

    await assert.rejects(
      updateWorkoutData('broken.json', { history: [] as any[] }, (data) => { data.history.push({ id: 2 }); })
    );
    assert.equal(await fs.readFile(file, 'utf-8'), '{"history": [ {"id": 1}');
  } finally {
    process.chdir(originalCwd);
    await fs.rm(tmp, { recursive: true, force: true });
  }
});
