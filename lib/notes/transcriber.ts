import { spawn } from 'child_process';
import fs from 'fs/promises';
import path from 'path';
import { ensureModelFiles } from './model-files';
import { logMel, loudness, N_FRAMES, N_MELS, pieces, repeatedTail, SAMPLE_RATE, tidySpeech, tokensToText } from './speech';

// Turning a recording into text on the Pi, with OpenAI's Whisper (base, English), run by ONNX
// Runtime like the handwriting model. Nothing leaves the Pi. ffmpeg turns the recording (AAC
// from an iPad, Opus from Chrome) into plain 16 kHz sound, a piece at a time, so a long
// lecture never has to fit in memory. The model hears 30 seconds at a time and writes what
// was said; each piece keeps when it started, so the text can jump to that point.

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

const START = 50257;
const END = 50256;
const NO_SPEECH = 50361;
const NO_TIMESTAMPS = 50362;
/** Room for what's said in 30 seconds, even quickly, inside the model's 448. */
const MAX_TOKENS = 220;
const HEADS = 8;
const HEAD_SIZE = 64;
const IDLE_MS = 10 * 60 * 1000;
/** Quieter than this all through is silence: Whisper makes things up when given silence. */
const SILENT = 0.0025;

type Ort = typeof import('onnxruntime-node');
type Session = import('onnxruntime-node').InferenceSession;
type Tensor = import('onnxruntime-node').Tensor;
type Loaded = { ort: Ort; encoder: Session; decoder: Session; pieces: string[]; allowed: Uint8Array; firstAllowed: Uint8Array };

export type SpeechSegment = { start: number; end: number; text: string };

export class TranscribeProblem extends Error {}

export const speechModelFolder = () => path.join(process.cwd(), '.cache', 'notes-transcribe', REVISION.slice(0, 7));

let loading: Promise<Loaded> | null = null;
let idleTimer: ReturnType<typeof setTimeout> | null = null;

function load() {
  if (!loading) {
    loading = (async () => {
      const folder = await ensureModelFiles(REPO, REVISION, FILES, speechModelFolder(), 'speech');
      const ort = await import('onnxruntime-node');
      // Three of the Pi's four cores: it's a long job, and the site keeps the fourth.
      const options = { intraOpNumThreads: 3, interOpNumThreads: 1, graphOptimizationLevel: 'all' as const };
      const encoder = await ort.InferenceSession.create(path.join(folder, 'onnx/encoder_model.onnx'), options);
      const decoder = await ort.InferenceSession.create(path.join(folder, 'onnx/decoder_model_merged_quantized.onnx'), options);
      const tokenizer = JSON.parse(await fs.readFile(path.join(folder, 'tokenizer.json'), 'utf-8')) as { model: { vocab: Record<string, number> }; added_tokens: { id: number; content: string }[] };
      const generation = JSON.parse(await fs.readFile(path.join(folder, 'generation_config.json'), 'utf-8')) as { suppress_tokens: number[]; begin_suppress_tokens: number[] };
      const size = Math.max(...Object.values(tokenizer.model.vocab), ...tokenizer.added_tokens.map((t) => t.id)) + 1;
      const pieces: string[] = new Array(size).fill('');
      for (const [piece, id] of Object.entries(tokenizer.model.vocab)) pieces[id] = piece;
      // Words and the end; none of the model's own markers, and none of the noises it was told not to write.
      const allowed = new Uint8Array(size);
      for (let id = 0; id < START; id++) allowed[id] = 1;
      for (const id of generation.suppress_tokens) if (id < size) allowed[id] = 0;
      const firstAllowed = allowed.slice();
      for (const id of generation.begin_suppress_tokens) if (id < size) firstAllowed[id] = 0;
      return { ort, encoder, decoder, pieces, allowed, firstAllowed };
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

async function release() {
  const held = loading;
  loading = null;
  const model = await held?.catch(() => null);
  await model?.encoder.release();
  await model?.decoder.release();
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

function emptyPast(ort: Ort) {
  return new ort.Tensor('float32', new Float32Array(0), [1, HEADS, 0, HEAD_SIZE]);
}

/** The best word the model allows, and how sure it was (as a log probability). */
function pick(logits: Float32Array, offset: number, size: number, allowed: Uint8Array) {
  let best = -1;
  let top = -Infinity;
  for (let id = 0; id < size; id++) {
    if (!allowed[id]) continue;
    const value = logits[offset + id];
    if (value > top) { top = value; best = id; }
  }
  let sum = 0;
  for (let id = 0; id < size; id++) if (allowed[id]) sum += Math.exp(logits[offset + id] - top);
  return { id: best, logprob: -Math.log(sum) };
}

/** How likely the model thinks it is that nobody is speaking, read where it's first asked. */
function noSpeechChance(logits: Float32Array, size: number) {
  let top = -Infinity;
  for (let id = 0; id < size; id++) top = Math.max(top, logits[id]);
  let sum = 0;
  for (let id = 0; id < size; id++) sum += Math.exp(logits[id] - top);
  return Math.exp(logits[NO_SPEECH] - top) / sum;
}

/** What was said in up to 30 seconds of sound, or '' if nothing was. */
async function listen(model: Loaded, samples: Float32Array) {
  if (loudness(samples) < SILENT) return '';
  const { ort, encoder, decoder, pieces, allowed, firstAllowed } = model;
  const features = new ort.Tensor('float32', logMel(samples), [1, N_MELS, N_FRAMES]);
  const encoded = (await encoder.run({ input_features: features }, ['last_hidden_state'])).last_hidden_state;
  const presentNames = decoder.outputNames.filter((name) => name.startsWith('present.'));

  let past: Record<string, Tensor> = {};
  for (const name of decoder.inputNames) if (name.startsWith('past_key_values.')) past[name] = emptyPast(ort);
  let input = [START, NO_TIMESTAMPS];
  const ids: number[] = [];
  let logprobs = 0;
  let noSpeech = 0;
  for (let step = 0; step < MAX_TOKENS; step++) {
    const feeds: Record<string, Tensor> = {
      input_ids: new ort.Tensor('int64', BigInt64Array.from(input.map(BigInt)), [1, input.length]),
      encoder_hidden_states: encoded,
      use_cache_branch: new ort.Tensor('bool', [step > 0], [1]),
      ...past,
    };
    const out = await decoder.run(feeds, ['logits', ...presentNames]);
    const logits = out.logits.data as Float32Array;
    const size = out.logits.dims[2];
    if (step === 0) noSpeech = noSpeechChance(logits, size);
    const next = pick(logits, (input.length - 1) * size, size, step === 0 ? firstAllowed : allowed);
    // What the model worked out about the sound is made once, on the first step; after that
    // only its memory of the words so far grows (the later "encoder" outputs are empty).
    const nextPast: Record<string, Tensor> = { ...past };
    for (const name of presentNames) {
      if (step > 0 && name.includes('.encoder.')) continue;
      nextPast[name.replace('present.', 'past_key_values.')] = out[name];
    }
    past = nextPast;
    if (next.id === END || next.id < 0) break;
    ids.push(next.id);
    logprobs += next.logprob;
    input = [next.id];
    const drop = repeatedTail(ids);
    if (drop) { ids.splice(ids.length - drop); break; }
  }
  // Whisper's own test for a piece with nobody speaking: it says so, and isn't sure of what it wrote.
  if (noSpeech > 0.6 && (!ids.length || logprobs / ids.length < -1)) return '';
  return tidySpeech(tokensToText(pieces, ids));
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
