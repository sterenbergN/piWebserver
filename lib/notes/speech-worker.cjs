// The speech model, run in a process of its own. ONNX Runtime's Node binding runs a model on
// the thread that asks, and on a Pi one 30-second piece takes seconds: run on the server's own
// thread, every page of the site waited for it while a lecture was being turned into text. And
// its memory is its own: it doesn't count toward the site's 700 MB (pm2 restarts the site past
// that, which used to stop transcribing part-way), and it's all handed back when the process
// ends after ten idle minutes. transcriber.ts starts it, sends the picture of each piece of
// sound, and gets back the words' token ids.
//
/* eslint-disable @typescript-eslint/no-require-imports -- CommonJS on purpose: see below. */
// Plain CommonJS, not TypeScript, so it runs as it is in development and in a release build
// (next.config.ts copies it into the build). Keep it in step with transcriber.ts.

const fs = require('fs/promises');
const path = require('path');

const START = 50257;
const END = 50256;
const NO_SPEECH = 50361;
const NO_TIMESTAMPS = 50362;
const HEADS = 8;
const HEAD_SIZE = 64;
const N_MELS = 80;
const N_FRAMES = 3000;

let model = null;

async function load(folder) {
  const ort = require('onnxruntime-node');
  // Three of the Pi's four cores: it's a long job, and the site keeps the fourth. No memory arena:
  // it keeps the largest buffers ever needed, and with it transcribing took 1.2 GB where it takes
  // 0.4 GB without, about a fifth slower. Over 700 MB, pm2 restarts the whole site.
  const options = { intraOpNumThreads: 3, interOpNumThreads: 1, graphOptimizationLevel: 'all', enableCpuMemArena: false, enableMemPattern: true };
  const encoder = await ort.InferenceSession.create(path.join(folder, 'onnx/encoder_model.onnx'), options);
  const decoder = await ort.InferenceSession.create(path.join(folder, 'onnx/decoder_model_merged_quantized.onnx'), options);
  const tokenizer = JSON.parse(await fs.readFile(path.join(folder, 'tokenizer.json'), 'utf-8'));
  const generation = JSON.parse(await fs.readFile(path.join(folder, 'generation_config.json'), 'utf-8'));
  const size = Math.max(...Object.values(tokenizer.model.vocab), ...tokenizer.added_tokens.map((t) => t.id)) + 1;
  // Words and the end; none of the model's own markers, and none of the noises it was told not to write.
  const allowed = new Uint8Array(size);
  for (let id = 0; id < START; id++) allowed[id] = 1;
  for (const id of generation.suppress_tokens) if (id < size) allowed[id] = 0;
  const firstAllowed = allowed.slice();
  for (const id of generation.begin_suppress_tokens) if (id < size) firstAllowed[id] = 0;
  model = { ort, encoder, decoder, allowed, firstAllowed };
}

/** The best word the model allows, and how sure it was (as a log probability). */
function pick(logits, offset, size, allowed) {
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
function noSpeechChance(logits, size) {
  let top = -Infinity;
  for (let id = 0; id < size; id++) top = Math.max(top, logits[id]);
  let sum = 0;
  for (let id = 0; id < size; id++) sum += Math.exp(logits[id] - top);
  return Math.exp(logits[NO_SPEECH] - top) / sum;
}

/** The same as repeatedTail in speech.ts (speech.test.ts checks the two agree). */
function repeatedTail(ids) {
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

/** The words (as token ids) in one piece's picture, how sure the model was, and how sure that nobody spoke. */
async function listen(features, maxTokens) {
  const { ort, encoder, decoder, allowed, firstAllowed } = model;
  const input0 = new ort.Tensor('float32', features, [1, N_MELS, N_FRAMES]);
  const encoded = (await encoder.run({ input_features: input0 }, ['last_hidden_state'])).last_hidden_state;
  const presentNames = decoder.outputNames.filter((name) => name.startsWith('present.'));
  let past = {};
  for (const name of decoder.inputNames) {
    if (name.startsWith('past_key_values.')) past[name] = new ort.Tensor('float32', new Float32Array(0), [1, HEADS, 0, HEAD_SIZE]);
  }
  let input = [START, NO_TIMESTAMPS];
  const ids = [];
  let logprobs = 0;
  let noSpeech = 0;
  for (let step = 0; step < maxTokens; step++) {
    const feeds = {
      input_ids: new ort.Tensor('int64', BigInt64Array.from(input.map(BigInt)), [1, input.length]),
      encoder_hidden_states: encoded,
      use_cache_branch: new ort.Tensor('bool', [step > 0], [1]),
      ...past,
    };
    const out = await decoder.run(feeds, ['logits', ...presentNames]);
    const logits = out.logits.data;
    const size = out.logits.dims[2];
    if (step === 0) noSpeech = noSpeechChance(logits, size);
    const next = pick(logits, (input.length - 1) * size, size, step === 0 ? firstAllowed : allowed);
    // What the model worked out about the sound is made once, on the first step; after that
    // only its memory of the words so far grows (the later "encoder" outputs are empty).
    // Each step's results are let go at once: their memory is outside JavaScript's, so its
    // collector doesn't see it, and waiting for it took the worker past 900 MB.
    const nextPast = { ...past };
    for (const name of presentNames) {
      if (step > 0 && name.includes('.encoder.')) { dispose(out[name]); continue; }
      const key = name.replace('present.', 'past_key_values.');
      dispose(past[key]);
      nextPast[key] = out[name];
    }
    dispose(out.logits);
    dispose(feeds.input_ids);
    dispose(feeds.use_cache_branch);
    past = nextPast;
    if (next.id === END || next.id < 0) break;
    ids.push(next.id);
    logprobs += next.logprob;
    input = [next.id];
    const drop = repeatedTail(ids);
    if (drop) { ids.splice(ids.length - drop); break; }
  }
  for (const tensor of Object.values(past)) dispose(tensor);
  dispose(encoded);
  dispose(input0);
  return { ids, logprobs, noSpeech };
}

function dispose(tensor) {
  try { tensor?.dispose?.(); } catch { /* Already gone. */ }
}

const reply = (message) => process.send?.(message);

if (process.send) {
  // The site going away (a restart, an update) takes this with it.
  process.on('disconnect', () => process.exit(0));
  process.on('message', async (message) => {
    try {
      if (message.type === 'load') {
        await load(message.folder);
        reply({ id: message.id, ok: true });
      } else if (message.type === 'listen') {
        reply({ id: message.id, ok: true, result: await listen(message.features, message.maxTokens) });
      }
    } catch (error) {
      reply({ id: message.id, ok: false, error: error instanceof Error ? error.message : String(error) });
    }
  });
}

module.exports = { repeatedTail };
