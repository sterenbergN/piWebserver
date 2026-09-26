import test from 'node:test';
import { strict as assert } from 'node:assert';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { isNightlyDue, isRestorablePath, normalizeSettings, defaultSettings } from './backup';

test('isRestorablePath only allows data folders without path tricks', () => {
  assert.ok(isRestorablePath('.data/workouts/history.json'));
  assert.ok(isRestorablePath('public/content/profile.json'));
  assert.ok(isRestorablePath('public/uploads/blog/post.md'));
  assert.ok(!isRestorablePath('public/uploads/../../package.json'));
  assert.ok(!isRestorablePath('/etc/passwd'));
  assert.ok(!isRestorablePath('app/page.tsx'));
  assert.ok(!isRestorablePath('.data/backup-settings.json'));
});

test('nightly backup runs once a day after the configured hour', () => {
  const s = { ...defaultSettings(), hour: 3 };
  assert.equal(isNightlyDue(s, new Date(2026, 8, 26, 2)), false);
  assert.equal(isNightlyDue(s, new Date(2026, 8, 26, 4)), true);
  assert.equal(isNightlyDue({ ...s, lastAutoBackup: new Date(2026, 8, 26, 3, 5).toISOString() }, new Date(2026, 8, 26, 23)), false);
  assert.equal(isNightlyDue({ ...s, enabled: false }, new Date(2026, 8, 26, 4)), false);
});

test('normalizeSettings clamps values and requires an absolute folder', () => {
  const s = normalizeSettings({ keep: 0, hour: 30, dir: '/mnt/usb/backups' }, defaultSettings());
  assert.equal(s.keep, 1);
  assert.equal(s.hour, 23);
  assert.throws(() => normalizeSettings({ dir: 'relative/path' }, defaultSettings()));
});

test('create, list and restore a backup round trip', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'backup-'));
  const cwd = process.cwd();
  process.chdir(dir);
  try {
    await fs.mkdir('.data/workouts', { recursive: true });
    await fs.mkdir('.data/party', { recursive: true });
    await fs.mkdir('public/uploads/gallery', { recursive: true });
    await fs.writeFile('.data/workouts/history.json', '{"v":1}');
    await fs.writeFile('.data/party/ROOM.json', '{}');
    await fs.writeFile('public/uploads/gallery/albums.json', '[]');
    await fs.writeFile('public/uploads/gallery/photo.jpg', 'jpeg');
    const { createBackup, listBackups, restoreBackup, collectBackupFiles } = await import('./backup');

    const files = await collectBackupFiles(false);
    assert.deepEqual(files.sort(), ['.data/workouts/history.json', 'public/uploads/gallery/albums.json']);
    assert.ok((await collectBackupFiles(true)).includes('public/uploads/gallery/photo.jpg'));

    const made = await createBackup('manual');
    await fs.writeFile('.data/workouts/history.json', '{"v":2}');
    const { restored, safetyBackup } = await restoreBackup(made.name);
    assert.equal(restored, 2);
    assert.equal(await fs.readFile('.data/workouts/history.json', 'utf-8'), '{"v":1}');
    const names = (await listBackups()).map((b) => b.name);
    assert.ok(names.includes(made.name) && names.includes(safetyBackup));
    await assert.rejects(() => restoreBackup('../../etc/passwd'));
  } finally {
    process.chdir(cwd);
  }
});
