import { spawn } from 'child_process';
import fs from 'fs/promises';
import path from 'path';
import { ensureModelFiles } from './model-files';
import { levelled, logMelYielding, loudness, pieces, SAMPLE_RATE, tidySpeech, tokensToText } from './speech';

// Turning a recording into text on the Pi, with OpenAI's Whisper (base, English), run by ONNX
// Runtime like the handwriting model. Nothing leaves the Pi. ffmpeg turns the recording (AAC
// from an iPad, Opus from Chrome) into plain 16 kHz sound, a piece at a time, so a long
// lecture never has to fit in memory. The model hears 30 seconds at a time and writes what
// was said; each piece keeps when it started, so the text can jump to that point.
//
// The model itself runs in a process of its own (speech-worker.cjs): run here, on the server's
// one thread, it held up every request to the site for seconds at a time while a lecture was
// going, and its memory pushed the site past the limit pm2 restarts it at.

const REPO = 'Xenova/whisper-base.en';
const REVISION = '95bf40a508535962c6483ead40270b2e32267508';
// The encoder at full precision: Whisper's encoder loses words when it's squeezed to 8 bits,
// and the decoder doesn't. The same pairing transformers.js uses.
const FILES: Record<string, string> = {
  'onnx/encoder_model.onnx': '3af4d8b7515f01f1c313afe0d691768ff084169b8e1ec1cb4d975ce2ac465f6e',
  'onnx/decoder_model_merged_quantized.onnx': 'a25afc5858a20aabb7652cb2d555996ebe10691a69bbdb423d5073d52f060325',
  'tokenizer.json': 'c6ee8f089220a5b1188f6426456772572671c6141ae007eecb83c6a8349f5deb',
  'generation_config.json': '1e57ed56ad1bd7f08a49ece7fe7daada674573805a35f8bdbbe68380aab5b1ee',
};
export const SPEECH_MODEL = 'whisper-base.en';

/** Room for what's said in 30 seconds, even quickly, inside the model's 448. */
const MAX_TOKENS = 220;
const IDLE_MS = 10 * 60 * 1000;
/** Quieter than this all through is silence: Whisper makes things up when given silence. */
const SILENT = 0.0025;

type Heard = { ids: number[]; logprobs: number; noSpeech: number };
type Loaded = { pieces: string[]; ask: (features: Float32Array) => Promise<Heard>; stop: () => Promise<void> };

export type SpeechSegment = { start: number; end: number; text: string };

export class TranscribeProblem extends Error {}

export const speechModelFolder = () => path.join(process.cwd(), '.cache', 'notes-transcribe', REVISION.slice(0, 7));
/** Found from where the site runs, the same in development and in a release (next.config.ts copies it). */
export const speechWorkerFile = () => path.join(/*turbopackIgnore: true*/ process.cwd(), 'lib', 'notes', 'speech-worker.cjs');

let loading: Promise<Loaded> | null = null;
let idleTimer: ReturnType<typeof setTimeout> | null = null;

/** Start the worker and wait for it to have the model ready. A worker that dies takes the model with it, and the next piece starts another. */
async function startWorker(folder: string): Promise<Omit<Loaded, 'pieces'>> {
  // "advanced" so the picture of the sound goes across as numbers, not as JSON text.
  // spawn of Node with an "ipc" channel is what fork does; fork itself the release build mistakes
  // for an import of the file, and fails trying to bundle it.
  const worker = spawn(process.execPath, [speechWorkerFile()], { serialization: 'advanced', stdio: ['ignore', 'inherit', 'inherit', 'ipc'] });
  let next = 0;
  const waiting = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();
  const failAll = (error: Error) => {
    for (const w of waiting.values()) w.reject(error);
    waiting.clear();
    if (loading) loading = null;
  };
  worker.on('message', (raw) => {
    const m = raw as { id: number; ok: boolean; result?: unknown; error?: string };
    const w = waiting.get(m.id);
    if (!w) return;
    waiting.delete(m.id);
    if (m.ok) w.resolve(m.result);
    else w.reject(new Error(m.error ?? 'The speech model failed.'));
  });
  worker.on('error', (error) => failAll(error instanceof Error ? error : new Error(String(error))));
  worker.on('exit', (code) => {
    failAll(new Error(`The speech model stopped (${code ?? 'killed'}).`));
  });
  // It doesn't keep the site running on its own.
  worker.unref();
  worker.channel?.unref();
  const send = <T>(message: Record<string, unknown>) => new Promise<T>((resolve, reject) => {
    const id = ++next;
    waiting.set(id, { resolve: resolve as (value: unknown) => void, reject });
    worker.send({ ...message, id }, (error) => { if (error) { waiting.delete(id); reject(error); } });
  });
  try {
    await send({ type: 'load', folder });
  } catch (error) {
    worker.kill();
    throw error;
  }
  return {
    ask: (features) => send<Heard>({ type: 'listen', features, maxTokens: MAX_TOKENS }),
    stop: async () => { worker.kill(); },
  };
}

function load() {
  if (!loading) {
    loading = (async () => {
      const folder = await ensureModelFiles(REPO, REVISION, FILES, speechModelFolder(), 'speech');
      const tokenizer = JSON.parse(await fs.readFile(path.join(folder, 'tokenizer.json'), 'utf-8')) as { model: { vocab: Record<string, number> }; added_tokens: { id: number; content: string }[] };
      const size = Math.max(...Object.values(tokenizer.model.vocab), ...tokenizer.added_tokens.map((t) => t.id)) + 1;
      const pieces: string[] = new Array(size).fill('');
      for (const [piece, id] of Object.entries(tokenizer.model.vocab)) pieces[id] = piece;
      return { pieces, ...(await startWorker(folder)) };
    })().catch((error) => {
      loading = null;
      throw error;
    });
  }
  holdModel();
  return loading;
}

function holdModel() {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(release, IDLE_MS);
  idleTimer.unref?.();
}

/** Ten minutes with nothing to hear: the worker goes, and its memory with it. */
async function release() {
  const held = loading;
  loading = null;
  const model = await held?.catch(() => null);
  await model?.stop();
}

// ── The sound ────────────────────────────────────────────────────────────────

/**
 * A recording as 16 kHz mono sound, from `fromMs` on, in pieces as ffmpeg makes them. ffmpeg
 * waits while a piece is being listened to, so it never runs ahead.
 */
export async function* decodeAudio(file: string, fromMs = 0): AsyncGenerator<Float32Array> {
  const args = ['-nostdin', '-hide_banner', '-loglevel', 'error'];
  if (fromMs > 0) args.push('-ss', (fromMs / 1000).toFixed(3));
  args.push('-i', file, '-vn', '-ac', '1', '-ar', String(SAMPLE_RATE), '-f', 's16le', 'pipe:1');
  const child = spawn(process.env.FFMPEG_PATH || 'ffmpeg', args, { stdio: ['ignore', 'pipe', 'pipe'] });
  let errors = '';
  child.stderr.on('data', (chunk: Buffer) => { errors = (errors + chunk.toString()).slice(-2000); });
  const exited = new Promise<number | null>((resolve, reject) => {
    child.on('error', (error: NodeJS.ErrnoException) => reject(
      error.code === 'ENOENT'
        ? new TranscribeProblem('Turning recordings into text needs ffmpeg on the Pi. Install it with: sudo apt install ffmpeg')
        : error,
    ));
    child.on('close', resolve);
  });
  exited.catch(() => {});
  try {
    let carry: Buffer | null = null;
    for await (const raw of child.stdout as AsyncIterable<Buffer>) {
      const chunk: Buffer = carry ? Buffer.concat([carry, raw]) : raw;
      const whole = chunk.length - (chunk.length % 2);
      carry = whole < chunk.length ? chunk.subarray(whole) : null;
      const out = new Float32Array(whole / 2);
      for (let i = 0; i < out.length; i++) out[i] = chunk.readInt16LE(i * 2) / 32768;
      yield out;
    }
    const code = await exited;
    if (code !== 0) throw new TranscribeProblem(`The recording couldn’t be read${errors.trim() ? `: ${errors.trim().split('\n').at(-1)}` : '.'}`);
  } finally {
    if (child.exitCode === null) child.kill();
  }
}

// ── Listening ────────────────────────────────────────────────────────────────

/** What was said in up to 30 seconds of sound, or '' if nothing was. */
async function listen(model: Loaded, samples: Float32Array) {
  const loud = loudness(samples);
  if (loud < SILENT) return '';
  // A quiet recording is turned up first: the model mishears speech that's far below the level it learned at.
  const { ids, logprobs, noSpeech } = await model.ask(await logMelYielding(levelled(samples, loud)));
  // Whisper's own test for a piece with nobody speaking: it says so, and isn't sure of what it wrote.
  if (noSpeech > 0.6 && (!ids.length || logprobs / ids.length < -1)) return '';
  return tidySpeech(tokensToText(model.pieces, ids));
}

/**
 * Write down what's said in a recording, from `fromMs` on. Each piece is handed to `onSegment`
 * as soon as it's heard (times in ms from the recording's start), so a long job keeps what it
 * has if it's stopped. `shouldStop` is asked between pieces.
 */
export function transcribe(file: string, fromMs: number, onSegment: OnSegment, shouldStop: () => boolean = () => false) {
  return transcribeSound(decodeAudio(file, fromMs), fromMs, onSegment, shouldStop);
}

type OnSegment = (segment: SpeechSegment | null, heardTo: number) => Promise<void> | void;

/** The same, from sound already at 16 kHz: what `transcribe` does once ffmpeg has read the file. */
export async function transcribeSound(sound: AsyncIterable<Float32Array>, fromMs: number, onSegment: OnSegment, shouldStop: () => boolean = () => false) {
  const model = await load();
  const offset = Math.round((fromMs / 1000) * SAMPLE_RATE);
  for await (const piece of pieces(sound, offset)) {
    if (shouldStop()) return false;
    holdModel();
    const text = await listen(model, piece.samples);
    const start = Math.round((piece.start / SAMPLE_RATE) * 1000);
    const end = Math.round(((piece.start + piece.samples.length) / SAMPLE_RATE) * 1000);
    await onSegment(text ? { start, end, text } : null, end);
  }
  return true;
}
