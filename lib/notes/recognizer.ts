import crypto from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import sharp from 'sharp';
import { findLines, lineSvg, type InkLine, type InkStroke } from './handwriting';

// Reading handwriting on the server, with Microsoft's TrOCR model (the small one trained on
// handwritten lines), run by ONNX Runtime. Nothing leaves the Pi. The model is fetched once, from
// a fixed version whose files are checked against known hashes, and kept in .cache, which
// survives updates. It's loaded when first needed and let go of after a while unused, since it
// takes a few hundred MB of memory. One line is read at a time, so the site stays quick while it works.

const REPO = 'Xenova/trocr-small-handwritten';
const REVISION = '02bea33ca09a70e2e2d91140a7e6e1a729606a5b';
const FILES: Record<string, string | null> = {
  'onnx/encoder_model_quantized.onnx': '2f29edbd925f8a49c9c7d1349895f960cf09d2efdc76fe23f957048d476e0d03',
  'onnx/decoder_model_quantized.onnx': '40166e4f975b3cecd24bb422db80eb06912777c8e8a56ab44f6bd771ec5df553',
  'tokenizer.json': null,
};
const IMAGE_SIZE = 384;
const DECODER_START = 2;
const END = 2;
const SPECIAL = new Set([0, 1, 2, 3]);
const MAX_TOKENS = 64;
const IDLE_MS = 10 * 60 * 1000;

type Ort = typeof import('onnxruntime-node');
type Loaded = { ort: Ort; encoder: import('onnxruntime-node').InferenceSession; decoder: import('onnxruntime-node').InferenceSession; pieces: string[] };

export type ReaderState = 'idle' | 'downloading' | 'ready' | 'unavailable';

export const modelFolder = () => path.join(process.cwd(), '.cache', 'notes-handwriting', REVISION.slice(0, 7));

let state: ReaderState = 'idle';
let problem = '';
let loading: Promise<Loaded> | null = null;
let idleTimer: ReturnType<typeof setTimeout> | null = null;
let queue: Promise<unknown> = Promise.resolve();

export const readerStatus = () => ({ state, problem });

async function sha256(file: string) {
  return crypto.createHash('sha256').update(await fs.readFile(file)).digest('hex');
}

/** The model's files, fetched if they aren't here, and refused if they aren't exactly the expected ones. */
async function ensureFiles() {
  const folder = modelFolder();
  for (const [name, hash] of Object.entries(FILES)) {
    const target = path.join(folder, name);
    if (await fs.stat(target).then((s) => s.size > 0, () => false)) continue;
    state = 'downloading';
    await fs.mkdir(path.dirname(target), { recursive: true });
    const res = await fetch(`https://huggingface.co/${REPO}/resolve/${REVISION}/${name}`);
    if (!res.ok) throw new Error(`The handwriting model wouldn't download (${res.status}).`);
    const temp = `${target}.download`;
    await fs.writeFile(temp, Buffer.from(await res.arrayBuffer()));
    if (hash && (await sha256(temp)) !== hash) {
      await fs.rm(temp, { force: true });
      throw new Error('The handwriting model that downloaded isn’t the expected one, so it wasn’t used.');
    }
    await fs.rename(temp, target);
  }
  return folder;
}

function load() {
  if (!loading) {
    loading = (async () => {
      const folder = await ensureFiles();
      const ort = await import('onnxruntime-node');
      // Two threads: enough to be quick, and leaves the Pi's other cores for the site.
      const options = { intraOpNumThreads: 2, interOpNumThreads: 1, graphOptimizationLevel: 'all' as const };
      const encoder = await ort.InferenceSession.create(path.join(folder, 'onnx/encoder_model_quantized.onnx'), options);
      const decoder = await ort.InferenceSession.create(path.join(folder, 'onnx/decoder_model_quantized.onnx'), options);
      const tokenizer = JSON.parse(await fs.readFile(path.join(folder, 'tokenizer.json'), 'utf-8')) as { model: { vocab: [string, number][] } };
      state = 'ready';
      problem = '';
      return { ort, encoder, decoder, pieces: tokenizer.model.vocab.map(([piece]) => piece) };
    })().catch((error) => {
      loading = null;
      state = 'unavailable';
      problem = error instanceof Error ? error.message : 'The handwriting model wouldn’t load.';
      throw error;
    });
  }
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(release, IDLE_MS);
  idleTimer.unref?.();
  return loading;
}

async function release() {
  const held = loading;
  loading = null;
  if (!held) return;
  const model = await held.catch(() => null);
  await model?.encoder.release();
  await model?.decoder.release();
  if (state === 'ready') state = 'idle';
}

/** A picture of writing as the numbers the model reads: 384 × 384, three channels, from −1 to 1. */
async function pixels(svg: string) {
  const raw = await sharp(Buffer.from(svg)).flatten({ background: '#ffffff' }).resize(IMAGE_SIZE, IMAGE_SIZE, { fit: 'fill', kernel: 'cubic' }).removeAlpha().raw().toBuffer();
  const plane = IMAGE_SIZE * IMAGE_SIZE;
  const out = new Float32Array(plane * 3);
  for (let i = 0; i < plane; i++) {
    for (let c = 0; c < 3; c++) out[c * plane + i] = raw[i * 3 + c] / 127.5 - 1;
  }
  return out;
}

async function readPicture(model: Loaded, svg: string) {
  const { ort, encoder, decoder, pieces } = model;
  const input = new ort.Tensor('float32', await pixels(svg), [1, 3, IMAGE_SIZE, IMAGE_SIZE]);
  const encoded = (await encoder.run({ pixel_values: input })).last_hidden_state;
  const ids = [DECODER_START];
  for (let step = 0; step < MAX_TOKENS; step++) {
    const tokens = new ort.Tensor('int64', BigInt64Array.from(ids.map(BigInt)), [1, ids.length]);
    const { logits } = await decoder.run({ input_ids: tokens, encoder_hidden_states: encoded }, ['logits']);
    const vocab = logits.dims[2];
    const data = logits.data as Float32Array;
    const offset = (ids.length - 1) * vocab;
    let best = 0;
    for (let i = 1; i < vocab; i++) if (data[offset + i] > data[offset + best]) best = i;
    if (best === END) break;
    ids.push(best);
    // A model shown a scrap it can't read can say the same thing over and over. Stop it.
    if (repeating(ids)) break;
  }
  return tidyReading(ids.filter((id) => !SPECIAL.has(id)).map((id) => pieces[id] ?? '').join('').replace(/▁/g, ' '));
}

/** Whether the last tokens are one short run said again and again. */
function repeating(ids: number[]) {
  for (const size of [1, 2, 3]) {
    const times = size === 1 ? 5 : 4;
    if (ids.length < size * times + 1) continue;
    const tail = ids.slice(-size);
    let repeats = 1;
    while (repeats < times && ids.slice(-size * (repeats + 1), -size * repeats).every((id, i) => id === tail[i])) repeats += 1;
    if (repeats >= times) return true;
  }
  return false;
}

/** What came back is writing, not noise: it has letters, and isn't one thing over and over. */
export function tidyReading(text: string) {
  const cleaned = text.replace(/(.{1,3}?)\1{3,}/g, '').replace(/\s+/g, ' ').trim();
  const letters = (cleaned.match(/[\p{L}\p{N}]/gu) ?? []).length;
  // At least one real word: "C5" is writing, a stray "0 0" isn't.
  if (!/[\p{L}\p{N}]{2,}/u.test(cleaned) || letters / cleaned.length < 0.5) return '';
  return cleaned;
}

/**
 * Read pieces of writing, one at a time behind anything already waiting. `urgent` goes ahead
 * of background work: someone is waiting for it with the lasso.
 */
export function readLines(strokes: InkStroke[], lines: InkLine[], urgent = false): Promise<string[]> {
  const work = async () => {
    const model = await load();
    const out: string[] = [];
    for (const line of lines) out.push(await readPicture(model, lineSvg(strokes, line)));
    return out;
  };
  if (urgent) return work();
  const run = queue.then(work, work);
  queue = run.catch(() => {});
  return run;
}

/** Everything written in some strokes, as text, a line at a time. */
export async function readStrokes(strokes: InkStroke[], urgent = false) {
  const lines = findLines(strokes);
  const texts = await readLines(strokes, lines, urgent);
  return lines.map((line, i) => ({ text: texts[i], box: line.box, ids: line.ids })).filter((line) => line.text);
}
