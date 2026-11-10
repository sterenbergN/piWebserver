import test from 'node:test';
import { strict as assert } from 'node:assert';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { readJson, updateJson } from './json-store';

async function inTempDir(run: (dir: string) => Promise<void>) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'json-store-'));
  try {
    await run(dir);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

test('nothing saved yet reads as the default, and the first update saves it', () => inTempDir(async (dir) => {
  const file = path.join(dir, 'deep', 'list.json');
  assert.deepEqual(await readJson(file, { items: [] as number[] }), { items: [] });

  await updateJson(file, { items: [] as number[] }, (data) => { data.items.push(1); });
  assert.deepEqual(await readJson(file, { items: [] as number[] }), { items: [1] });

  // An empty file holds nothing to lose, so it counts as nothing saved.
  await fs.writeFile(file, '  \n');
  assert.deepEqual(await readJson(file, { items: [] as number[] }), { items: [] });
}));

test('a damaged file is never replaced with the default', () => inTempDir(async (dir) => {
  const file = path.join(dir, 'habits.json');
  const damaged = '{"habits": [ {"id": "run", "done": ["2026-11-0';
  await fs.writeFile(file, damaged);

  await assert.rejects(readJson(file, { habits: [] }), /damaged/);

  let ran = false;
  await assert.rejects(updateJson(file, { habits: [] as unknown[] }, (data) => { ran = true; data.habits.push({ id: 'new' }); }), /damaged/);
  assert.equal(ran, false, 'the change is never applied to the default');
  assert.equal(await fs.readFile(file, 'utf-8'), damaged, 'the damaged file is left as it is');
}));

test('a damaged file is copied aside once, however often it is read', () => inTempDir(async (dir) => {
  const file = path.join(dir, 'journal.json');
  await fs.writeFile(file, '{"entries": [');
  for (let i = 0; i < 3; i++) await assert.rejects(readJson(file, null));

  const names = await fs.readdir(dir);
  const copies = names.filter((name) => name.startsWith('journal.json.corrupt-'));
  assert.equal(copies.length, 1);
  assert.equal(await fs.readFile(path.join(dir, copies[0]), 'utf-8'), '{"entries": [');
  // Folder listings that look for data files must not pick the copy up.
  assert.deepEqual(names.filter((name) => name.endsWith('.json')), ['journal.json']);
  assert.ok(!names.some((name) => name.endsWith('.tmp')));
}));

test('a file that is there but cannot be read is an error, not "no data"', () => inTempDir(async (dir) => {
  // A folder where the file should be: reading it fails with something other than "not found".
  const file = path.join(dir, 'recipes.json');
  await fs.mkdir(file);
  await assert.rejects(readJson(file, { recipes: [] }));
  await assert.rejects(updateJson(file, { recipes: [] as unknown[] }, (data) => { data.recipes.push(1); }));
  assert.ok((await fs.stat(file)).isDirectory());
}));

test('a mutator returning false, or throwing, writes nothing', () => inTempDir(async (dir) => {
  const file = path.join(dir, 'chores.json');
  await updateJson(file, { n: 0 }, (data) => { data.n = 1; });

  assert.equal(await updateJson<{ n: number }, boolean>(file, { n: 0 }, (data) => { data.n = 2; return false; }), false);
  await assert.rejects(updateJson(file, { n: 0 }, (data) => { data.n = 3; throw new Error('not allowed'); }), /not allowed/);

  assert.deepEqual(await readJson(file, { n: 0 }), { n: 1 });
  assert.deepEqual(await fs.readdir(dir), ['chores.json']);
}));

test('concurrent updates are serialized and none are lost', () => inTempDir(async (dir) => {
  const file = path.join(dir, 'counter.json');
  await Promise.all(
    Array.from({ length: 25 }, (_, i) =>
      updateJson(file, { items: [] as number[] }, async (data) => {
        const snapshot = [...data.items];
        await new Promise((resolve) => setTimeout(resolve, Math.random() * 5));
        data.items = [...snapshot, i];
      })
    )
  );
  assert.equal((await readJson(file, { items: [] as number[] })).items.length, 25);
}));
