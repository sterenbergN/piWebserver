import test from 'node:test';
import { strict as assert } from 'node:assert';
import { cutPoint, framePower, logMel, loudness, melFilters, N_FRAMES, N_MELS, pieces, repeatedTail, SAMPLE_RATE, tidySpeech, tokensToText, WINDOW_SAMPLES } from './speech';

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
