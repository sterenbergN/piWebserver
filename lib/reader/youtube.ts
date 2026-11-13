import { spawn } from 'child_process';
import crypto from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import sharp from 'sharp';
import { readJson, updateJson } from '@/lib/json-store';
import { MAX_PLAYLIST, playlistEntries, readProgressLine, readYouTubeLink, videoDetails, type VideoDetails } from './audio';
import { MAX_BOOK_BYTES, isId, type BookMeta } from './items';
import { addFolder, addMadeBook, bookFolder, readerFolder, readLibrary } from './store';

// Audio books from YouTube, made on the Pi: yt-dlp fetches a video's audio and
// ffmpeg tidies it into an .m4a that starts playing before it's all downloaded
// (its index goes at the front), then it joins the shelf like any other book.
// One download at a time for the whole site, so the Pi keeps up. Each account's
// list of downloads is a file, so a restart picks up where it was.
//
// yt-dlp and ffmpeg are found on the PATH, or at YT_DLP_PATH and FFMPEG_PATH.
// A path ending in .js or .mjs is run with Node (the tests use that).

export type JobStatus = 'waiting' | 'working' | 'done' | 'failed';
export type YouTubeJob = {
  id: string;
  /** The tidied link: a video, or a playlist still to be opened up into videos. */
  url: string;
  kind: 'video' | 'playlist';
  status: JobStatus;
  title?: string;
  /** 0–1 while downloading. */
  fraction?: number;
  step?: 'looking' | 'downloading' | 'finishing';
  problem?: string;
  folder?: string;
  bookId?: string;
  createdAt: number;
  updatedAt: number;
};
type JobsFile = { jobs: YouTubeJob[] };

/** Finished and failed downloads stay on the list this long. */
const KEEP_MS = 3 * 24 * 3600 * 1000;
/** A step that prints nothing for this long has hung. */
const QUIET_LIMIT_MS = 3 * 60 * 1000;
const MAX_JOBS = 300;

export class YouTubeRefused extends Error {}

const jobsPath = (userId: string) => path.join(readerFolder(userId), 'youtube.json');
const workFolder = (userId: string) => path.join(bookFolder(userId), 'incoming-audio');
const newId = () => crypto.randomBytes(9).toString('base64url');

export const readJobs = async (userId: string) => (await readJson<Partial<JobsFile>>(jobsPath(userId), {})).jobs ?? [];

function updateJobs<R>(userId: string, mutate: (jobs: YouTubeJob[]) => R) {
  return updateJson<JobsFile, { result: R }>(jobsPath(userId), { jobs: [] }, (file) => {
    file.jobs = (file.jobs ?? []).filter((j) => j.status === 'waiting' || j.status === 'working' || Date.now() - j.updatedAt < KEEP_MS);
    return { result: mutate(file.jobs) };
  }).then((out) => out.result);
}

const patchJob = (userId: string, id: string, patch: Partial<YouTubeJob>) => updateJobs(userId, (jobs) => {
  const job = jobs.find((j) => j.id === id);
  if (job) Object.assign(job, patch, { updatedAt: Date.now() });
});

// ── The queue ────────────────────────────────────────────────────────────────

type Work = { queue: { userId: string; jobId: string }[]; running: string | null };
// On globalThis so a code reload in development doesn't start a second worker.
const shared = globalThis as typeof globalThis & { __readerYouTube?: Work };
const work = (shared.__readerYouTube ??= { queue: [], running: null });
const keyOf = (userId: string, jobId: string) => `${userId}/${jobId}`;

function enqueue(userId: string, jobId: string) {
  const key = keyOf(userId, jobId);
  if (work.running === key || work.queue.some((q) => keyOf(q.userId, q.jobId) === key)) return;
  work.queue.push({ userId, jobId });
  void pump();
}

async function pump() {
  if (work.running) return;
  const next = work.queue.shift();
  if (!next) return;
  work.running = keyOf(next.userId, next.jobId);
  try {
    await runJob(next.userId, next.jobId);
  } catch (error) {
    await patchJob(next.userId, next.jobId, { status: 'failed', problem: error instanceof Error ? error.message : 'That didn’t work.', fraction: undefined, step: undefined }).catch(() => {});
  } finally {
    work.running = null;
    void pump();
  }
}

/** Add a link: one video, or every video in a playlist (into a new folder). */
export async function addYouTube(userId: string, rawUrl: unknown, folder?: unknown) {
  const link = readYouTubeLink(rawUrl);
  if (!link) throw new YouTubeRefused('That isn’t a YouTube video or playlist link.');
  const jobs = await readJobs(userId);
  if (jobs.filter((j) => j.status === 'waiting' || j.status === 'working').length >= MAX_JOBS) throw new YouTubeRefused('There are a lot of downloads waiting already. Let some finish first.');
  if (jobs.some((j) => j.url === link.url && (j.status === 'waiting' || j.status === 'working'))) throw new YouTubeRefused('That one is already on its way.');
  const library = await readLibrary(userId);
  const id = newId();
  const now = Date.now();
  const job: YouTubeJob = {
    id, url: link.url, kind: link.kind, status: 'waiting', createdAt: now, updatedAt: now,
    ...(isId(folder) && library.folders.some((f) => f.id === folder) ? { folder } : {}),
  };
  await updateJobs(userId, (list) => { list.push(job); });
  enqueue(userId, id);
  return job;
}

/** Try a failed one again. */
export async function retryJob(userId: string, id: unknown) {
  const ok = await updateJobs(userId, (jobs) => {
    const job = jobs.find((j) => j.id === id && j.status === 'failed');
    if (!job) return false;
    Object.assign(job, { status: 'waiting', problem: undefined, fraction: undefined, step: undefined, updatedAt: Date.now() });
    return true;
  });
  if (ok) enqueue(userId, id as string);
}

/** Take one off the list. One that's downloading right now finishes first, then is forgotten. */
export async function removeJob(userId: string, id: unknown) {
  work.queue = work.queue.filter((q) => !(q.userId === userId && q.jobId === id));
  await updateJobs(userId, (jobs) => {
    const i = jobs.findIndex((j) => j.id === id);
    if (i >= 0 && jobs[i].status !== 'working') jobs.splice(i, 1);
  });
}

/** The list, after putting anything a restart interrupted back in the queue. */
export async function listJobs(userId: string) {
  const jobs = await readJobs(userId);
  for (const job of jobs) {
    if (job.status === 'waiting' || (job.status === 'working' && work.running !== keyOf(userId, job.id))) {
      if (job.status === 'working') await patchJob(userId, job.id, { status: 'waiting', fraction: undefined, step: undefined });
      enqueue(userId, job.id);
    }
  }
  return readJobs(userId);
}

// ── Doing one ────────────────────────────────────────────────────────────────

function toolCommand(envName: 'YT_DLP_PATH' | 'FFMPEG_PATH', fallback: string): [string, string[]] {
  const configured = process.env[envName]?.trim();
  if (configured && /\.m?js$/.test(configured)) return [process.execPath, [configured]];
  return [configured || fallback, []];
}

const MISSING: Record<string, string> = {
  'yt-dlp': 'Saving audio from YouTube needs yt-dlp on the Pi. The README says how to install it.',
  ffmpeg: 'Saving audio from YouTube needs ffmpeg on the Pi. Install it with: sudo apt install ffmpeg',
};

/** Run a tool, feeding each output line to `onLine`; resolves with what it printed to stdout. Gives up if it goes quiet. */
function run(tool: 'yt-dlp' | 'ffmpeg', args: string[], onLine?: (line: string) => void): Promise<string> {
  const [command, prefix] = toolCommand(tool === 'yt-dlp' ? 'YT_DLP_PATH' : 'FFMPEG_PATH', tool);
  return new Promise((resolve, reject) => {
    const child = spawn(command, [...prefix, ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    let pending = '';
    let quiet: NodeJS.Timeout;
    const wake = () => {
      clearTimeout(quiet);
      quiet = setTimeout(() => { child.kill('SIGKILL'); reject(new Error(`${tool} stopped responding.`)); }, QUIET_LIMIT_MS);
    };
    wake();
    child.stdout.on('data', (chunk: Buffer) => {
      wake();
      const textChunk = chunk.toString();
      if (out.length < 20_000_000) out += textChunk;
      if (!onLine) return;
      pending += textChunk;
      const lines = pending.split(/\r?\n|\r/);
      pending = lines.pop() ?? '';
      lines.forEach(onLine);
    });
    child.stderr.on('data', (chunk: Buffer) => { wake(); err = (err + chunk.toString()).slice(-4000); });
    child.on('error', (error: NodeJS.ErrnoException) => { clearTimeout(quiet); reject(new Error(error.code === 'ENOENT' ? MISSING[tool] : `${tool} couldn’t start: ${error.message}`)); });
    child.on('close', (code) => {
      clearTimeout(quiet);
      if (code === 0) resolve(out);
      else reject(new Error(explain(tool, err)));
    });
  });
}

/** yt-dlp's last error line, in words worth showing. */
function explain(tool: string, stderr: string) {
  const line = stderr.split('\n').map((l) => l.trim()).filter((l) => /error/i.test(l)).pop() ?? stderr.trim().split('\n').pop() ?? '';
  if (/private video|members[- ]only|sign in to confirm your age/i.test(line)) return 'That video can’t be reached without signing in to YouTube.';
  if (/video unavailable|removed|does not exist/i.test(line)) return 'That video isn’t available.';
  if (/sign in to confirm you.re not a bot|HTTP Error 403|nsig|Unable to extract/i.test(line)) return `YouTube turned yt-dlp away. Updating it on the Pi usually fixes this (yt-dlp -U). ${line.slice(0, 160)}`;
  return `${tool} failed${line ? `: ${line.replace(/^ERROR:\s*/i, '').slice(0, 240)}` : '.'}`;
}

async function runJob(userId: string, jobId: string) {
  const job = (await readJobs(userId)).find((j) => j.id === jobId);
  if (!job || job.status === 'done' || job.status === 'failed') return;
  await patchJob(userId, jobId, { status: 'working', step: 'looking', problem: undefined });
  if (job.kind === 'playlist') return openPlaylist(userId, job);

  const details = videoDetails(JSON.parse(await run('yt-dlp', ['-J', '--no-playlist', '--no-warnings', '--', job.url])));
  await patchJob(userId, jobId, { title: details.title, step: 'downloading', fraction: 0 });

  const dir = path.join(workFolder(userId), jobId);
  await fs.rm(dir, { recursive: true, force: true });
  await fs.mkdir(dir, { recursive: true });
  try {
    let last = 0;
    await run('yt-dlp', [
      '-f', 'bestaudio[ext=m4a]/bestaudio[acodec^=mp4a]/bestaudio',
      '--no-playlist', '--no-warnings', '--newline', '--no-mtime',
      '--max-filesize', String(MAX_BOOK_BYTES),
      '--progress-template', 'download:dl %(progress.downloaded_bytes)s %(progress.total_bytes)s %(progress.total_bytes_estimate)s',
      '-o', path.join(dir, 'source.%(ext)s'),
      '--', details.url,
    ], (line) => {
      const fraction = readProgressLine(line);
      // A save every 5 % is plenty for a progress bar.
      if (fraction !== null && fraction - last >= 0.05) { last = fraction; void patchJob(userId, jobId, { fraction }); }
    });
    const source = (await fs.readdir(dir)).find((name) => name.startsWith('source.') && !name.endsWith('.part'));
    if (!source) throw new Error('yt-dlp didn’t leave any audio.');

    await patchJob(userId, jobId, { step: 'finishing', fraction: 1 });
    const out = path.join(dir, 'book.m4a');
    const aac = /\.(m4a|mp4|aac)$/i.test(source);
    // AAC is copied as it is; anything else (Opus) becomes AAC, which every iPhone plays.
    await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', path.join(dir, source), '-vn', '-map_metadata', '-1',
      ...(aac ? ['-c:a', 'copy'] : ['-c:a', 'aac', '-b:a', '96k']), '-movflags', '+faststart', out]);
    const size = (await fs.stat(out)).size;
    if (size > MAX_BOOK_BYTES) throw new Error('That came out over the 1 GB limit.');

    const cover = details.thumbnail ? await coverFrom(details.thumbnail) : null;
    const book = bookFor(details, newId(), size, !!cover, job.folder);
    await addMadeBook(userId, out, book, cover);
    await patchJob(userId, jobId, { status: 'done', bookId: book.id, step: undefined, fraction: undefined });
  } finally {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

export function bookFor(details: VideoDetails, id: string, size: number, hasCover: boolean, folder?: string): BookMeta {
  return {
    id, title: details.title, author: details.author, format: 'audio', size, addedAt: new Date().toISOString(), hasCover,
    audio: { duration: details.duration, chapters: details.chapters }, link: details.url,
    ...(folder ? { folder } : {}),
  };
}

/** A playlist becomes a folder named after it, and a download for each video. */
async function openPlaylist(userId: string, job: YouTubeJob) {
  const list = playlistEntries(JSON.parse(await run('yt-dlp', ['-J', '--flat-playlist', '--no-warnings', '--', job.url])));
  if (!list.videos.length) throw new Error('That playlist has no videos that can be saved.');
  const folder = job.folder ?? (await addFolder(userId, list.title)).id;
  const now = Date.now();
  const videos: YouTubeJob[] = list.videos.map((v, i) => ({
    id: newId(), url: `https://www.youtube.com/watch?v=${v.id}`, kind: 'video', status: 'waiting', ...(v.title ? { title: v.title } : {}), folder, createdAt: now + i, updatedAt: now + i,
  }));
  await updateJobs(userId, (jobs) => {
    const at = jobs.findIndex((j) => j.id === job.id);
    if (at >= 0) jobs.splice(at, 1, ...videos);
  });
  for (const v of videos) enqueue(userId, v.id);
  if (list.videos.length >= MAX_PLAYLIST) console.warn(`YouTube playlist cut to its first ${MAX_PLAYLIST} videos`);
}

/** The video's thumbnail as a square cover, like an album's. Not worth failing over. */
async function coverFrom(url: string) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
    if (!res.ok) return null;
    const bytes = Buffer.from(await res.arrayBuffer());
    return await sharp(bytes).resize(600, 600, { fit: 'cover' }).jpeg({ quality: 82 }).toBuffer();
  } catch {
    return null;
  }
}
