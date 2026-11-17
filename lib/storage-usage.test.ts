import test from 'node:test';
import { strict as assert } from 'node:assert';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { measureStorage } from './storage-usage';

const write = async (file: string, bytes: number) => {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, Buffer.alloc(bytes, 1));
};

test('storage is split by site area, following the release links to shared data once', async () => {
  const app = await fs.mkdtemp(path.join(os.tmpdir(), 'storage-usage-'));
  try {
    const shared = path.join(app, 'shared');
    const current = path.join(app, 'releases', 'v2');
    const old = path.join(app, 'releases', 'v1');
    await write(path.join(shared, 'uploads', 'gallery', 'a.jpg'), 50_000);
    await write(path.join(shared, 'uploads', 'blog', 'post.md'), 2_000);
    await write(path.join(shared, 'data', 'notes', 'n.json'), 8_000);
    await write(path.join(shared, 'data', 'analytics.json'), 1_000);
    await write(path.join(shared, 'cache', 'thumbs-v2', 't.webp'), 4_000);
    await fs.mkdir(path.join(shared, 'content'), { recursive: true });
    await write(path.join(current, 'server.js'), 3_000);
    await write(path.join(current, 'public', 'icons', 'i.png'), 500);
    await write(path.join(old, 'server.js'), 3_000);
    await fs.mkdir(path.join(current, 'public'), { recursive: true });
    // As deploy.sh links them (a junction on Windows, so no admin rights needed).
    await fs.symlink(path.join(shared, 'uploads'), path.join(current, 'public', 'uploads'), 'junction');
    await fs.symlink(path.join(shared, 'content'), path.join(current, 'public', 'content'), 'junction');
    await fs.symlink(path.join(shared, 'data'), path.join(current, '.data'), 'junction');
    await fs.symlink(path.join(shared, 'cache'), path.join(current, '.cache'), 'junction');
    await fs.symlink(path.join(shared, 'data'), path.join(old, '.data'), 'junction');

    const report = await measureStorage({ cwd: current });
    const area = (id: string) => report.areas.find((a) => a.id === id);

    const uploads = area('uploads');
    assert.ok(uploads);
    assert.ok(uploads.bytes >= 52_000);
    assert.equal(uploads.items[0].label, 'Photo gallery');
    assert.equal(uploads.files, 2);

    const data = area('data');
    assert.ok(data);
    assert.ok(data.items.some((i) => i.label === 'Notes'));
    assert.equal(data.files, 2);

    assert.equal(area('cache')?.items[0].label, 'Photo thumbnails');

    // The code is the release itself plus public's own files, not the linked data.
    const code = area('code');
    assert.ok(code);
    assert.equal(code.files, 2);

    // The other release counts, but not the data it links to.
    const releases = area('releases');
    assert.ok(releases);
    assert.equal(releases.files, 1);
    assert.deepEqual(releases.items.map((i) => i.name), ['v1']);

    // Biggest first.
    assert.equal(report.areas[0].id, 'uploads');
  } finally {
    await fs.rm(app, { recursive: true, force: true });
  }
});
