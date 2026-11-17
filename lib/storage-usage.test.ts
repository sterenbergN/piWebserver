import test from 'node:test';
import { strict as assert } from 'node:assert';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { measureStorage, measureSystem, siteFolders } from './storage-usage';

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

test('the rest of the drive is broken down, skipping the site and drilling into where the space is', async () => {
  const drive = await fs.mkdtemp(path.join(os.tmpdir(), 'storage-system-'));
  try {
    const real = await fs.realpath(drive);
    const site = path.join(real, 'home', 'pi', 'piWebserver');
    await write(path.join(site, 'server.js'), 90_000);
    await write(path.join(site, '.data', 'notes.json'), 90_000);
    await write(path.join(real, 'home', 'pi', '.npm', '_cacache', 'blob'), 40_000);
    await write(path.join(real, 'home', 'pi', '.pm2', 'logs', 'out.log'), 6_000);
    await write(path.join(real, 'var', 'log', 'journal', 'system.journal'), 20_000);
    await write(path.join(real, 'var', 'cache', 'apt', 'archives', 'pkg.deb'), 5_000);
    await write(path.join(real, 'swapfile'), 30_000);

    const report = await measureSystem({ root: real, skip: await siteFolders({ cwd: site }) });
    const folder = (p: string) => report.folders.find((f) => f.path === path.join(real, p));

    // The site is counted in its own report, not here.
    assert.equal(report.files, 5);
    assert.ok(report.bytes >= 101_000 && report.bytes < 180_000);
    assert.equal(report.partial, false);

    // /home is all /home/pi, so it goes straight to what's inside that.
    const home = folder('home');
    assert.ok(home?.inside);
    assert.deepEqual(home.inside.map((f) => path.relative(real, f.path).replace(/\\/g, '/')), ['home/pi/.npm', 'home/pi/.pm2']);
    assert.equal(home.inside[0].label, 'npm download cache');
    assert.match(home.inside[0].hint ?? '', /npm cache clean/);

    assert.equal(folder('var')?.inside?.[0].path, path.join(real, 'var', 'log'));
    assert.equal(folder('swapfile')?.files, 1);
    // Biggest first.
    assert.equal(report.folders[0].path, path.join(real, 'home'));
  } finally {
    await fs.rm(drive, { recursive: true, force: true });
  }
});
