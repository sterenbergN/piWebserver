import test from 'node:test';
import { strict as assert } from 'node:assert';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import AdmZip from 'adm-zip';
import { AnkiFileError, plainField, readApkg } from './anki-import';
import { deckRows, emptyMap } from './coverage';

// Real exports are SQLite databases in a zip, so these build small ones in the two layouts Anki writes.

const sqlite = (process as any).getBuiltinModule('node:sqlite');
const NOW = '2026-10-31T15:00:00.000Z';
const DAY_MS = Date.UTC(2026, 9, 20);

const SHARED = `
  CREATE TABLE notes (id INTEGER PRIMARY KEY, guid TEXT, mid INTEGER, mod INTEGER, usn INTEGER, tags TEXT, flds TEXT, sfld TEXT, csum INTEGER, flags INTEGER, data TEXT);
  CREATE TABLE cards (id INTEGER PRIMARY KEY, nid INTEGER, did INTEGER, ord INTEGER, mod INTEGER, usn INTEGER, type INTEGER, queue INTEGER, due INTEGER, ivl INTEGER, factor INTEGER, reps INTEGER, lapses INTEGER, left INTEGER, odue INTEGER, odid INTEGER, flags INTEGER, data TEXT);
  CREATE TABLE revlog (id INTEGER PRIMARY KEY, cid INTEGER, usn INTEGER, ease INTEGER, ivl INTEGER, lastIvl INTEGER, factor INTEGER, time INTEGER, type INTEGER);
`;

type Card = { id: number; nid: number; did: number; odid?: number; type: number; queue?: number; ivl?: number; reps?: number; lapses?: number };

function fill(db: any, notes: [number, string, string][], cards: Card[], reviews: [number, number, number, number][]) {
  const note = db.prepare('INSERT INTO notes (id, tags, flds) VALUES (?, ?, ?)');
  for (const row of notes) note.run(...row);
  const card = db.prepare('INSERT INTO cards (id, nid, did, odid, type, queue, ivl, reps, lapses) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
  for (const c of cards) card.run(c.id, c.nid, c.did, c.odid ?? 0, c.type, c.queue ?? c.type, c.ivl ?? 0, c.reps ?? 0, c.lapses ?? 0);
  const review = db.prepare('INSERT INTO revlog (id, cid, ease, type) VALUES (?, ?, ?, ?)');
  for (const row of reviews) review.run(...row);
}

const NOTES: [number, string, string][] = [
  [1, ' cardio::hf marked ', 'What lowers mortality in <b>HFrEF</b>?\x1fARNI, beta blocker, MRA, SGLT2i'],
  [2, ' cardio::hf ', '{{c1::Furosemide::drug}} is a loop diuretic&nbsp;<img src="a.png">\x1f'],
  [3, '', 'New card\x1fNever seen'],
  [4, ' leech ', 'Forgotten a lot\x1fStill forgotten [sound:x.mp3]'],
];
const CARDS: Card[] = [
  { id: 10, nid: 1, did: 100, type: 2, ivl: 40, reps: 9, lapses: 1 },
  { id: 11, nid: 2, did: 200, type: 2, ivl: 5, reps: 6, lapses: 4 },
  { id: 12, nid: 3, did: 200, type: 0 },
  { id: 13, nid: 4, did: 999, odid: 100, type: 2, queue: -1, ivl: 2, reps: 20, lapses: 8 },
];
const REVIEWS: [number, number, number, number][] = [
  [DAY_MS, 10, 3, 1], [DAY_MS + 1, 10, 1, 1], [DAY_MS + 2, 10, 2, 0], [DAY_MS + 3, 10, 0, 4],
];

async function makeFolder() {
  return fs.mkdtemp(path.join(os.tmpdir(), 'anki-'));
}

function legacyDb(file: string) {
  const db = new sqlite.DatabaseSync(file);
  db.exec(`${SHARED} CREATE TABLE col (id INTEGER PRIMARY KEY, decks TEXT);`);
  db.prepare('INSERT INTO col (id, decks) VALUES (1, ?)').run(JSON.stringify({
    100: { id: 100, name: 'PA::Cardiology' }, 200: { id: 200, name: 'PA::Pharm' }, 999: { id: 999, name: 'Filtered' },
  }));
  fill(db, NOTES, CARDS, REVIEWS);
  db.close();
}

function modernDb(file: string) {
  const db = new sqlite.DatabaseSync(file);
  db.exec(`${SHARED} CREATE TABLE col (id INTEGER PRIMARY KEY, decks TEXT); CREATE TABLE decks (id INTEGER PRIMARY KEY, name TEXT);`);
  db.prepare('INSERT INTO col (id, decks) VALUES (1, ?)').run('{}');
  const deck = db.prepare('INSERT INTO decks (id, name) VALUES (?, ?)');
  deck.run(100, 'PA\x1fCardiology');
  deck.run(200, 'PA\x1fPharm');
  fill(db, NOTES, CARDS.map((c) => ({ ...c, did: c.odid || c.did, odid: 0 })), REVIEWS);
  db.close();
}

/** A dummy collection like the one a modern export carries for old versions of Anki. */
function dummyDb(file: string) {
  const db = new sqlite.DatabaseSync(file);
  db.exec(`${SHARED} CREATE TABLE col (id INTEGER PRIMARY KEY, decks TEXT);`);
  db.prepare('INSERT INTO col (id, decks) VALUES (1, ?)').run(JSON.stringify({ 1: { id: 1, name: 'Default' } }));
  fill(db, [[1, '', 'Please update to the latest Anki version\x1f']], [{ id: 1, nid: 1, did: 1, type: 0 }], []);
  db.close();
}

async function zipUp(folder: string, entries: Record<string, Buffer>) {
  const zip = new AdmZip();
  for (const [name, data] of Object.entries(entries)) zip.addFile(name, data);
  const file = path.join(folder, 'export.apkg');
  zip.writeZip(file);
  return file;
}

function assertFixture(data: Awaited<ReturnType<typeof readApkg>>) {
  assert.equal(data.hasHistory, true);
  assert.deepEqual([...data.decks].sort(), ['PA::Cardiology', 'PA::Pharm']);
  const cards = data.groups.reduce((n, g) => n + g.cards, 0);
  assert.equal(cards, 4);
  const sum = (key: 'fresh' | 'young' | 'mature' | 'suspended' | 'lapses' | 'passed' | 'graded') => data.groups.reduce((n, g) => n + g[key], 0);
  assert.equal(sum('fresh'), 1);
  assert.equal(sum('mature'), 1);
  assert.equal(sum('young'), 2);
  assert.equal(sum('suspended'), 1);
  assert.equal(sum('lapses'), 13);
  // Two real reviews (one pass, one fail); learning steps and reschedules don't count toward retention.
  assert.equal(sum('graded'), 2);
  assert.equal(sum('passed'), 1);
  assert.ok(data.tags.includes('cardio::hf'));
  assert.ok(!data.tags.includes('marked') && !data.tags.includes('leech'));

  // Most forgotten first, with the text cleaned up.
  assert.deepEqual(data.leeches.map((l) => l.lapses), [8, 4]);
  assert.equal(data.leeches[0].front, 'Forgotten a lot');
  assert.equal(data.leeches[0].back, 'Still forgotten');
  assert.equal(data.leeches[1].front, '[Furosemide] is a loop diuretic');
  assert.equal(data.leeches[1].back, '');
  assert.equal(data.decks[data.leeches[0].deck], 'PA::Cardiology', 'a filtered card belongs to its home deck');

  const last = data.groups.map((g) => g.lastReview).filter(Boolean);
  assert.deepEqual(last, ['2026-10-20']);
}

test('an older export is read, and the cards counted', async () => {
  const folder = await makeFolder();
  legacyDb(path.join(folder, 'db'));
  const file = await zipUp(folder, { 'collection.anki21': await fs.readFile(path.join(folder, 'db')), media: Buffer.from('{}') });
  const data = await readApkg(file, 'all.apkg', NOW);
  assert.equal(data.format, 'legacy');
  assert.equal(data.fileName, 'all.apkg');
  assertFixture(data);
  const left = await fs.readdir(folder);
  assert.ok(!left.some((name) => name.endsWith('.tmp')), 'the unpacked database is cleaned up');
  await fs.rm(folder, { recursive: true });
});

test('a modern export is read, not the dummy that comes with it', async () => {
  const folder = await makeFolder();
  modernDb(path.join(folder, 'db'));
  dummyDb(path.join(folder, 'dummy'));
  const packed = (zlib as any).zstdCompressSync(await fs.readFile(path.join(folder, 'db')));
  const file = await zipUp(folder, { 'collection.anki2': await fs.readFile(path.join(folder, 'dummy')), 'collection.anki21b': packed });
  const data = await readApkg(file, 'all.apkg', NOW);
  assert.equal(data.format, 'modern');
  assertFixture(data);
  await fs.rm(folder, { recursive: true });
});

test('an older-style export without the anki21 file still reads anki2', async () => {
  const folder = await makeFolder();
  legacyDb(path.join(folder, 'db'));
  const file = await zipUp(folder, { 'collection.anki2': await fs.readFile(path.join(folder, 'db')) });
  assert.equal((await readApkg(file, 'old.apkg', NOW)).groups.reduce((n, g) => n + g.cards, 0), 4);
  await fs.rm(folder, { recursive: true });
});

test('an export without scheduling says so', async () => {
  const folder = await makeFolder();
  const dbFile = path.join(folder, 'db');
  const db = new sqlite.DatabaseSync(dbFile);
  db.exec(`${SHARED} CREATE TABLE col (id INTEGER PRIMARY KEY, decks TEXT);`);
  db.prepare('INSERT INTO col (id, decks) VALUES (1, ?)').run(JSON.stringify({ 1: { id: 1, name: 'Cardio' } }));
  fill(db, [[1, '', 'Front\x1fBack']], [{ id: 1, nid: 1, did: 1, type: 0 }], []);
  db.close();
  const data = await readApkg(await zipUp(folder, { 'collection.anki21': await fs.readFile(dbFile) }), 'x.apkg', NOW);
  assert.equal(data.hasHistory, false);
  await fs.rm(folder, { recursive: true });
});

test('files that aren’t exports get a clear answer, and leave nothing behind', async () => {
  const folder = await makeFolder();
  const notZip = path.join(folder, 'notes.apkg');
  await fs.writeFile(notZip, 'just some text');
  await assert.rejects(readApkg(notZip, 'notes.apkg', NOW), (e: Error) => e instanceof AnkiFileError && /doesn’t look like an Anki export/.test(e.message));

  const noCollection = await zipUp(folder, { 'readme.txt': Buffer.from('hello') });
  await assert.rejects(readApkg(noCollection, 'x.apkg', NOW), /no Anki collection/);

  const junk = await zipUp(folder, { 'collection.anki21': Buffer.from('not a database at all, sorry') });
  await assert.rejects(readApkg(junk, 'x.apkg', NOW), (e: Error) => e instanceof AnkiFileError && /couldn’t be read/.test(e.message));
  assert.ok(!(await fs.readdir(folder)).some((name) => name.endsWith('.tmp')));

  dummyDb(path.join(folder, 'empty'));
  const empty = new sqlite.DatabaseSync(path.join(folder, 'empty'));
  empty.exec('DELETE FROM cards');
  empty.close();
  const noCards = await zipUp(folder, { 'collection.anki21': await fs.readFile(path.join(folder, 'empty')) });
  await assert.rejects(readApkg(noCards, 'x.apkg', NOW), /no cards/);
  await fs.rm(folder, { recursive: true });
});

test('a note field comes out as plain text', () => {
  assert.equal(plainField('<div>One<br>two</div><style>.x{}</style>'), 'One two');
  assert.equal(plainField('{{c1::A::hint}} and {{c2::B}}'), '[A] and [B]');
  assert.equal(plainField('a &lt; b &amp;&amp; c &gt; d'), 'a < b && c > d');
  assert.equal(plainField('x'.repeat(900)).length, 500);
});

test('deck rows from a real read include parents', async () => {
  const folder = await makeFolder();
  legacyDb(path.join(folder, 'db'));
  const data = await readApkg(await zipUp(folder, { 'collection.anki21': await fs.readFile(path.join(folder, 'db')) }), 'x.apkg', NOW);
  const rows = deckRows(data, emptyMap());
  assert.deepEqual(rows.map((r) => [r.name, r.depth, r.cards]), [['PA', 0, 4], ['PA::Cardiology', 1, 2], ['PA::Pharm', 1, 2]]);
  assert.equal(rows[1].match, 'Cardiovascular');
  assert.equal(rows[2].match, null);
  await fs.rm(folder, { recursive: true });
});
