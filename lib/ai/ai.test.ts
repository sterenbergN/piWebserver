import test, { after, before } from 'node:test';
import { strict as assert } from 'node:assert';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { createAiJobs } from './jobs';
import { AiError, type Provider } from './providers';
import { AiSettingsError, applyAiPatch, cleanAiSettings, defaultAiSettings, getAiSettings, isAiReady, saveAiSettings, toPublic, type AiSettings } from './settings';

const original = process.cwd();
let dir = '';
before(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ai-settings-'));
  process.chdir(dir);
});
after(async () => {
  process.chdir(original);
  await fs.rm(dir, { recursive: true, force: true });
});

// ── Settings ──────────────────────────────────────────────────────────────────

test('nothing saved means Claude Opus, no key, not ready', async () => {
  const s = await getAiSettings();
  assert.equal(s.provider, 'anthropic');
  assert.equal(s.model, 'claude-opus-5-5');
  assert.equal(s.apiKey, '');
  assert.equal(isAiReady(s), false);
});

test('odd stored values fall back to safe ones', () => {
  const s = cleanAiSettings({ provider: 'nope', model: 'bad model name!', apiKey: 42, enabled: 'yes' });
  assert.deepEqual(s, { ...defaultAiSettings(), enabled: true });
  assert.equal(cleanAiSettings({ enabled: false }).enabled, false);
});

test('a blank key keeps the saved one; clearKey forgets it', () => {
  const now = new Date('2026-11-20T00:00:00Z');
  const withKey = applyAiPatch(defaultAiSettings(), { apiKey: '  sk-ant-abc123  ' }, now);
  assert.equal(withKey.apiKey, 'sk-ant-abc123');
  assert.equal(applyAiPatch(withKey, { apiKey: '' }, now).apiKey, 'sk-ant-abc123');
  assert.equal(applyAiPatch(withKey, { model: 'claude-sonnet-5-5' }, now).apiKey, 'sk-ant-abc123');
  assert.equal(applyAiPatch(withKey, { clearKey: true }, now).apiKey, '');
});

test('bad changes are refused', () => {
  const s = defaultAiSettings();
  assert.throws(() => applyAiPatch(s, { provider: 'openai-ish' }), AiSettingsError);
  assert.throws(() => applyAiPatch(s, { model: '' }), AiSettingsError);
  assert.throws(() => applyAiPatch(s, { apiKey: 'has spaces in it' }), AiSettingsError);
  assert.throws(() => applyAiPatch(s, { apiKey: 12 }), AiSettingsError);
});

test('the public view never carries the key', () => {
  const pub = toPublic({ ...defaultAiSettings(), apiKey: 'sk-ant-supersecret-WXYZ' });
  assert.equal(pub.hasKey, true);
  assert.equal(pub.keyHint, '…WXYZ');
  assert.ok(!JSON.stringify(pub).includes('supersecret'));
});

test('saving writes under .data/ai and reads back', async () => {
  await saveAiSettings({ apiKey: 'sk-ant-saved-1234', model: 'claude-haiku-5-5' });
  const s = await getAiSettings();
  assert.equal(s.apiKey, 'sk-ant-saved-1234');
  assert.equal(s.model, 'claude-haiku-5-5');
  assert.equal(isAiReady(s), true);
  await saveAiSettings({ enabled: false });
  assert.equal(isAiReady(await getAiSettings()), false, 'switched off hides it even with a key');
  const onDisk = JSON.parse(await fs.readFile(path.join(dir, '.data', 'ai', 'settings.json'), 'utf-8'));
  assert.equal(onDisk.apiKey, 'sk-ant-saved-1234');
});

// ── Jobs: Generate when it works, a clear reason (and copy-paste) when it doesn't ──

const ready: AiSettings = { ...defaultAiSettings(), apiKey: 'sk-ant-test' };

function fakeProvider(generate: Provider['generate']): Provider {
  return { generate, check: async () => ({ modelLabel: 'Test' }) };
}

/** Wait for a job to stop running. */
async function settle(jobs: ReturnType<typeof createAiJobs>, owner: string, id: string) {
  for (let i = 0; i < 200; i++) {
    const job = jobs.get(owner, id);
    if (job && job.status !== 'running') return job;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error('job never finished');
}

test('a working provider fills in the reply', async () => {
  let seen = '';
  const jobs = createAiJobs({
    loadSettings: async () => ready,
    providerFor: () => fakeProvider(async ({ prompt, apiKey, model }) => { seen = `${apiKey}|${model}|${prompt}`; return '```json\n{"ok":true}\n```'; }),
  });
  const started = await jobs.start('user:a', 'Write a week plan');
  assert.equal(started.status, 'running');
  const done = await settle(jobs, 'user:a', started.id);
  assert.equal(done.status, 'done');
  assert.equal(done.text, '```json\n{"ok":true}\n```');
  assert.equal(seen, 'sk-ant-test|claude-opus-5-5|Write a week plan');
});

test('no key or switched off: it won’t start, so the page keeps copy-paste', async () => {
  for (const settings of [defaultAiSettings(), { ...ready, enabled: false }]) {
    const jobs = createAiJobs({ loadSettings: async () => settings, providerFor: () => fakeProvider(async () => 'x') });
    await assert.rejects(jobs.start('user:a', 'hi'), (e: unknown) => e instanceof AiError && e.kind === 'not-set-up');
  }
});

test('a provider error comes back as a short message, not a crash', async () => {
  const jobs = createAiJobs({
    loadSettings: async () => ready,
    providerFor: () => fakeProvider(async () => { throw new AiError('auth', 'The API key was turned down.'); }),
  });
  const { id } = await jobs.start('user:a', 'hi');
  const job = await settle(jobs, 'user:a', id);
  assert.equal(job.status, 'error');
  assert.equal(job.errorKind, 'auth');
  assert.equal(job.error, 'The API key was turned down.');
});

test('an unexpected error never leaks its message', async () => {
  const jobs = createAiJobs({
    loadSettings: async () => ready,
    providerFor: () => fakeProvider(async () => { throw new Error('boom with sk-ant-test inside'); }),
  });
  const { id } = await jobs.start('user:a', 'hi');
  const job = await settle(jobs, 'user:a', id);
  assert.equal(job.status, 'error');
  assert.ok(!job.error?.includes('sk-ant'));
});

test('a reply that takes too long is stopped', async () => {
  const jobs = createAiJobs({
    loadSettings: async () => ready,
    timeoutMs: 20,
    providerFor: () => fakeProvider(({ signal }) => new Promise((_, reject) => {
      signal?.addEventListener('abort', () => reject(new AiError('timeout', 'It took too long to answer.')));
    })),
  });
  const { id } = await jobs.start('user:a', 'hi');
  const job = await settle(jobs, 'user:a', id);
  assert.equal(job.errorKind, 'timeout');
});

test('one at a time per account, a cap per hour, and nobody sees another’s job', async () => {
  let release = () => {};
  const jobs = createAiJobs({
    loadSettings: async () => ready,
    perHour: 2,
    providerFor: () => fakeProvider(() => new Promise((resolve) => { release = () => resolve('done'); })),
  });
  const first = await jobs.start('user:a', 'one');
  await assert.rejects(jobs.start('user:a', 'two'), (e: unknown) => e instanceof AiError && e.kind === 'busy');
  assert.equal(jobs.get('user:b', first.id), null, 'another account can’t read it');
  jobs.cancel('user:b', first.id);
  assert.equal(jobs.get('user:a', first.id)?.status, 'running', 'or stop it');
  release();
  await settle(jobs, 'user:a', first.id);
  const second = await jobs.start('user:a', 'two');
  release();
  await settle(jobs, 'user:a', second.id);
  await assert.rejects(jobs.start('user:a', 'three'), (e: unknown) => e instanceof AiError && e.kind === 'rate');
  // Someone else still has their own allowance.
  const other = await jobs.start('user:b', 'one');
  release();
  assert.equal((await settle(jobs, 'user:b', other.id)).status, 'done');
});

test('empty and huge prompts are refused before calling anything', async () => {
  let calls = 0;
  const jobs = createAiJobs({ loadSettings: async () => ready, providerFor: () => fakeProvider(async () => { calls++; return 'x'; }) });
  await assert.rejects(jobs.start('user:a', '   '), (e: unknown) => e instanceof AiError && e.kind === 'empty');
  await assert.rejects(jobs.start('user:a', 'x'.repeat(400_001)), (e: unknown) => e instanceof AiError && e.kind === 'too-long');
  assert.equal(calls, 0);
});

test('finished jobs are forgotten after a while', async () => {
  let t = 1_000_000;
  const jobs = createAiJobs({ loadSettings: async () => ready, keepMs: 1000, now: () => t, providerFor: () => fakeProvider(async () => 'x') });
  const { id } = await jobs.start('user:a', 'hi');
  await settle(jobs, 'user:a', id);
  t += 2000;
  assert.equal(jobs.get('user:a', id), null);
});
