import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { readJson, writeJsonAtomic } from '@/lib/json-store';
import { syncWorkoutHabitForDate, resolveWorkoutHabitDate } from './habit-sync';

test('resolveWorkoutHabitDate trusts localDate within 1 day of timestamp and falls back otherwise', () => {
  assert.equal(resolveWorkoutHabitDate('2026-05-10', '2026-05-11T04:00:00.000Z'), '2026-05-10');
  assert.equal(resolveWorkoutHabitDate('2026-05-01', '2026-05-11T04:00:00.000Z'), '2026-05-11');
  assert.equal(resolveWorkoutHabitDate(undefined, '2026-05-11T15:00:00.000Z'), '2026-05-11');
});

test('syncWorkoutHabitForDate ticks active workout-linked habits and avoids creating missing files', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'workout-habit-sync-'));
  try {
    // Missing file: returns false and does not create .data/habits/<user>.json.
    const noFile = await syncWorkoutHabitForDate('u-none', '2026-05-10', tmpDir);
    assert.equal(noFile, false);
    await assert.rejects(() => fs.access(path.join(tmpDir, '.data', 'habits', 'u-none.json')));

    // Existing file with active workout-linked habit + archived workout habit + unrelated habit.
    const file = path.join(tmpDir, '.data', 'habits', 'u-1.json');
    await writeJsonAtomic(file, {
      habits: [
        { id: 'h-lift', name: 'Lift', kind: 'check', target: 1, color: 0, link: 'workout', createdOn: '2026-01-01' },
        { id: 'h-arch', name: 'Old Lift', kind: 'check', target: 1, color: 1, link: 'workout', createdOn: '2026-01-01', archivedOn: '2026-02-01' },
        { id: 'h-read', name: 'Read', kind: 'check', target: 1, color: 2, createdOn: '2026-01-01' },
      ],
      log: {},
    });

    const changed = await syncWorkoutHabitForDate('u-1', '2026-05-10', tmpDir);
    assert.equal(changed, true);

    const saved = await readJson<any>(file, {});
    assert.equal(saved.log['2026-05-10']['h-lift'], 1);
    assert.equal(saved.log['2026-05-10']['h-arch'], undefined);
    assert.equal(saved.log['2026-05-10']['h-read'], undefined);

    // Calling again when already checked returns false cleanly.
    const repeat = await syncWorkoutHabitForDate('u-1', '2026-05-10', tmpDir);
    assert.equal(repeat, false);
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});
