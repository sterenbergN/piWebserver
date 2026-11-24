import test from 'node:test';
import { strict as assert } from 'node:assert';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { buildIco, conversionById, conversionsFor, ConvertError, csvToJson, jsonToCsv, kindOf, parseCsv, parsePageRanges, renamed, uniqueNames } from './formats';
import { createConvertJobs, piCommand, type Runner } from './pi-jobs';

test('file kinds come from the extension, then the type', () => {
  assert.equal(kindOf('IMG_0001.HEIC'), 'heic');
  assert.equal(kindOf('Week 3.pptx'), 'slides');
  assert.equal(kindOf('notes.docx'), 'doc');
  assert.equal(kindOf('clip.MOV'), 'video');
  assert.equal(kindOf('blob', 'image/png'), 'image');
  assert.equal(kindOf('mystery.xyz'), 'other');
});

test('only conversions that take every chosen file are offered', () => {
  const ids = (kinds: Parameters<typeof conversionsFor>[0]) => conversionsFor(kinds).map((c) => c.id);
  assert.ok(ids(['image']).includes('img-jpeg'));
  assert.ok(ids(['image', 'pdf']).includes('to-pdf'));
  assert.ok(!ids(['image', 'pdf']).includes('img-jpeg'));
  assert.deepEqual(ids(['slides']), ['office-pdf', 'slides-pptx', 'zip']);
  assert.ok(ids(['video']).includes('av-mp3') && ids(['video']).includes('video-gif'));
  assert.deepEqual(ids([]), []);
});

test('page ranges read the way people write them', () => {
  assert.deepEqual(parsePageRanges('', 3), [0, 1, 2]);
  assert.deepEqual(parsePageRanges('1-3, 5', 6), [0, 1, 2, 4]);
  assert.deepEqual(parsePageRanges('4-', 6), [3, 4, 5]);
  assert.deepEqual(parsePageRanges('3-1', 5), [2, 1, 0]);
  assert.deepEqual(parsePageRanges('2 to 3', 5), [1, 2]);
  assert.throws(() => parsePageRanges('7', 5), ConvertError);
  assert.throws(() => parsePageRanges('a-b', 5), /isn’t a page/);
});

test('CSV and JSON convert both ways, quotes and all', () => {
  const csv = 'name,note\r\n"Smith, Jo","said ""hi""\nthen left"\r\nAl,\r\n';
  assert.deepEqual(parseCsv(csv), [['name', 'note'], ['Smith, Jo', 'said "hi"\nthen left'], ['Al', '']]);
  const json = csvToJson(csv);
  assert.deepEqual(JSON.parse(json), [{ name: 'Smith, Jo', note: 'said "hi"\nthen left' }, { name: 'Al', note: '' }]);
  const back = jsonToCsv(json);
  assert.deepEqual(parseCsv(back), parseCsv(csv));
  assert.equal(jsonToCsv('[{"a":1,"b":{"c":2}},{"a":3,"d":true}]'), 'a,b,d\r\n1,"{""c"":2}",\r\n3,,true');
  assert.throws(() => jsonToCsv('[1, 2]'), /list of objects/);
  assert.throws(() => jsonToCsv('{nope'), /valid JSON/);
});

test('.ico files carry each PNG with its size and offset', () => {
  const a = new Uint8Array([1, 2, 3]);
  const b = new Uint8Array([4, 5]);
  const ico = buildIco([{ size: 16, png: a }, { size: 256, png: b }]);
  const view = new DataView(ico.buffer);
  assert.equal(view.getUint16(2, true), 1);
  assert.equal(view.getUint16(4, true), 2);
  assert.equal(ico[6], 16);
  assert.equal(ico[22], 0); // 256 is written as 0
  assert.equal(view.getUint32(6 + 12, true), 38);
  assert.deepEqual([...ico.slice(38, 41)], [1, 2, 3]);
  assert.deepEqual([...ico.slice(41)], [4, 5]);
});

test('output names are safe and never collide', () => {
  assert.equal(renamed('Lecture 4: Heart.pptx', 'pdf'), 'Lecture 4_ Heart.pdf');
  assert.equal(renamed('scan.pdf', 'jpg', '-page2'), 'scan-page2.jpg');
  assert.deepEqual(uniqueNames(['a.jpg', 'b.jpg', 'A.jpg', 'a.jpg']), ['a.jpg', 'b.jpg', 'A (2).jpg', 'a (3).jpg']);
});

test('Pi commands: ffmpeg only reads local files, LibreOffice gets its own profile and filter', () => {
  const mp3 = piCommand(conversionById('av-mp3')!, '/tmp/j/input.mov', '/tmp/j', '/tmp/lo');
  assert.equal(mp3.output, path.join('/tmp/j', 'output.mp3'));
  assert.deepEqual(mp3.args.slice(0, 6), ['-hide_banner', '-nostdin', '-y', '-protocol_whitelist', 'file,pipe', '-i']);
  assert.ok(mp3.args.includes('libmp3lame'));
  const pdf = piCommand(conversionById('office-pdf')!, '/tmp/j/input.pptx', '/tmp/j', '/tmp/lo');
  assert.ok(pdf.args.includes('--headless'));
  assert.ok(pdf.args.includes('-env:UserInstallation=file:///tmp/lo'));
  assert.equal(pdf.args[pdf.args.indexOf('--convert-to') + 1], 'pdf');
  assert.equal(pdf.output, path.join('/tmp/j', 'out', 'input.pdf'));
  const csv = piCommand(conversionById('sheet-csv')!, '/tmp/j/input.xlsx', '/tmp/j', '/tmp/lo');
  assert.match(csv.args[csv.args.indexOf('--convert-to') + 1], /^csv:.*:44,34,76,1$/);
});

/** Wait (up to 2 s) for something that happens in the background, like a folder being deleted. */
async function eventually(check: () => Promise<boolean> | boolean) {
  for (let i = 0; i < 200; i++) {
    if (await check()) return true;
    await new Promise((r) => setTimeout(r, 10));
  }
  return false;
}

async function settle(jobs: ReturnType<typeof createConvertJobs>, owner: string, id: string) {
  for (let i = 0; i < 200; i++) {
    const job = jobs.get(owner, id);
    if (job && (job.status === 'done' || job.status === 'error')) return job;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error('job never finished');
}

test('Pi jobs: run one at a time, hand back the file, then clean up', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'convert-test-'));
  try {
    let running = 0;
    let most = 0;
    const seen: string[][] = [];
    // A stand-in for ffmpeg: writes the output file it was given.
    const runner: Runner = async (_cmd, args) => {
      running++;
      most = Math.max(most, running);
      seen.push(args);
      await new Promise((r) => setTimeout(r, 10));
      await fs.writeFile(args[args.length - 1], 'mp3 data');
      running--;
    };
    let t = 0;
    const jobs = createConvertJobs({ root, runner, keepMs: 1000, now: () => t });
    const mp3 = conversionById('av-mp3')!;
    const a = await jobs.start('user:a', mp3, 'Lecture "one".m4a', new Uint8Array([1, 2, 3]));
    const b = await jobs.start('user:a', mp3, 'two.m4a', new Uint8Array([4]));
    assert.equal(b.status, 'queued');
    const done = await settle(jobs, 'user:a', a.id);
    await settle(jobs, 'user:a', b.id);
    assert.equal(most, 1);
    assert.equal(done.outName, 'Lecture _one_.mp3');
    // The original name never reaches the command line.
    assert.ok(seen.every((args) => !args.some((x) => x.includes('Lecture'))));
    const file = jobs.result('user:a', a.id)!;
    assert.equal(await fs.readFile(file.path, 'utf8'), 'mp3 data');
    assert.equal(jobs.result('user:b', a.id), null);
    assert.equal(jobs.get('user:b', a.id), null);
    // The upload is gone once converted; the result goes after a while.
    assert.deepEqual((await fs.readdir(path.dirname(file.path))).sort(), ['output.mp3']);
    t = 5000;
    jobs.get('user:a', a.id);
    assert.equal(jobs.get('user:a', a.id), null);
    assert.ok(await eventually(() => fs.stat(file.path).then(() => false, () => true)), 'the result was deleted');
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('Pi jobs: failures and missing tools come back as short messages; limits hold', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'convert-test-'));
  try {
    const missing = Object.assign(new Error('spawn soffice ENOENT'), { code: 'ENOENT' });
    const jobs = createConvertJobs({ root, runner: async (cmd) => { if (cmd.includes('soffice')) throw missing; throw new Error('exit 1'); } });
    const office = await jobs.start('user:a', conversionById('office-pdf')!, 'deck.pptx', new Uint8Array([1]));
    assert.match((await settle(jobs, 'user:a', office.id)).error!, /LibreOffice isn’t installed/);
    const av = await jobs.start('user:a', conversionById('av-mp3')!, 'song.wav', new Uint8Array([1]));
    assert.match((await settle(jobs, 'user:a', av.id)).error!, /couldn’t convert song\.wav/);
    await assert.rejects(jobs.start('user:a', conversionById('img-jpeg')!, 'a.png', new Uint8Array([1])), /browser/);

    const slow = createConvertJobs({ root, runner: (_c, _a, _t, signal) => new Promise((_r, reject) => signal.addEventListener('abort', () => reject(new Error('stopped')))) });
    const mp3 = conversionById('av-mp3')!;
    const first = await slow.start('user:c', mp3, '1.wav', new Uint8Array([1]));
    await slow.start('user:c', mp3, '2.wav', new Uint8Array([1]));
    await slow.start('user:c', mp3, '3.wav', new Uint8Array([1]));
    await assert.rejects(slow.start('user:c', mp3, '4.wav', new Uint8Array([1])), /3 files converting/);
    await slow.remove('user:c', first.id);
    assert.ok(await eventually(() => slow.get('user:c', first.id) === null), 'the stopped job was forgotten');
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
