import test from 'node:test';
import { strict as assert } from 'node:assert';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import AdmZip from 'adm-zip';
import { ZipWriter, crc32, extractZipEntry, readZipEntries, readZipEntry } from './zip-stream';

test('crc32 matches the standard check value', () => {
  assert.equal(crc32(Buffer.from('123456789')), 0xcbf43926);
  assert.equal(crc32(Buffer.from('6789'), crc32(Buffer.from('12345'))), 0xcbf43926);
});

test('zips written by ZipWriter read back here and in other zip tools', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'zip-'));
  const photo = Buffer.alloc(3 * 1024 * 1024 + 17, 7);
  photo.write('not really a jpeg', 0);
  await fs.writeFile(path.join(dir, 'photo.jpg'), photo);
  await fs.writeFile(path.join(dir, 'data.json'), JSON.stringify({ hello: 'world'.repeat(100) }));
  const file = path.join(dir, 'out.zip');
  const zip = await ZipWriter.create(file);
  assert.equal(await zip.addFile('public/uploads/photo.jpg', path.join(dir, 'photo.jpg')), photo.length);
  assert.ok(await zip.addFile('.data/data.json', path.join(dir, 'data.json')));
  assert.equal(await zip.addFile('missing.txt', path.join(dir, 'nope.txt')), null);
  await zip.addBuffer('backup-manifest.json', Buffer.from('{"ok":true}'));
  await zip.close();

  const entries = await readZipEntries(file);
  assert.deepEqual(entries.map((e) => e.name), ['public/uploads/photo.jpg', '.data/data.json', 'backup-manifest.json']);
  assert.equal(entries[0].method, 0); // photos stored as-is
  assert.equal(entries[1].method, 8); // data deflated
  assert.equal((await readZipEntry(file, entries[2])).toString(), '{"ok":true}');
  await extractZipEntry(file, entries[0], path.join(dir, 'restored', 'photo.jpg'));
  assert.ok((await fs.readFile(path.join(dir, 'restored', 'photo.jpg'))).equals(photo));

  const other = new AdmZip(file);
  assert.ok(other.getEntry('public/uploads/photo.jpg')!.getData().equals(photo));
  assert.equal(JSON.parse(other.readAsText('.data/data.json')).hello.length, 500);
});

test('old in-memory backups (made with adm-zip) still restore', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'zip-'));
  const old = new AdmZip();
  old.addFile('.data/a.json', Buffer.from('{"v":1}'.repeat(50)));
  old.addFile('backup-manifest.json', Buffer.from('{}'));
  const file = path.join(dir, 'old.zip');
  old.writeZip(file);
  const entries = await readZipEntries(file);
  assert.equal((await readZipEntry(file, entries.find((e) => e.name === '.data/a.json')!)).toString(), '{"v":1}'.repeat(50));
});
