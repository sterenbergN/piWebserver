import test, { after, before } from 'node:test';
import { strict as assert } from 'node:assert';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { bookPath, readLibrary } from './store';
import { addYouTube, listJobs, readJobs, removeJob, retryJob, YouTubeRefused, type YouTubeJob } from './youtube';

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
});

after(async () => {
  process.chdir(original);
  delete process.env.YT_DLP_PATH;
  delete process.env.FFMPEG_PATH;
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
