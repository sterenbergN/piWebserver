import { spawn } from 'child_process';
import crypto from 'crypto';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { extensionOf, renamed, type Conversion, type PiTool } from './formats';

// The converter's jobs that run on the Pi: audio and video through ffmpeg, Office
// files through LibreOffice. One at a time (they're heavy for a Pi), each in its
// own folder under the system's temp folder, deleted a while after it finishes.
// The page starts a job and checks on it, since a video can take minutes and
// Cloudflare cuts a request off at 100 seconds. Commands get their arguments as
// a list, never through a shell.

export const PI_MAX_BYTES = 100 * 1024 * 1024;
const KEEP_MS = 30 * 60_000;
const PER_OWNER = 3;

export type JobStatus = 'queued' | 'running' | 'done' | 'error';
export type JobView = { id: string; status: JobStatus; name: string; outName?: string; size?: number; error?: string; ahead?: number };

type Job = {
  id: string;
  owner: string;
  conversion: Conversion;
  name: string;
  dir: string;
  input: string;
  status: JobStatus;
  outPath?: string;
  outName?: string;
  size?: number;
  error?: string;
  finishedAt?: number;
  /** Cancelled while running: its folder goes as soon as the command stops. */
  removed?: boolean;
  controller: AbortController;
};

export const ffmpegPath = () => process.env.FFMPEG_PATH || 'ffmpeg';
export const sofficePath = () => process.env.SOFFICE_PATH || 'soffice';

/** LibreOffice's export filter for each target. */
const OFFICE_FILTER: Record<string, string> = {
  pdf: 'pdf',
  docx: 'docx:MS Word 2007 XML',
  pptx: 'pptx:Impress MS PowerPoint 2007 XML',
  xlsx: 'xlsx:Calc MS Excel 2007 XML',
  // Comma separated, double quotes, UTF-8 (76), first line kept as is.
  csv: 'csv:Text - txt - csv (StarCalc):44,34,76,1',
};

const FFMPEG_ARGS: Record<string, string[]> = {
  'av-mp3': ['-vn', '-c:a', 'libmp3lame', '-q:a', '2'],
  'av-m4a': ['-vn', '-c:a', 'aac', '-b:a', '192k'],
  'av-wav': ['-vn', '-c:a', 'pcm_s16le'],
  'video-mp4': ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart'],
  'video-gif': ['-t', '15', '-vf', 'fps=12,scale=480:-2:flags=lanczos,split[a][b];[a]palettegen[p];[b][p]paletteuse', '-loop', '0'],
};

/** The command for one job: what to run, and where its result lands. */
export function piCommand(conversion: Conversion, input: string, dir: string, profileDir: string): { cmd: string; args: string[]; output: string; timeoutMs: number } {
  const ext = conversion.ext!;
  if (conversion.tool === 'ffmpeg') {
    const extra = FFMPEG_ARGS[conversion.id];
    if (!extra) throw new Error(`No ffmpeg recipe for ${conversion.id}`);
    const output = path.join(dir, `output.${ext}`);
    // Only local files: a crafted media file can't make ffmpeg fetch from the network.
    return { cmd: ffmpegPath(), args: ['-hide_banner', '-nostdin', '-y', '-protocol_whitelist', 'file,pipe', '-i', input, ...extra, output], output, timeoutMs: 20 * 60_000 };
  }
  const filter = OFFICE_FILTER[ext];
  if (!filter) throw new Error(`No LibreOffice filter for ${ext}`);
  const out = path.join(dir, 'out');
  const profile = `file:///${profileDir.replace(/\\/g, '/').replace(/^\/+/, '')}`;
  return {
    cmd: sofficePath(),
    args: [`-env:UserInstallation=${profile}`, '--headless', '--norestore', '--nologo', '--nodefault', '--nolockcheck', '--convert-to', filter, '--outdir', out, input],
    output: path.join(out, `input.${ext}`),
    timeoutMs: 4 * 60_000,
  };
}

export type Runner = (cmd: string, args: string[], timeoutMs: number, signal: AbortSignal) => Promise<void>;

/** Run a command to the end; fail on a bad exit, a time-out or a cancel. Keeps the end of its error output for the log. */
export const runCommand: Runner = (cmd, args, timeoutMs, signal) => new Promise((resolve, reject) => {
  const child = spawn(cmd, args, { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });
  let tail = '';
  child.stderr?.on('data', (chunk: Buffer) => { tail = (tail + chunk.toString()).slice(-800); });
  const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
  const stop = () => child.kill('SIGKILL');
  signal.addEventListener('abort', stop, { once: true });
  child.on('error', (e) => { clearTimeout(timer); reject(e); });
  child.on('close', (code, sig) => {
    clearTimeout(timer);
    signal.removeEventListener('abort', stop);
    if (code === 0) resolve();
    else reject(new Error(sig ? `stopped (${sig})` : `exit ${code}: ${tail.trim().split('\n').slice(-3).join(' | ')}`));
  });
});

/** Whether a tool is installed: it answers its version question within a few seconds. */
export function toolWorks(tool: PiTool, runner: Runner = runCommand): Promise<boolean> {
  const cmd = tool === 'ffmpeg' ? ffmpegPath() : sofficePath();
  return runner(cmd, [tool === 'ffmpeg' ? '-version' : '--version'], 15_000, new AbortController().signal).then(() => true, () => false);
}

type Options = { root?: string; runner?: Runner; keepMs?: number; now?: () => number };

export function createConvertJobs({ root = path.join(os.tmpdir(), 'pi-convert'), runner = runCommand, keepMs = KEEP_MS, now = Date.now }: Options = {}) {
  const jobs = new Map<string, Job>();
  const queue: Job[] = [];
  let busy = false;
  const profileDir = path.join(root, 'libreoffice-profile');

  const view = (job: Job): JobView => ({
    id: job.id, status: job.status, name: job.name, outName: job.outName, size: job.size, error: job.error,
    ...(job.status === 'queued' ? { ahead: queue.indexOf(job) } : {}),
  });

  const forget = async (job: Job) => {
    jobs.delete(job.id);
    await fs.rm(job.dir, { recursive: true, force: true }).catch(() => {});
  };

  const prune = () => {
    const t = now();
    for (const job of jobs.values()) if (job.finishedAt !== undefined && t - job.finishedAt > keepMs) void forget(job);
  };

  const next = async () => {
    if (busy) return;
    const job = queue.shift();
    if (!job) return;
    busy = true;
    job.status = 'running';
    try {
      const { cmd, args, output, timeoutMs } = piCommand(job.conversion, job.input, job.dir, profileDir);
      await runner(cmd, args, timeoutMs, job.controller.signal);
      const stat = await fs.stat(output).catch(() => null);
      if (!stat?.size) throw new Error('no output');
      job.outPath = output;
      job.size = stat.size;
      job.outName = renamed(job.name, job.conversion.ext!);
      job.status = 'done';
    } catch (error) {
      if (!job.controller.signal.aborted) console.warn(`Conversion ${job.conversion.id} failed: ${error instanceof Error ? error.message : error}`);
      job.status = 'error';
      const missing = error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code === 'ENOENT';
      job.error = job.controller.signal.aborted ? 'Stopped.'
        : missing ? `${job.conversion.tool === 'ffmpeg' ? 'ffmpeg' : 'LibreOffice'} isn’t installed on the Pi.`
          : `The Pi couldn’t convert ${job.name}. It may be damaged, or in a form ${job.conversion.tool === 'ffmpeg' ? 'ffmpeg' : 'LibreOffice'} can’t read.`;
    } finally {
      job.finishedAt = now();
      // The upload isn't needed once there's a result (or none).
      await fs.rm(job.input, { force: true }).catch(() => {});
      if (job.removed) await forget(job);
      busy = false;
      void next();
    }
  };

  return {
    /** Queue a file for a Pi conversion. Throws with a short reason when it can't. */
    async start(owner: string, conversion: Conversion, name: string, bytes: Uint8Array): Promise<JobView> {
      prune();
      if (conversion.where !== 'pi' || !conversion.tool) throw new Error('That conversion runs in the browser.');
      if (bytes.length > PI_MAX_BYTES) throw new Error(`Files for the Pi can be up to ${PI_MAX_BYTES / 1024 / 1024} MB.`);
      if ([...jobs.values()].filter((j) => j.owner === owner && (j.status === 'queued' || j.status === 'running')).length >= PER_OWNER) {
        throw new Error(`You have ${PER_OWNER} files converting already. Wait for those first.`);
      }
      const id = crypto.randomUUID();
      const dir = path.join(root, id);
      await fs.mkdir(dir, { recursive: true });
      // A fixed, plain name: the original name never reaches a command line.
      const input = path.join(dir, `input.${extensionOf(name).replace(/[^a-z0-9]/g, '') || 'bin'}`);
      await fs.writeFile(input, bytes);
      const job: Job = { id, owner, conversion, name, dir, input, status: 'queued', controller: new AbortController() };
      jobs.set(id, job);
      queue.push(job);
      void next();
      return view(job);
    },

    get(owner: string, id: string): JobView | null {
      prune();
      const job = jobs.get(id);
      return job && job.owner === owner ? view(job) : null;
    },

    /** The finished file, for download. */
    result(owner: string, id: string): { path: string; name: string; size: number } | null {
      const job = jobs.get(id);
      return job && job.owner === owner && job.status === 'done' && job.outPath ? { path: job.outPath, name: job.outName!, size: job.size! } : null;
    },

    /** Stop a job and delete its files. */
    async remove(owner: string, id: string) {
      const job = jobs.get(id);
      if (!job || job.owner !== owner) return;
      const i = queue.indexOf(job);
      if (i >= 0) queue.splice(i, 1);
      job.controller.abort();
      if (job.status === 'running') job.removed = true;
      else await forget(job);
    },
  };
}
