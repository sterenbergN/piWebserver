import test from 'node:test';
import { strict as assert } from 'node:assert';
import { cutPoint, framePower, levelled, logMel, loudness, melFilters, N_FRAMES, N_MELS, pieces, repeatedTail, SAMPLE_RATE, tidySpeech, tokensToText, WINDOW_SAMPLES } from './speech';

test('the quick transform gives the same power as the sum written out', () => {
  const frame = Float32Array.from({ length: 400 }, (_, n) => Math.sin(n * 0.37) + 0.5 * Math.cos(n * 1.91) + (n % 7) / 10);
  const quick = framePower(frame, new Float64Array(201));
  for (let k = 0; k < 201; k++) {
    let re = 0;
    let im = 0;
    for (let n = 0; n < 400; n++) {
      re += frame[n] * Math.cos((2 * Math.PI * k * n) / 400);
      im -= frame[n] * Math.sin((2 * Math.PI * k * n) / 400);
    }
    const slow = re * re + im * im;
    assert.ok(Math.abs(quick[k] - slow) <= 1e-6 * Math.max(1, slow), `bin ${k}: ${quick[k]} vs ${slow}`);
  }
});

test('a pure tone lands in its bin', () => {
  // 1 kHz is bin 25 of 201 at 16 kHz with 400 points.
  const frame = Float32Array.from({ length: 400 }, (_, n) => Math.sin((2 * Math.PI * 1000 * n) / SAMPLE_RATE));
  const power = framePower(frame, new Float64Array(201));
  const loudest = power.indexOf(Math.max(...power));
  assert.equal(loudest, 25);
});

test('mel filters: 80 of them, none negative, each covering some bins, low ones narrower', () => {
  const bank = melFilters();
  assert.equal(bank.length, 80 * 201);
  const widths: number[] = [];
  for (let m = 0; m < 80; m++) {
    const row = bank.subarray(m * 201, (m + 1) * 201);
    assert.ok(row.every((w) => w >= 0));
    assert.ok(row.some((w) => w > 0), `filter ${m} is empty`);
    widths.push(row.filter((w) => w > 0).length);
  }
  assert.ok(widths[79] > widths[5]);
});

test('the spectrogram is the shape Whisper takes, within its range', () => {
  const tone = Float32Array.from({ length: SAMPLE_RATE * 5 }, (_, n) => 0.3 * Math.sin((2 * Math.PI * 440 * n) / SAMPLE_RATE));
  const mel = logMel(tone);
  assert.equal(mel.length, N_MELS * N_FRAMES);
  const max = mel.reduce((a, b) => Math.max(a, b), -Infinity);
  const min = mel.reduce((a, b) => Math.min(a, b), Infinity);
  assert.ok(max - min <= 2 + 1e-6, 'clipped to 8 (2 after scaling) below the loudest');
  assert.ok(Number.isFinite(max) && Number.isFinite(min));
});

test('a quiet recording is turned up to speaking level, so the model sees what it would for a loud one', () => {
  const voice = (level: number) => Float32Array.from({ length: SAMPLE_RATE * 3 }, (_, n) => level * (Math.sin(n * 0.11) + 0.5 * Math.sin(n * 0.37)) * (0.6 + 0.4 * Math.sin(n / 4000)));
  const quiet = voice(0.004);
  const lifted = levelled(quiet);
  assert.ok(Math.abs(loudness(lifted) - 0.1) < 0.005, `lifted to ${loudness(lifted)}`);
  // The picture of it is the same as for the same sound recorded at that level.
  const scale = loudness(lifted) / loudness(quiet);
  const same = logMel(voice(0.004 * scale));
  const seen = logMel(lifted);
  let worst = 0;
  for (let i = 0; i < seen.length; i++) worst = Math.max(worst, Math.abs(seen[i] - same[i]));
  assert.ok(worst < 1e-3, `off by ${worst}`);
  // And well away from the picture of it left quiet, which is what the model was being shown.
  const before = logMel(quiet);
  const top = (values: Float32Array) => values.reduce((a, b) => Math.max(a, b), -Infinity);
  assert.ok(Math.abs(top(seen) - top(before)) > 0.5);

  const loud = voice(0.3);
  assert.equal(levelled(loud), loud, 'already loud: left alone');
  assert.equal(levelled(new Float32Array(100)).length, 100, 'silence stays silence');
  const faint = levelled(voice(0.00001));
  assert.ok(loudness(faint) < 0.01, 'almost nothing is not turned into a roar');
  assert.ok(lifted.every((v) => v >= -1 && v <= 1));
});

test('the mel sums skip the empty bins without changing the answer', () => {
  const tone = Float32Array.from({ length: SAMPLE_RATE }, (_, n) => 0.2 * Math.sin(n * 0.5) + 0.1 * Math.sin(n * 1.7));
  const mel = logMel(tone);
  // The first frame, band by band, worked out the long way.
  const bank = melFilters();
  const padded = new Float32Array(400);
  // Frame 0 is centred on sample 0: the 200 before it are the next 200 mirrored.
  for (let i = 0; i < 400; i++) padded[i] = (i < 200 ? tone[200 - i] : tone[i - 200]) * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / 400));
  const power = framePower(padded, new Float64Array(201));
  const whole = logMel(tone).reduce((a, b) => Math.max(a, b), -Infinity) * 4 - 4;
  for (let m = 0; m < N_MELS; m += 7) {
    let sum = 0;
    for (let k = 0; k < 201; k++) sum += bank[m * 201 + k] * power[k];
    const expected = (Math.max(Math.log10(Math.max(sum, 1e-10)), whole - 8) + 4) / 4;
    assert.ok(Math.abs(mel[m * N_FRAMES] - expected) < 1e-4, `band ${m}: ${mel[m * N_FRAMES]} vs ${expected}`);
  }
});

test('loudness tells silence from speech-level sound', () => {
  assert.equal(loudness(new Float32Array(SAMPLE_RATE)), 0);
  const quiet = Float32Array.from({ length: SAMPLE_RATE }, (_, n) => 0.1 * Math.sin(n));
  assert.ok(loudness(quiet) > 0.05);
});

test('a long piece is cut at its quietest moment in the last ten seconds', () => {
  const sound = Float32Array.from({ length: WINDOW_SAMPLES + SAMPLE_RATE }, (_, n) => 0.2 * Math.sin(n * 0.3));
  const gap = 24 * SAMPLE_RATE;
  sound.fill(0, gap, gap + SAMPLE_RATE / 5);
  const cut = cutPoint(sound);
  assert.ok(cut >= gap && cut <= gap + SAMPLE_RATE / 5, `cut at ${cut / SAMPLE_RATE}s`);
});

test('pieces cover the whole recording in order, none over 30 seconds', async () => {
  const total = 95 * SAMPLE_RATE + 1234;
  async function* source() {
    for (let at = 0; at < total; at += 7777) yield Float32Array.from({ length: Math.min(7777, total - at) }, (_, i) => 0.1 * Math.sin((at + i) * 0.2));
  }
  let expected = 500;
  let covered = 0;
  for await (const piece of pieces(source(), 500)) {
    assert.equal(piece.start, expected);
    assert.ok(piece.samples.length <= WINDOW_SAMPLES);
    expected += piece.samples.length;
    covered += piece.samples.length;
  }
  assert.equal(covered, total);
});

test('tokens back into text, through byte-level pieces', () => {
  const pieces = ['Hello', 'Ġworld', '.', 'Ġcaf', 'Ã©'];
  assert.equal(tokensToText(pieces, [0, 1, 2]), 'Hello world.');
  assert.equal(tokensToText(pieces, [3, 4]), ' café');
});

test('a run said over and over is cut back to once', () => {
  assert.equal(repeatedTail([1, 2, 3, 4]), 0);
  assert.equal(repeatedTail([9, 5, 6, 5, 6, 5, 6, 5, 6, 5, 6]), 8);
  assert.equal(repeatedTail([1, 7, 7, 7, 7, 7, 7, 7, 7]), 7);
});

test('stock silence lines are dropped, speech is tidied', () => {
  assert.equal(tidySpeech('  ... '), '');
  assert.equal(tidySpeech(' Hello   there. '), 'Hello there.');
});

test('the speech worker stops a run said over and over in the same place as here', async () => {
  const worker = (await import('./speech-worker.cjs')) as unknown as { repeatedTail: (ids: number[]) => number; default?: { repeatedTail: (ids: number[]) => number } };
  const workerTail = worker.repeatedTail ?? worker.default!.repeatedTail;
  const cases = [[1, 2, 3, 4], [9, 5, 6, 5, 6, 5, 6, 5, 6, 5, 6], [1, 7, 7, 7, 7, 7, 7, 7, 7], [4, 1, 2, 3, 1, 2, 3, 1, 2, 3], []];
  for (const ids of cases) assert.equal(workerTail(ids), repeatedTail(ids), JSON.stringify(ids));
});
