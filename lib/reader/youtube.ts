import { spawn } from 'child_process';
import crypto from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import sharp from 'sharp';
import { readJson, updateJson } from '@/lib/json-store';
import {
  chooseFormat, encodeKbps, joinChapters, MAX_AUDIO_SECONDS, MAX_PLAYLIST, playlistEntries, readFfmpegProgress, readProgressLine, readSoundInfo, readYouTubeLink, videoDetails,
  type AudioChapter, type AudioInfo, type SoundInfo, type VideoDetails,
} from './audio';
import { cleanTitle, MAX_BOOK_BYTES, isId, type BookMeta } from './items';
import { addFolder, addMadeBook, assertRoom, bookFolder, bookPath, coverPath, readerFolder, readLibrary, removeBook } from './store';

// Audio books from YouTube, made on the Pi: yt-dlp fetches a video's audio and
// ffmpeg tidies it into an .m4a that starts playing before it's all downloaded
// (its index goes at the front), then it joins the shelf like any other book.
// A playlist is a folder of books, or (when it's one book split into a video per
// chapter) a single book with a chapter for each video. Audio books already on
// the shelf can be joined the same way. One job at a time for the whole site, so
// the Pi keeps up. Each account's list of jobs is a file, so a restart picks up
// where it was.
//
// yt-dlp and ffmpeg are found on the PATH, or at YT_DLP_PATH and FFMPEG_PATH.
// A path ending in .js or .mjs is run with Node (the tests use that).

export type JobStatus = 'waiting' | 'working' | 'done' | 'failed';
/** `join` puts a playlist's videos together once they're down; `combine` does the same to books on the shelf. */
export type JobKind = 'video' | 'playlist' | 'join' | 'combine';
export type YouTubeJob = {
  id: string;
  /** The tidied link: a video, or a playlist still to be opened up into videos. Empty for `combine`. */
  url: string;
  kind: JobKind;
  status: JobStatus;
  title?: string;
  /** 0–1 while downloading, converting or joining. */
  fraction?: number;
  step?: 'looking' | 'downloading' | 'converting' | 'finishing' | 'joining';
  problem?: string;
  folder?: string;
  bookId?: string;
  /** A playlist asked for as one book. */
  joined?: boolean;
  /** What ties a book's parts (videos) to the job that joins them. */
  group?: string;
  /** What's joined, in order: the parts' jobs (`join`) or books on the shelf (`combine`). */
  parts?: string[];
  /** How many parts a join is still missing, when that's why it stopped. */
  missing?: number;
  /** Join what's there, without the parts that didn't download. */
  skipMissing?: boolean;
  /** Take the separate books off the shelf once they're combined. */
  removeParts?: boolean;
  createdAt: number;
  updatedAt: number;
};
type JobsFile = { jobs: YouTubeJob[] };

/** Finished and failed jobs stay on the list this long. */
const KEEP_MS = 3 * 24 * 3600 * 1000;
/** A step that prints nothing for this long has hung. */
const QUIET_LIMIT_MS = 3 * 60 * 1000;
const MAX_JOBS = 300;
/** The most a download may be before it's made smaller. Thirty hours of the best sound YouTube has is about 2 GB. */
const DOWNLOAD_CAP_BYTES = 3 * 1024 * 1024 * 1024;
const MAX_COMBINE = 200;

export class YouTubeRefused extends Error {}

const jobsPath = (userId: string) => path.join(readerFolder(userId), 'youtube.json');
const workFolder = (userId: string) => path.join(bookFolder(userId), 'incoming-audio');
const groupFolder = (userId: string, group: string) => path.join(workFolder(userId), `group-${group}`);
const newId = () => crypto.randomBytes(9).toString('base64url');
const exists = (file: string) => fs.stat(file).then(() => true, () => false);

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

const busy = (job: YouTubeJob) => job.status === 'waiting' || job.status === 'working';

// ── The queue ────────────────────────────────────────────────────────────────

type Work = { queue: { userId: string; jobId: string }[]; running: string | null };
// On globalThis so a code reload in development doesn't start a second worker.
const shared = globalThis as typeof globalThis & { __readerYouTube?: Work };
const work = (shared.__readerYouTube ??= { queue: [], running: null });
const keyOf = (userId: string, jobId: string) => `${userId}/${jobId}`;
const queued = (userId: string, jobId: string) => work.running === keyOf(userId, jobId) || work.queue.some((q) => q.userId === userId && q.jobId === jobId);

function enqueue(userId: string, jobId: string) {
  if (queued(userId, jobId)) return;
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

/**
 * Add a link: one video, or every video in a playlist. A playlist goes into a new folder, a
 * book for each video, unless `joined` asks for one book with a chapter for each.
 */
export async function addYouTube(userId: string, rawUrl: unknown, folder?: unknown, joined = false) {
  const link = readYouTubeLink(rawUrl);
  if (!link) throw new YouTubeRefused('That isn’t a YouTube video or playlist link.');
  const jobs = await readJobs(userId);
  if (jobs.filter(busy).length >= MAX_JOBS) throw new YouTubeRefused('There are a lot of downloads waiting already. Let some finish first.');
  if (jobs.some((j) => j.url === link.url && busy(j))) throw new YouTubeRefused('That one is already on its way.');
  const library = await readLibrary(userId);
  const id = newId();
  const now = Date.now();
  const job: YouTubeJob = {
    id, url: link.url, kind: link.kind, status: 'waiting', createdAt: now, updatedAt: now,
    ...(isId(folder) && library.folders.some((f) => f.id === folder) ? { folder } : {}),
    ...(link.kind === 'playlist' && joined ? { joined: true } : {}),
  };
  await updateJobs(userId, (list) => { list.push(job); });
  enqueue(userId, id);
  return job;
}

/** Join audio books already on the shelf into one, in the order given, a chapter for each. */
export async function addCombine(userId: string, bookIds: unknown, rawTitle: unknown, removeParts: boolean) {
  if (!Array.isArray(bookIds) || bookIds.length > MAX_COMBINE || !bookIds.every(isId)) throw new YouTubeRefused('Which audio books?');
  const ids = [...new Set(bookIds as string[])];
  const library = await readLibrary(userId);
  const books = ids.map((id) => library.books.find((b) => b.id === id));
  if (ids.length < 2 || books.some((b) => !b)) throw new YouTubeRefused('Pick two or more audio books to join.');
  if (books.some((b) => b!.format !== 'audio')) throw new YouTubeRefused('Only audio books can be joined.');
  if (books.reduce((sum, b) => sum + (b!.audio?.duration ?? 0), 0) > MAX_AUDIO_SECONDS) throw new YouTubeRefused(`Together they’re over ${MAX_AUDIO_SECONDS / 3600} hours long.`);
  const jobs = await readJobs(userId);
  if (jobs.some((j) => j.kind === 'combine' && busy(j) && j.parts?.some((id) => ids.includes(id)))) throw new YouTubeRefused('One of those is being joined already.');
  const now = Date.now();
  const job: YouTubeJob = { id: newId(), url: '', kind: 'combine', status: 'waiting', title: cleanTitle(rawTitle, books[0]!.title), parts: ids, removeParts, createdAt: now, updatedAt: now };
  await updateJobs(userId, (list) => { list.push(job); });
  enqueue(userId, job.id);
  return job;
}

/** Try a failed one again. A join can be told to go ahead without the videos that didn't download. */
export async function retryJob(userId: string, id: unknown, skipMissing = false) {
  const ok = await updateJobs(userId, (jobs) => {
    const job = jobs.find((j) => j.id === id && j.status === 'failed');
    if (!job) return false;
    Object.assign(job, { status: 'waiting', problem: undefined, fraction: undefined, step: undefined, missing: undefined, updatedAt: Date.now() });
    if (skipMissing && job.kind === 'join') job.skipMissing = true;
    return true;
  });
  if (ok) enqueue(userId, id as string);
}

/**
 * Take one off the list. One that's working right now finishes first, then is forgotten.
 * A join takes its videos with it, and what was downloaded for them.
 */
export async function removeJob(userId: string, id: unknown) {
  const removed = await updateJobs(userId, (jobs) => {
    const i = jobs.findIndex((j) => j.id === id);
    if (i < 0 || jobs[i].status === 'working') return null;
    const [job] = jobs.splice(i, 1);
    const gone = [job.id];
    if (job.kind === 'join' && job.group) {
      for (let at = jobs.length - 1; at >= 0; at--) {
        if (jobs[at].group === job.group && jobs[at].status !== 'working') gone.push(...jobs.splice(at, 1).map((j) => j.id));
      }
    }
    return { job, gone };
  });
  if (!removed) return;
  work.queue = work.queue.filter((q) => !(q.userId === userId && removed.gone.includes(q.jobId)));
  if (removed.job.kind === 'join' && removed.job.group) await fs.rm(groupFolder(userId, removed.job.group), { recursive: true, force: true }).catch(() => {});
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
  if (!work.running) await clearOrphans(userId, jobs);
  return readJobs(userId);
}

/** Parts downloaded for a join that's no longer on the list. */
async function clearOrphans(userId: string, jobs: YouTubeJob[]) {
  const wanted = new Set(jobs.flatMap((j) => (j.kind === 'join' && j.group ? [`group-${j.group}`] : [])));
  for (const name of await fs.readdir(workFolder(userId)).catch(() => [] as string[])) {
    if (name.startsWith('group-') && !wanted.has(name)) await fs.rm(path.join(workFolder(userId), name), { recursive: true, force: true }).catch(() => {});
  }
}

// ── Running the tools ────────────────────────────────────────────────────────

type Tool = 'yt-dlp' | 'ffmpeg';

function toolCommand(tool: Tool): [string, string[]] {
  const configured = process.env[tool === 'yt-dlp' ? 'YT_DLP_PATH' : 'FFMPEG_PATH']?.trim();
  if (configured && /\.m?js$/.test(configured)) return [process.execPath, [configured]];
  return [configured || tool, []];
}

const MISSING: Record<Tool, string> = {
  'yt-dlp': 'Saving audio from YouTube needs yt-dlp on the Pi. The README says how to install it.',
  ffmpeg: 'Audio books need ffmpeg on the Pi. Install it with: sudo apt install ffmpeg',
};

/** Run a tool, feeding each output line to `onLine`; resolves with what it printed to stdout. Gives up if it goes quiet. */
function run(tool: Tool, args: string[], onLine?: (line: string) => void): Promise<string> {
  const [command, prefix] = toolCommand(tool);
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
      if (!onLine) {
        if (out.length < 20_000_000) out += textChunk;
        return;
      }
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
  if (/sign in to confirm you.re not a bot|HTTP Error 403|nsig|Unable to extract|Requested format is not available/i.test(line)) return `YouTube turned yt-dlp away. Updating it on the Pi usually fixes this (yt-dlp -U). ${line.slice(0, 160)}`;
  return `${tool} failed${line ? `: ${line.replace(/^ERROR:\s*/i, '').slice(0, 240)}` : '.'}`;
}

/**
 * ffmpeg, reporting how far through `duration` seconds of sound it is. It always prints its
 * progress, so a long conversion isn't taken for one that's hung.
 */
function ffmpeg(userId: string, jobId: string, args: string[], duration: number) {
  let last = 0;
  return run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y', '-progress', 'pipe:1', '-nostats', ...args], (line) => {
    const at = readFfmpegProgress(line);
    if (at === null || !duration) return;
    const fraction = Math.min(1, at / duration);
    // A save every 2 % is plenty for a progress bar.
    if (fraction - last >= 0.02) { last = fraction; void patchJob(userId, jobId, { fraction }).catch(() => {}); }
  });
}

/** What ffmpeg makes of a file's sound, or null if it can't say. Asking with no output is an "error" that prints it. */
function probe(file: string): Promise<SoundInfo | null> {
  const [command, prefix] = toolCommand('ffmpeg');
  return new Promise((resolve) => {
    const child = spawn(command, [...prefix, '-hide_banner', '-nostdin', '-i', file], { stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    const giveUp = setTimeout(() => child.kill('SIGKILL'), 60_000);
    child.stderr.on('data', (chunk: Buffer) => { err = (err + chunk.toString()).slice(-20_000); });
    child.on('error', () => { clearTimeout(giveUp); resolve(null); });
    child.on('close', () => { clearTimeout(giveUp); resolve(readSoundInfo(err)); });
  });
}

/** Sound that isn't kept as it is becomes AAC, which every iPhone plays, at one sample rate so books can be joined. */
const encodeArgs = (duration: number) => ['-c:a', 'aac', '-b:a', `${encodeKbps(duration, MAX_BOOK_BYTES)}k`, '-ar', '44100'];

function checkedSize(size: number) {
  if (size > MAX_BOOK_BYTES) throw new Error('That came out over the 1 GB limit.');
  return size;
}

// ── Doing one ────────────────────────────────────────────────────────────────

async function runJob(userId: string, jobId: string) {
  const job = (await readJobs(userId)).find((j) => j.id === jobId);
  if (!job || job.status === 'done' || job.status === 'failed') return;
  await patchJob(userId, jobId, { status: 'working', step: 'looking', problem: undefined, missing: undefined });
  if (job.kind === 'playlist') return openPlaylist(userId, job);
  if (job.kind === 'join') return joinVideos(userId, job);
  if (job.kind === 'combine') return combineBooks(userId, job);
  return saveVideo(userId, job);
}

async function saveVideo(userId: string, job: YouTubeJob) {
  const info: unknown = JSON.parse(await run('yt-dlp', ['-J', '--no-playlist', '--no-warnings', '--', job.url]));
  const details = videoDetails(info);
  await patchJob(userId, job.id, { title: details.title, step: 'downloading', fraction: 0 });

  const dir = path.join(workFolder(userId), job.id);
  await fs.rm(dir, { recursive: true, force: true });
  await fs.mkdir(dir, { recursive: true });
  try {
    // Room for the download and the tidied copy beside it, at the most sound YouTube sends (about 160 kbit/s).
    await assertRoom(dir, Math.min(2 * MAX_BOOK_BYTES, details.duration * 20_000 * 2));
    let last = 0;
    let overCap = false;
    let said = '';
    await run('yt-dlp', [
      '-f', chooseFormat(info, details.duration, MAX_BOOK_BYTES),
      '--no-playlist', '--no-warnings', '--newline', '--no-mtime',
      // yt-dlp skips a file over this without calling it an error, so that's looked for below.
      '--max-filesize', String(DOWNLOAD_CAP_BYTES),
      '--progress-template', 'download:dl %(progress.downloaded_bytes)s %(progress.total_bytes)s %(progress.total_bytes_estimate)s',
      '-o', path.join(dir, 'source.%(ext)s'),
      '--', details.url,
    ], (line) => {
      const fraction = readProgressLine(line);
      if (fraction === null) {
        if (/larger than max-filesize/i.test(line)) overCap = true;
        if (line.trim()) said = line.trim();
      // A save every 5 % is plenty for a progress bar.
      } else if (fraction - last >= 0.05) { last = fraction; void patchJob(userId, job.id, { fraction }).catch(() => {}); }
    });
    const source = (await fs.readdir(dir)).find((name) => name.startsWith('source.') && !name.endsWith('.part') && !name.endsWith('.ytdl'));
    if (!source) throw new Error(overCap ? 'That video’s sound is too big to save here.' : `yt-dlp finished without saving any sound${said ? `: ${said.slice(0, 200)}` : '.'}`);

    // AAC that fits is copied as it is. Anything else (Opus, or a book too long to fit) becomes AAC.
    const out = path.join(dir, 'book.m4a');
    const from = path.join(dir, source);
    const keep = /\.(m4a|mp4|aac)$/i.test(source) && (await fs.stat(from)).size <= MAX_BOOK_BYTES;
    await patchJob(userId, job.id, keep ? { step: 'finishing', fraction: undefined } : { step: 'converting', fraction: 0 });
    await ffmpeg(userId, job.id, ['-i', from, '-vn', '-map_metadata', '-1', ...(keep ? ['-c:a', 'copy'] : encodeArgs(details.duration)), '-movflags', '+faststart', out], keep ? 0 : details.duration);
    const size = checkedSize((await fs.stat(out)).size);

    if (job.group) {
      // One part of a book: kept aside until the rest are down. Unless the book was called off meanwhile.
      if (!(await readJobs(userId)).some((j) => j.kind === 'join' && j.group === job.group)) {
        await updateJobs(userId, (list) => {
          const at = list.findIndex((j) => j.id === job.id);
          if (at >= 0) list.splice(at, 1);
        });
        return;
      }
      const group = groupFolder(userId, job.group);
      await fs.mkdir(group, { recursive: true });
      await fs.rename(out, path.join(group, `${job.id}.m4a`));
      await fs.writeFile(path.join(group, `${job.id}.json`), JSON.stringify(details));
      await patchJob(userId, job.id, { status: 'done', step: undefined, fraction: undefined });
      await wakeJoin(userId, job.group);
      return;
    }
    const cover = details.thumbnail ? await coverFrom(details.thumbnail) : null;
    const book = bookFor(details, newId(), size, !!cover, job.folder);
    await addMadeBook(userId, out, book, cover);
    await patchJob(userId, job.id, { status: 'done', bookId: book.id, step: undefined, fraction: undefined });
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

/** A playlist becomes a folder named after it and a download for each video, or one book made of them all. */
async function openPlaylist(userId: string, job: YouTubeJob) {
  const list = playlistEntries(JSON.parse(await run('yt-dlp', ['-J', '--flat-playlist', '--no-warnings', '--', job.url])));
  if (!list.videos.length) throw new Error('That playlist has no videos that can be saved.');
  const now = Date.now();
  const group = job.joined ? newId() : undefined;
  const folder = job.folder ?? (group ? undefined : (await addFolder(userId, list.title)).id);
  const videos: YouTubeJob[] = list.videos.map((v, i) => ({
    id: newId(), url: `https://www.youtube.com/watch?v=${v.id}`, kind: 'video', status: 'waiting', ...(v.title ? { title: v.title } : {}),
    ...(group ? { group } : { folder }), createdAt: now + i, updatedAt: now + i,
  }));
  const after = now + videos.length;
  const join: YouTubeJob[] = group
    ? [{ id: newId(), url: job.url, kind: 'join', status: 'waiting', title: list.title, group, parts: videos.map((v) => v.id), ...(folder ? { folder } : {}), createdAt: after, updatedAt: after }]
    : [];
  await updateJobs(userId, (jobs) => {
    const at = jobs.findIndex((j) => j.id === job.id);
    if (at >= 0) jobs.splice(at, 1, ...videos, ...join);
  });
  for (const v of [...videos, ...join]) enqueue(userId, v.id);
  if (list.videos.length >= MAX_PLAYLIST) console.warn(`YouTube playlist cut to its first ${MAX_PLAYLIST} videos`);
}

// ── Joining ──────────────────────────────────────────────────────────────────

type Part = { file: string; title: string; duration: number; chapters: AudioChapter[] };

/**
 * Several audio files end to end as one, with a chapter for each. They're copied as they are
 * when they're the same kind of sound and fit; otherwise the whole is re-encoded to fit.
 */
async function joinFiles(userId: string, jobId: string, parts: Part[], dir: string, out: string): Promise<{ size: number; audio: AudioInfo }> {
  const infos: (SoundInfo | null)[] = [];
  for (const part of parts) infos.push(await probe(part.file));
  // The length ffmpeg measures, where it can: a video's own is rounded to the second, and that adds up over many chapters.
  const audio = joinChapters(parts.map((part, i) => ({ title: part.title, chapters: part.chapters, duration: infos[i]?.duration ?? part.duration })));
  if (audio.duration > MAX_AUDIO_SECONDS) throw new Error(`Together they’re over ${MAX_AUDIO_SECONDS / 3600} hours long.`);
  let total = 0;
  for (const part of parts) total += (await fs.stat(part.file)).size;
  await assertRoom(dir, total);

  const known = infos.filter((info): info is SoundInfo => !!info);
  const alike = known.every((info) => /^aac/.test(info.codec) && info.codec === known[0].codec && info.rate === known[0].rate && info.channels === known[0].channels);
  const copy = alike && total <= MAX_BOOK_BYTES * 0.98;
  const list = path.join(dir, 'parts.txt');
  await fs.writeFile(list, parts.map((part) => `file '${part.file.replace(/\\/g, '/').replace(/'/g, "'\\''")}'`).join('\n'));
  await patchJob(userId, jobId, { step: 'joining', fraction: 0 });
  await ffmpeg(userId, jobId, ['-f', 'concat', '-safe', '0', '-i', list, '-vn', '-map_metadata', '-1', ...(copy ? ['-c:a', 'copy'] : [...encodeArgs(audio.duration), '-ac', '2']), '-movflags', '+faststart', out], audio.duration);
  return { size: checkedSize((await fs.stat(out)).size), audio };
}

/** A playlist's videos, once they're down, as one book with a chapter for each. */
async function joinVideos(userId: string, job: YouTubeJob) {
  const group = job.group ?? '';
  const dir = groupFolder(userId, group);
  const jobs = await readJobs(userId);
  const parts: (Part & { details: VideoDetails })[] = [];
  let missing = 0;
  let stillComing = false;
  for (const id of job.parts ?? []) {
    const file = path.join(dir, `${id}.m4a`);
    const details = await readJson<VideoDetails | null>(path.join(dir, `${id}.json`), null);
    const partJob = jobs.find((j) => j.id === id);
    if (details && (await exists(file))) parts.push({ file, title: details.title, duration: details.duration, chapters: details.chapters, details });
    else if (partJob && busy(partJob) && queued(userId, id)) stillComing = true;
    // One taken off the list by hand is left out without a word.
    else if (partJob) missing += 1;
  }
  if (stillComing) {
    // A video being tried again: wait behind it.
    await patchJob(userId, job.id, { status: 'waiting', step: undefined });
    work.queue.push({ userId, jobId: job.id });
    return;
  }
  if (missing && !job.skipMissing) {
    await patchJob(userId, job.id, { missing });
    throw new Error(`${missing} of its ${job.parts?.length ?? missing} videos didn’t download. Try them again, or join it without them.`);
  }
  if (!parts.length) throw new Error('None of its videos downloaded.');

  const out = path.join(dir, 'joined.m4a');
  const made = await joinFiles(userId, job.id, parts, dir, out);
  const first = parts[0].details;
  const cover = first.thumbnail ? await coverFrom(first.thumbnail) : null;
  const book: BookMeta = {
    id: newId(), title: job.title || first.title, author: first.author, format: 'audio', size: made.size, addedAt: new Date().toISOString(), hasCover: !!cover,
    audio: made.audio, link: job.url, ...(job.folder ? { folder: job.folder } : {}),
  };
  await addMadeBook(userId, out, book, cover);
  // Its videos have done their part.
  await updateJobs(userId, (list) => {
    for (let at = list.length - 1; at >= 0; at--) if (list[at].group === group && list[at].kind === 'video') list.splice(at, 1);
    const held = list.find((j) => j.id === job.id);
    if (held) Object.assign(held, { status: 'done', bookId: book.id, step: undefined, fraction: undefined, updatedAt: Date.now() });
  });
  await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
}

/** A video of a join came down: if the join had stopped for want of it and nothing else is on its way, try the join again. */
async function wakeJoin(userId: string, group: string) {
  const jobs = await readJobs(userId);
  const join = jobs.find((j) => j.kind === 'join' && j.group === group);
  if (!join || join.status !== 'failed' || jobs.some((j) => j.group === group && j.kind === 'video' && busy(j))) return;
  await retryJob(userId, join.id);
}

/** Audio books on the shelf, joined into a new one. */
async function combineBooks(userId: string, job: YouTubeJob) {
  const library = await readLibrary(userId);
  const books = (job.parts ?? []).flatMap((id) => library.books.filter((b) => b.id === id && b.format === 'audio'));
  if (books.length < 2) throw new Error('Those audio books aren’t on the shelf any more.');
  const dir = path.join(workFolder(userId), job.id);
  await fs.rm(dir, { recursive: true, force: true });
  await fs.mkdir(dir, { recursive: true });
  try {
    const out = path.join(dir, 'joined.m4a');
    const parts = books.map((b) => ({ file: bookPath(userId, b), title: b.title, duration: b.audio?.duration ?? 0, chapters: b.audio?.chapters ?? [] }));
    const made = await joinFiles(userId, job.id, parts, dir, out);
    const first = books[0];
    const cover = first.hasCover ? await fs.readFile(coverPath(userId, first.id)).catch(() => null) : null;
    const book: BookMeta = {
      id: newId(), title: job.title || first.title, author: first.author, format: 'audio', size: made.size, addedAt: new Date().toISOString(), hasCover: !!cover,
      audio: made.audio,
      ...(first.link ? { link: first.link } : {}),
      ...(first.folder ? { folder: first.folder } : {}),
      // It takes the first one's place: in its series, and beside the book it's the audio of.
      ...(job.removeParts && first.series ? { series: first.series, seriesIndex: first.seriesIndex } : {}),
      ...(job.removeParts && first.work ? { work: first.work } : {}),
    };
    await addMadeBook(userId, out, book, cover);
    if (job.removeParts) for (const b of books) await removeBook(userId, b.id);
    await patchJob(userId, job.id, { status: 'done', bookId: book.id, step: undefined, fraction: undefined });
  } finally {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
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
