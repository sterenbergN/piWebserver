import fs from 'fs/promises';
import { readJson, updateJson } from '@/lib/json-store';
import { findRecording, storedFile, transcriptsPath } from './store';
import { SPEECH_MODEL, transcribe, TranscribeProblem, type SpeechSegment } from './transcriber';

// Turning recordings into text is a long job on a Pi (minutes for a lecture), so it runs in the
// background, one recording at a time, and keeps each piece as it's heard. A restart of the
// site picks up where it got to, the next time anyone asks how it's going.

export type TranscriptStatus = 'waiting' | 'working' | 'done' | 'failed';

export type Transcript = {
  id: string;
  file: string;
  status: TranscriptStatus;
  /** How far into the recording it has listened, in ms. */
  heardTo: number;
  duration: number;
  segments: SpeechSegment[];
  problem?: string;
  model: string;
  requestedAt: number;
  updatedAt: number;
  /** When this run began and where it began from, to say how long is left. */
  runStartedAt?: number;
  runFrom?: number;
};

type TranscriptFile = { items: Record<string, Transcript> };
type Job = { userId: string; notebook: string; recording: string };

const keyOf = (job: Job) => `${job.userId}/${job.notebook}/${job.recording}`;

// Kept on globalThis so a code reload in development doesn't start a second worker.
const shared = globalThis as typeof globalThis & { __notesTranscribe?: { queue: Job[]; running: string | null; stop: Set<string> } };
const work = (shared.__notesTranscribe ??= { queue: [], running: null, stop: new Set() });

const readFile = async (userId: string, notebook: string) => ({ items: {}, ...(await readJson<Partial<TranscriptFile>>(transcriptsPath(userId, notebook), {})) }) as TranscriptFile;

/** Change a transcript, but only the one asked for at `requestedAt`: not a newer start-over of it. */
function change(userId: string, notebook: string, id: string, requestedAt: number, edit: (item: Transcript) => void) {
  return updateJson<TranscriptFile>(transcriptsPath(userId, notebook), { items: {} }, (file) => {
    file.items = file.items ?? {};
    const item = file.items[id];
    if (!item || item.requestedAt !== requestedAt) return;
    edit(item);
    item.updatedAt = Date.now();
  });
}

function enqueue(job: Job) {
  const key = keyOf(job);
  // One being stopped to start over goes back in the queue behind itself.
  if ((work.running === key && !work.stop.has(key)) || work.queue.some((queued) => keyOf(queued) === key)) return;
  work.queue.push(job);
  void runQueue();
}

async function runQueue() {
  if (work.running) return;
  while (work.queue.length) {
    const job = work.queue.shift()!;
    work.running = keyOf(job);
    try {
      await runJob(job);
    } catch (error) {
      console.error('Transcribing a recording failed', error);
    } finally {
      work.stop.delete(keyOf(job));
      work.running = null;
    }
  }
}

async function runJob(job: Job) {
  const { userId, notebook, recording } = job;
  const item = (await readFile(userId, notebook)).items[recording];
  if (!item || item.status === 'done' || item.status === 'failed') return;
  const run = item.requestedAt;
  const record = await findRecording(userId, notebook, recording);
  if (!record) {
    await forget(userId, notebook, recording);
    return;
  }
  const path = storedFile(userId, notebook, record.file);
  if (!(await fs.stat(path).catch(() => null))) {
    await change(userId, notebook, recording, run, (t) => { t.status = 'failed'; t.problem = 'The recording isn’t on the Pi yet.'; });
    return;
  }
  const from = item.heardTo;
  await change(userId, notebook, recording, run, (t) => {
    t.status = 'working';
    t.problem = undefined;
    t.runStartedAt = Date.now();
    t.runFrom = from;
  });
  try {
    const finished = await transcribe(path, from, async (segment, heardTo) => {
      await change(userId, notebook, recording, run, (t) => {
        if (segment) t.segments.push(segment);
        t.heardTo = Math.min(heardTo, t.duration || heardTo);
      });
    }, () => work.stop.has(keyOf(job)));
    if (finished) await change(userId, notebook, recording, run, (t) => { t.status = 'done'; t.heardTo = t.duration; });
  } catch (error) {
    const problem = error instanceof TranscribeProblem ? error.message : `Something went wrong turning it into text${error instanceof Error ? `: ${error.message}` : '.'}`;
    await change(userId, notebook, recording, run, (t) => { t.status = 'failed'; t.problem = problem; });
  }
}

/** Start turning a recording into text, or carry on, or (with `again`) start over. */
export async function requestTranscript(userId: string, notebook: string, recording: string, again = false) {
  const record = await findRecording(userId, notebook, recording);
  if (!record) return { gone: true as const };
  if (!(await fs.stat(storedFile(userId, notebook, record.file)).catch(() => null))) return { notHere: true as const };
  const now = Date.now();
  const item = await updateJson<TranscriptFile, Transcript>(transcriptsPath(userId, notebook), { items: {} }, (file) => {
    file.items = file.items ?? {};
    const held = file.items[recording];
    const fresh = !held || again || held.file !== record.file || held.model !== SPEECH_MODEL;
    if (fresh) {
      file.items[recording] = { id: recording, file: record.file, status: 'waiting', heardTo: 0, duration: record.duration, segments: [], model: SPEECH_MODEL, requestedAt: now, updatedAt: now };
    } else if (held.status === 'failed') {
      // Try again from where it stopped.
      held.status = 'waiting';
      held.problem = undefined;
      held.updatedAt = now;
    }
    return file.items[recording];
  });
  stopIfRunning(keyOf({ userId, notebook, recording }), again);
  if (item.status !== 'done') enqueue({ userId, notebook, recording });
  return { transcript: item };
}

/** Anything left waiting or half done when the site last stopped goes back in the queue. */
export async function resumeTranscripts(userId: string, notebook: string) {
  const file = await readFile(userId, notebook);
  for (const item of Object.values(file.items)) {
    if (item.status === 'waiting' || item.status === 'working') enqueue({ userId, notebook, recording: item.id });
  }
  return file;
}

function stopIfRunning(key: string, wanted = true) {
  if (wanted && work.running === key) work.stop.add(key);
}

export async function forget(userId: string, notebook: string, recording: string) {
  stopIfRunning(keyOf({ userId, notebook, recording }));
  work.queue = work.queue.filter((job) => keyOf(job) !== keyOf({ userId, notebook, recording }));
  await updateJson<TranscriptFile>(transcriptsPath(userId, notebook), { items: {} }, (file) => {
    delete file.items?.[recording];
  });
}

/** How long is left, from how quickly this run has gone so far. */
export function timeLeft(item: Transcript, now = Date.now()) {
  if (item.status !== 'working' || !item.runStartedAt || item.runFrom === undefined) return null;
  const heard = item.heardTo - item.runFrom;
  const spent = now - item.runStartedAt;
  if (heard < 20_000 || spent < 5_000) return null;
  return Math.max(0, ((item.duration - item.heardTo) * spent) / heard);
}

/** What a device is told: everything, or for a list, everything but the words. */
export function forDevice(item: Transcript, withText: boolean) {
  const { runStartedAt: _a, runFrom: _b, file: _c, ...rest } = item;
  return { ...rest, left: timeLeft(item), segments: withText ? item.segments : [], words: item.segments.reduce((n, s) => n + s.text.split(' ').length, 0) };
}
