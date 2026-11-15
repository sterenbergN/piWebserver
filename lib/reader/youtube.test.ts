import test, { after, before } from 'node:test';
import { strict as assert } from 'node:assert';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { BookMeta } from './items';
import { addMadeBook, bookPath, linkBooks, readLibrary, setSeries } from './store';
import { addCombine, addYouTube, listJobs, readJobs, removeJob, retryJob, YouTubeRefused, type YouTubeJob } from './youtube';

// The download worker, end to end, with stand-ins for yt-dlp and ffmpeg (in
// fixtures/) so nothing goes near YouTube.

const USER = 'yt-test';
const original = process.cwd();
const fixtures = path.join(original, 'lib', 'reader', 'fixtures');
let dir = '';

before(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'reader-youtube-'));
  process.chdir(dir);
  process.env.YT_DLP_PATH = path.join(fixtures, 'fake-yt-dlp.mjs');
  process.env.FFMPEG_PATH = path.join(fixtures, 'fake-ffmpeg.mjs');
  process.env.FAKE_TOOLS_LOG = path.join(dir, 'tools.log');
});

/** What the stand-ins were asked since the last look. */
async function toolsAsked() {
  const log = await fs.readFile(path.join(dir, 'tools.log'), 'utf8').catch(() => '');
  await fs.rm(path.join(dir, 'tools.log'), { force: true });
  return log.split('\n').filter(Boolean);
}

after(async () => {
  process.chdir(original);
  delete process.env.YT_DLP_PATH;
  delete process.env.FFMPEG_PATH;
  delete process.env.FAKE_TOOLS_LOG;
  await fs.rm(dir, { recursive: true, force: true });
});

/** Wait until nothing is waiting or working. */
async function settled() {
  for (let i = 0; i < 200; i++) {
    const jobs = await readJobs(USER);
    if (jobs.length && jobs.every((j) => j.status === 'done' || j.status === 'failed')) return jobs;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error('The downloads never finished');
}

test('a video becomes an audio book on the shelf, with its chapters', async () => {
  const job = await addYouTube(USER, 'https://youtu.be/ccccccccccc?t=10');
  assert.equal(job.url, 'https://www.youtube.com/watch?v=ccccccccccc');
  await assert.rejects(addYouTube(USER, 'https://youtu.be/ccccccccccc'), YouTubeRefused, 'not twice while on its way');
  const [done] = await settled();
  assert.equal(done.status, 'done', done.problem);
  const library = await readLibrary(USER);
  const book = library.books.find((b) => b.id === done.bookId)!;
  assert.equal(book.format, 'audio');
  assert.equal(book.title, 'Video ccccccccccc');
  assert.equal(book.author, 'A channel');
  assert.deepEqual(book.audio, { duration: 125, chapters: [{ start: 0, title: 'Start' }, { start: 60, title: 'Middle' }] });
  assert.equal(book.link, 'https://www.youtube.com/watch?v=ccccccccccc');
  assert.equal((await fs.stat(bookPath(USER, book))).size, 1000);
  assert.equal(book.size, 1000);
  // Leftovers are cleaned up.
  assert.deepEqual(await fs.readdir(path.join(dir, '.data', 'reader-books', USER, 'incoming-audio')), []);
  const asked = await toolsAsked();
  assert.ok(asked.some((line) => line.startsWith('ffmpeg') && line.includes('-c:a copy')), 'AAC is copied, not re-encoded');
});

test('a book too long to fit is fetched smaller and made to fit, not skipped', async () => {
  await addYouTube(USER, 'https://www.youtube.com/watch?v=LONGLONGLON');
  const job = (await settled()).find((j) => j.url.includes('LONGLONGLON'))!;
  assert.equal(job.status, 'done', job.problem);
  const asked = await toolsAsked();
  const download = asked.find((line) => line.startsWith('yt-dlp') && line.includes('-o'))!;
  assert.match(download, /-f 250\//, 'the smallest sound that’s still good enough, not the 1.6 GB one');
  assert.match(download, /--max-filesize 3221225472/);
  assert.ok(asked.some((line) => line.startsWith('ffmpeg') && line.includes('-c:a aac -b:a 64k -ar 44100')), asked.join('\n'));
});

test('a download yt-dlp skips for its size is said plainly', async () => {
  await addYouTube(USER, 'https://www.youtube.com/watch?v=TOOBIGTOOBI');
  const job = (await settled()).find((j) => j.url.includes('TOOBIGTOOBI'))!;
  assert.equal(job.status, 'failed');
  assert.equal(job.problem, 'That video’s sound is too big to save here.');
  await removeJob(USER, job.id);
});

test('a playlist asked for as one book is joined, a chapter for each video', async () => {
  const before = await readLibrary(USER);
  await addYouTube(USER, 'https://www.youtube.com/playlist?list=PLonebook01', undefined, true);
  const jobs = await settled();
  const join = jobs.find((j) => j.kind === 'join')!;
  assert.equal(join.status, 'done', join.problem);
  assert.ok(!jobs.some((j) => j.group === join.group && j.kind === 'video'), 'its videos leave the list');
  const library = await readLibrary(USER);
  assert.equal(library.books.length, before.books.length + 1, 'one book, not two');
  assert.equal(library.folders.length, before.folders.length, 'and no folder for it');
  const book = library.books.find((b) => b.id === join.bookId)!;
  assert.equal(book.title, 'Lecture series');
  assert.equal(book.link, 'https://www.youtube.com/playlist?list=PLonebook01');
  // Each video is 125.5 s by ffmpeg's measure, with its own two chapters.
  assert.deepEqual(book.audio, { duration: 251, chapters: [{ start: 0, title: 'Start' }, { start: 60, title: 'Middle' }, { start: 125.5, title: 'Start' }, { start: 185.5, title: 'Middle' }] });
  assert.equal((await fs.stat(bookPath(USER, book))).size, 2000);
  assert.deepEqual(await fs.readdir(path.join(dir, '.data', 'reader-books', USER, 'incoming-audio')), []);
  assert.ok((await toolsAsked()).some((line) => line.includes('-f concat') && line.includes('-c:a copy')));
  await removeJob(USER, join.id);
});

test('a join waits for a video that failed, and can go ahead without it', async () => {
  await addYouTube(USER, 'https://www.youtube.com/playlist?list=PLwithbadone1', undefined, true);
  const join = (await settled()).find((j) => j.kind === 'join' && j.status === 'failed')!;
  assert.equal(join.missing, 1);
  assert.match(join.problem ?? '', /1 of its 2 videos didn’t download/);
  await retryJob(USER, join.id, true);
  const done = (await settled()).find((j) => j.id === join.id)!;
  assert.equal(done.status, 'done', done.problem);
  const book = (await readLibrary(USER)).books.find((b) => b.id === done.bookId)!;
  assert.equal(book.audio?.duration, 125.5);
  await toolsAsked();
});

test('audio books on the shelf are joined into one, which takes the first one’s place', async () => {
  const shelve = async (book: BookMeta, bytes: Buffer) => {
    const file = path.join(dir, `${book.id}.tmp`);
    await fs.writeFile(file, bytes);
    await addMadeBook(USER, file, book, null);
  };
  const part = (id: string, title: string): BookMeta => ({ id, title, author: 'Someone', format: 'audio', size: 300, addedAt: new Date().toISOString(), hasCover: false, audio: { duration: 125, chapters: [] } });
  await shelve(part('part-one', 'A Tale, part 1'), Buffer.alloc(300, 1));
  await shelve(part('part-two', 'A Tale, part 2'), Buffer.alloc(300, 2));
  await shelve({ id: 'the-epub', title: 'A Tale', author: 'Someone', format: 'epub', size: 3, addedAt: new Date().toISOString(), hasCover: false }, Buffer.from('PK!'));
  await linkBooks(USER, ['the-epub', 'part-one']);
  await setSeries(USER, ['the-epub'], 'Tales');

  await assert.rejects(addCombine(USER, ['part-one'], 'x', true), YouTubeRefused, 'one book isn’t a join');
  await assert.rejects(addCombine(USER, ['part-one', 'the-epub'], 'x', true), YouTubeRefused, 'only audio');
  const job = await addCombine(USER, ['part-one', 'part-two'], '  A Tale (audio) ', true);
  const done = (await settled()).find((j) => j.id === job.id)!;
  assert.equal(done.status, 'done', done.problem);
  const library = await readLibrary(USER);
  assert.ok(!library.books.some((b) => b.id === 'part-one' || b.id === 'part-two'), 'the parts are gone');
  const book = library.books.find((b) => b.id === done.bookId)!;
  assert.equal(book.title, 'A Tale (audio)');
  assert.deepEqual(book.audio, { duration: 251, chapters: [{ start: 0, title: 'A Tale, part 1' }, { start: 125.5, title: 'A Tale, part 2' }] });
  assert.equal(book.size, 600);
  // part-one was the audio of the EPUB, in a series: the joined book is now.
  const epub = library.books.find((b) => b.id === 'the-epub')!;
  assert.ok(epub.work && epub.work === book.work);
  assert.equal(book.series, 'Tales');
  assert.equal(book.seriesIndex, epub.seriesIndex);
});

test('a playlist becomes a folder, one book per video', async () => {
  await addYouTube(USER, 'https://www.youtube.com/playlist?list=PLlectures1');
  const jobs = await settled();
  const fromList = jobs.filter((j) => j.title?.startsWith('Video aaaa') || j.title?.startsWith('Video bbbb'));
  assert.equal(fromList.length, 2);
  assert.ok(fromList.every((j) => j.status === 'done'), JSON.stringify(fromList));
  const library = await readLibrary(USER);
  const folder = library.folders.find((f) => f.name === 'Lecture series')!;
  assert.ok(folder);
  assert.equal(library.books.filter((b) => b.folder === folder.id).length, 2);
});

test('a failure says why, can be tried again, and can be removed', async () => {
  await addYouTube(USER, 'https://www.youtube.com/watch?v=BADBADBAD00');
  const failed = (await settled()).find((j) => j.url.includes('BADBADBAD00')) as YouTubeJob;
  assert.equal(failed.status, 'failed');
  assert.equal(failed.problem, 'That video isn’t available.');
  await retryJob(USER, failed.id);
  const again = (await settled()).find((j) => j.id === failed.id)!;
  assert.equal(again.status, 'failed');
  await removeJob(USER, failed.id);
  assert.ok(!(await listJobs(USER)).some((j) => j.id === failed.id));
});

test('a missing yt-dlp is said plainly', async () => {
  process.env.YT_DLP_PATH = path.join(dir, 'no-such-yt-dlp');
  try {
    await addYouTube(USER, 'https://www.youtube.com/watch?v=ddddddddddd');
    const job = (await settled()).find((j) => j.url.includes('ddddddddddd'))!;
    assert.equal(job.status, 'failed');
    assert.match(job.problem ?? '', /needs yt-dlp on the Pi/);
  } finally {
    process.env.YT_DLP_PATH = path.join(fixtures, 'fake-yt-dlp.mjs');
  }
});

test('links that aren’t YouTube are refused before anything runs', async () => {
  await assert.rejects(addYouTube(USER, 'https://evil.example/watch?v=ccccccccccc'), YouTubeRefused);
  await assert.rejects(addYouTube(USER, 'https://www.youtube.com/watch?v=-o/etc/x'), YouTubeRefused);
});
