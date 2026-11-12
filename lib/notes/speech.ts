// The arithmetic around Whisper, the speech model the Pi turns recordings into text with: the
// picture of the sound it listens to (a log-mel spectrogram), where to cut a long recording
// into the 30-second pieces it hears at a time, and turning its tokens back into words. Kept
// apart from the model itself so it can be tested without one.

export const SAMPLE_RATE = 16_000;
export const WINDOW_SAMPLES = 30 * SAMPLE_RATE;
const N_FFT = 400;
const HOP = 160;
export const N_MELS = 80;
export const N_FRAMES = WINDOW_SAMPLES / HOP;
const BINS = N_FFT / 2 + 1;

// ── The spectrogram ───────────────────────────────────────────────────────────

/** Hertz to mels and back, on the Slaney scale Whisper's filters were made with. */
const F_SP = 200 / 3;
const MIN_LOG_HZ = 1000;
const MIN_LOG_MEL = MIN_LOG_HZ / F_SP;
const LOG_STEP = Math.log(6.4) / 27;
const hzToMel = (hz: number) => (hz < MIN_LOG_HZ ? hz / F_SP : MIN_LOG_MEL + Math.log(hz / MIN_LOG_HZ) / LOG_STEP);
const melToHz = (mel: number) => (mel < MIN_LOG_MEL ? mel * F_SP : MIN_LOG_HZ * Math.exp(LOG_STEP * (mel - MIN_LOG_MEL)));

let filters: Float32Array | null = null;

/** 80 triangular filters over the 201 frequency bins, each scaled to the same area (librosa's `norm='slaney'`). */
export function melFilters() {
  if (filters) return filters;
  const out = new Float32Array(N_MELS * BINS);
  const top = hzToMel(SAMPLE_RATE / 2);
  const edges = Array.from({ length: N_MELS + 2 }, (_, i) => melToHz((top * i) / (N_MELS + 1)));
  for (let m = 0; m < N_MELS; m++) {
    const [lo, mid, hi] = [edges[m], edges[m + 1], edges[m + 2]];
    const scale = 2 / (hi - lo);
    for (let b = 0; b < BINS; b++) {
      const hz = (b * SAMPLE_RATE) / N_FFT;
      const weight = Math.max(0, Math.min((hz - lo) / (mid - lo), (hi - hz) / (hi - mid)));
      out[m * BINS + b] = weight * scale;
    }
  }
  filters = out;
  return out;
}

let tables: { cos: Float64Array; sin: Float64Array; hann: Float32Array } | null = null;

function fftTables() {
  if (tables) return tables;
  const cos = Float64Array.from({ length: N_FFT }, (_, i) => Math.cos((2 * Math.PI * i) / N_FFT));
  const sin = Float64Array.from({ length: N_FFT }, (_, i) => Math.sin((2 * Math.PI * i) / N_FFT));
  // Periodic Hann, as torch.hann_window makes it.
  const hann = Float32Array.from({ length: N_FFT }, (_, n) => 0.5 - 0.5 * Math.cos((2 * Math.PI * n) / N_FFT));
  tables = { cos, sin, hann };
  return tables;
}

/**
 * The discrete Fourier transform of `n` points (a factor of 400, so made of 2s and 5s) taken
 * every `stride` from `start`, into `outRe`/`outIm` from `at`. Split by its smallest factor and
 * put back together, which is about ten times quicker than the sum written out.
 */
function fft(input: Float32Array, start: number, stride: number, n: number, outRe: Float64Array, outIm: Float64Array, at: number, scratch: Float64Array) {
  if (n === 1) {
    outRe[at] = input[start];
    outIm[at] = 0;
    return;
  }
  const p = n % 2 === 0 ? 2 : n % 5 === 0 ? 5 : n;
  const m = n / p;
  for (let j = 0; j < p; j++) fft(input, start + j * stride, stride * p, m, outRe, outIm, at + j * m, scratch);
  const { cos, sin } = fftTables();
  const step = N_FFT / n;
  for (let k = 0; k < m; k++) {
    for (let q = 0; q < p; q++) {
      const index = k + m * q;
      let re = 0;
      let im = 0;
      for (let j = 0; j < p; j++) {
        const turn = ((j * index) % n) * step;
        const c = cos[turn];
        const s = -sin[turn];
        const yr = outRe[at + j * m + k];
        const yi = outIm[at + j * m + k];
        re += yr * c - yi * s;
        im += yr * s + yi * c;
      }
      scratch[2 * index] = re;
      scratch[2 * index + 1] = im;
    }
  }
  for (let i = 0; i < n; i++) {
    outRe[at + i] = scratch[2 * i];
    outIm[at + i] = scratch[2 * i + 1];
  }
}

/** The power in each of the 201 frequency bins of one 400-sample frame (already windowed). */
export function framePower(frame: Float32Array, power: Float32Array | Float64Array) {
  const re = new Float64Array(N_FFT);
  const im = new Float64Array(N_FFT);
  fft(frame, 0, 1, N_FFT, re, im, 0, new Float64Array(2 * N_FFT));
  for (let k = 0; k < BINS; k++) power[k] = re[k] * re[k] + im[k] * im[k];
  return power;
}

/**
 * What Whisper hears: 30 seconds of sound (shorter is padded with silence) as 80 mel bands ×
 * 3000 frames, laid out band by band. The same steps as Whisper's own: a centred short-time
 * Fourier transform with reflected edges, power, mel filters, log10, the bottom clipped to 8
 * below the loudest, then scaled to about −1…1.
 */
export function logMel(samples: Float32Array) {
  const audio = new Float32Array(WINDOW_SAMPLES);
  audio.set(samples.subarray(0, WINDOW_SAMPLES));
  const pad = N_FFT / 2;
  const padded = new Float32Array(WINDOW_SAMPLES + 2 * pad);
  padded.set(audio, pad);
  for (let i = 0; i < pad; i++) {
    padded[pad - 1 - i] = audio[i + 1];
    padded[pad + WINDOW_SAMPLES + i] = audio[WINDOW_SAMPLES - 2 - i];
  }
  const { hann } = fftTables();
  const bank = melFilters();
  const out = new Float32Array(N_MELS * N_FRAMES);
  const frame = new Float32Array(N_FFT);
  const power = new Float64Array(BINS);
  let loudest = -Infinity;
  // Whisper drops the last of the 3001 frames.
  for (let f = 0; f < N_FRAMES; f++) {
    const startAt = f * HOP;
    for (let n = 0; n < N_FFT; n++) frame[n] = padded[startAt + n] * hann[n];
    framePower(frame, power);
    for (let m = 0; m < N_MELS; m++) {
      let sum = 0;
      const row = m * BINS;
      for (let k = 0; k < BINS; k++) sum += bank[row + k] * power[k];
      const value = Math.log10(Math.max(sum, 1e-10));
      out[m * N_FRAMES + f] = value;
      if (value > loudest) loudest = value;
    }
  }
  const floor = loudest - 8;
  for (let i = 0; i < out.length; i++) out[i] = (Math.max(out[i], floor) + 4) / 4;
  return out;
}

// ── Cutting a recording into pieces ──────────────────────────────────────────

const STEP = SAMPLE_RATE / 10;

/** How loud the loudest tenth of a second is, as RMS. */
export function loudness(samples: Float32Array) {
  let loudest = 0;
  for (let start = 0; start + STEP <= samples.length; start += STEP) {
    let sum = 0;
    for (let i = start; i < start + STEP; i++) sum += samples[i] * samples[i];
    loudest = Math.max(loudest, Math.sqrt(sum / STEP));
  }
  return loudest;
}

/**
 * Where to end a piece that's more than 30 seconds: the quietest tenth of a second in its last
 * ten seconds, so a word is rarely cut in half.
 */
export function cutPoint(samples: Float32Array) {
  const from = WINDOW_SAMPLES - 10 * SAMPLE_RATE;
  let best = WINDOW_SAMPLES;
  let quietest = Infinity;
  for (let start = from; start + STEP <= WINDOW_SAMPLES && start + STEP <= samples.length; start += STEP / 2) {
    let sum = 0;
    for (let i = start; i < start + STEP; i++) sum += samples[i] * samples[i];
    if (sum < quietest) {
      quietest = sum;
      best = start + STEP / 2;
    }
  }
  return best;
}

/**
 * Pieces of up to 30 seconds from a stream of sound, each with where it starts, in samples
 * from `offset`. Only about one piece is ever held, so an hour-long lecture fits on a Pi.
 */
export async function* pieces(source: AsyncIterable<Float32Array>, offset = 0): AsyncGenerator<{ start: number; samples: Float32Array }> {
  let buffer = new Float32Array(WINDOW_SAMPLES * 2);
  let held = 0;
  let start = offset;
  for await (const chunk of source) {
    let at = 0;
    while (at < chunk.length) {
      const take = Math.min(chunk.length - at, buffer.length - held);
      buffer.set(chunk.subarray(at, at + take), held);
      held += take;
      at += take;
      while (held > WINDOW_SAMPLES) {
        const cut = cutPoint(buffer.subarray(0, held));
        yield { start, samples: buffer.slice(0, cut) };
        buffer.copyWithin(0, cut, held);
        held -= cut;
        start += cut;
      }
    }
  }
  // The end, unless it's only a breath.
  if (held > SAMPLE_RATE / 3) yield { start, samples: buffer.slice(0, held) };
  buffer = new Float32Array(0);
}

// ── Tokens back into words ───────────────────────────────────────────────────

let byteOf: Map<string, number> | null = null;

/** GPT-2's byte-level BPE writes every byte as a printable character; this is the way back. */
function byteDecoder() {
  if (byteOf) return byteOf;
  const printable: number[] = [];
  for (let b = 33; b <= 126; b++) printable.push(b);
  for (let b = 161; b <= 172; b++) printable.push(b);
  for (let b = 174; b <= 255; b++) printable.push(b);
  const map = new Map<string, number>();
  for (const b of printable) map.set(String.fromCharCode(b), b);
  let extra = 0;
  for (let b = 0; b < 256; b++) {
    if (printable.includes(b)) continue;
    map.set(String.fromCharCode(256 + extra), b);
    extra += 1;
  }
  byteOf = map;
  return map;
}

export function tokensToText(pieces: string[], ids: number[]) {
  const decode = byteDecoder();
  const bytes: number[] = [];
  for (const id of ids) {
    for (const char of pieces[id] ?? '') {
      const byte = decode.get(char);
      if (byte !== undefined) bytes.push(byte);
    }
  }
  return new TextDecoder().decode(new Uint8Array(bytes));
}

/**
 * A model hearing something it can't make out can say the same words over and over. If the
 * end of `ids` is one run said again and again, how many tokens to drop to leave it said once.
 */
export function repeatedTail(ids: number[]) {
  for (let size = 1; size <= 12; size++) {
    const times = size === 1 ? 8 : size <= 3 ? 5 : 3;
    if (ids.length < size * times) continue;
    const tail = ids.slice(-size);
    let repeats = 1;
    while (repeats < times && ids.slice(-size * (repeats + 1), -size * repeats).every((id, i) => id === tail[i])) repeats += 1;
    if (repeats >= times) return size * (repeats - 1);
  }
  return 0;
}

/** Whisper's text tidied: its spaces, and the stock lines it says over silence. */
export function tidySpeech(text: string) {
  const cleaned = text.replace(/\s+/g, ' ').trim();
  if (/^[\s.,!?♪-]*$/.test(cleaned)) return '';
  return cleaned;
}
