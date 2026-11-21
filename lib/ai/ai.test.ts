import test, { after, before } from 'node:test';
import { strict as assert } from 'node:assert';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { createAiJobs } from './jobs';
import { AiError, geminiError, providerFor, readGeminiReply, type Provider } from './providers';
import { currentCatalog, modelForTask, savedCatalog } from './catalog';
import { resolveChoice } from './providers-list';
import { stripCodeFence } from './reply';
import { AiSettingsError, applyAiPatch, choiceFor, cleanAiSettings, connectionFor, defaultAiSettings, forgetAiAccount, getAiSettings, isAiReady, mayUseAi, saveAiSettings, toPublic, type AiSettings } from './settings';

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
  assert.equal(s.model, 'auto:opus');
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

const ready: AiSettings = { ...defaultAiSettings(), apiKey: 'sk-ant-test', allowedUserIds: ['a', 'b'] };
/** Signed in as account `id` (not the admin). */
const as = (id: string) => ({ userId: id, isAdmin: false });

function fakeProvider(generate: Provider['generate']): Provider {
  return { generate, check: async () => ({ modelLabel: 'Test' }), listModels: async () => [] };
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
  const started = await jobs.start('user:a', 'Write a week plan', as('a'));
  assert.equal(started.status, 'running');
  const done = await settle(jobs, 'user:a', started.id);
  assert.equal(done.status, 'done');
  assert.equal(done.text, '```json\n{"ok":true}\n```');
  assert.equal(seen, 'sk-ant-test|claude-opus-5-5|Write a week plan');
});

test('no key or switched off: it won’t start, so the page keeps copy-paste', async () => {
  for (const settings of [defaultAiSettings(), { ...ready, enabled: false }]) {
    const jobs = createAiJobs({ loadSettings: async () => settings, providerFor: () => fakeProvider(async () => 'x') });
    await assert.rejects(jobs.start('user:a', 'hi', as('a')), (e: unknown) => e instanceof AiError && e.kind === 'not-set-up');
  }
});

test('a provider error comes back as a short message, not a crash', async () => {
  const jobs = createAiJobs({
    loadSettings: async () => ready,
    providerFor: () => fakeProvider(async () => { throw new AiError('auth', 'The API key was turned down.'); }),
  });
  const { id } = await jobs.start('user:a', 'hi', as('a'));
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
  const { id } = await jobs.start('user:a', 'hi', as('a'));
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
  const { id } = await jobs.start('user:a', 'hi', as('a'));
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
  const first = await jobs.start('user:a', 'one', as('a'));
  await assert.rejects(jobs.start('user:a', 'two', as('a')), (e: unknown) => e instanceof AiError && e.kind === 'busy');
  assert.equal(jobs.get('user:b', first.id), null, 'another account can’t read it');
  jobs.cancel('user:b', first.id);
  assert.equal(jobs.get('user:a', first.id)?.status, 'running', 'or stop it');
  release();
  await settle(jobs, 'user:a', first.id);
  const second = await jobs.start('user:a', 'two', as('a'));
  release();
  await settle(jobs, 'user:a', second.id);
  await assert.rejects(jobs.start('user:a', 'three', as('a')), (e: unknown) => e instanceof AiError && e.kind === 'rate');
  // Someone else still has their own allowance.
  const other = await jobs.start('user:b', 'one', as('b'));
  release();
  assert.equal((await settle(jobs, 'user:b', other.id)).status, 'done');
});

test('empty and huge prompts are refused before calling anything', async () => {
  let calls = 0;
  const jobs = createAiJobs({ loadSettings: async () => ready, providerFor: () => fakeProvider(async () => { calls++; return 'x'; }) });
  await assert.rejects(jobs.start('user:a', '   ', as('a')), (e: unknown) => e instanceof AiError && e.kind === 'empty');
  await assert.rejects(jobs.start('user:a', 'x'.repeat(400_001), as('a')), (e: unknown) => e instanceof AiError && e.kind === 'too-long');
  assert.equal(calls, 0);
});

test('finished jobs are forgotten after a while', async () => {
  let t = 1_000_000;
  const jobs = createAiJobs({ loadSettings: async () => ready, keepMs: 1000, now: () => t, providerFor: () => fakeProvider(async () => 'x') });
  const { id } = await jobs.start('user:a', 'hi', as('a'));
  await settle(jobs, 'user:a', id);
  t += 2000;
  assert.equal(jobs.get('user:a', id), null);
});

// ── Who may use it ────────────────────────────────────────────────────────────

test('owner only by default: the admin may, accounts only once ticked', () => {
  const s = { ...defaultAiSettings(), apiKey: 'k' };
  assert.equal(mayUseAi(s, { userId: null, isAdmin: true }), true);
  assert.equal(mayUseAi(s, { userId: 'dev-partner', isAdmin: false }), false);
  const ticked = applyAiPatch(s, { allowedUserIds: ['dev-tester', 'bad id!', 'dev-tester'] });
  assert.deepEqual(ticked.allowedUserIds, ['dev-tester']);
  assert.equal(mayUseAi(ticked, { userId: 'dev-tester', isAdmin: false }), true);
  assert.equal(mayUseAi(ticked, { userId: 'dev-partner', isAdmin: false }), false);
  assert.throws(() => applyAiPatch(s, { allowedUserIds: 'dev-tester' }), AiSettingsError);
});

test('an account that isn’t ticked can’t start a job', async () => {
  let calls = 0;
  const jobs = createAiJobs({ loadSettings: async () => ready, providerFor: () => fakeProvider(async () => { calls++; return 'x'; }) });
  await assert.rejects(jobs.start('user:c', 'hi', as('c')), (e: unknown) => e instanceof AiError && e.kind === 'not-allowed');
  assert.equal(calls, 0);
});

test('changing provider forgets the old key so it never goes to the new one', () => {
  const claude = applyAiPatch(defaultAiSettings(), { apiKey: 'sk-ant-claude-key' });
  const gemini = applyAiPatch(claude, { provider: 'gemini' });
  assert.equal(gemini.apiKey, '');
  assert.equal(gemini.model, 'auto:flash');
  const withKey = applyAiPatch(claude, { provider: 'gemini', apiKey: 'AIza-gemini-key' });
  assert.equal(withKey.apiKey, 'AIza-gemini-key');
  assert.equal(applyAiPatch(withKey, { provider: 'gemini' }).apiKey, 'AIza-gemini-key', 'same provider keeps it');
});

// ── Gemini ────────────────────────────────────────────────────────────────────

test('Gemini: the key goes in a header, never the address, and thinking is left out', async () => {
  const realFetch = globalThis.fetch;
  let url = '';
  let headers: Record<string, string> = {};
  let body: { systemInstruction?: unknown; contents?: { parts: { text: string }[] }[] } = {};
  globalThis.fetch = (async (input: string, init: RequestInit) => {
    url = String(input);
    headers = init.headers as Record<string, string>;
    body = JSON.parse(String(init.body));
    return new Response(JSON.stringify({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: 'thinking…', thought: true }, { text: '```json\n{}\n```' }] } }] }), { status: 200 });
  }) as typeof fetch;
  try {
    const text = await providerFor('gemini').generate({ apiKey: 'AIza-secret', model: 'gemini-3.8-flash', prompt: 'Plan a week', timeoutMs: 5000 });
    assert.equal(text, '```json\n{}\n```');
    assert.match(url, /\/v1beta\/models\/gemini-3\.8-flash:generateContent$/);
    assert.ok(!url.includes('AIza'));
    assert.equal(headers['x-goog-api-key'], 'AIza-secret');
    assert.ok(body.systemInstruction);
    assert.equal(body.contents?.[0].parts[0].text, 'Plan a week');
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('Gemini: blocked, cut-off and empty answers become short reasons', () => {
  assert.throws(() => readGeminiReply({ promptFeedback: { blockReason: 'SAFETY' } }), (e: unknown) => e instanceof AiError && e.kind === 'refused');
  assert.throws(() => readGeminiReply({ candidates: [{ finishReason: 'SAFETY' }] }), (e: unknown) => e instanceof AiError && e.kind === 'refused');
  assert.throws(() => readGeminiReply({ candidates: [{ finishReason: 'MAX_TOKENS', content: { parts: [{ text: '{"half' }] } }] }), (e: unknown) => e instanceof AiError && e.kind === 'too-long');
  assert.throws(() => readGeminiReply({ candidates: [] }), (e: unknown) => e instanceof AiError && e.kind === 'empty');
});

test('Gemini: HTTP errors map to plain reasons', () => {
  assert.equal(geminiError(400, 'API key not valid. Please pass a valid API key.').kind, 'auth');
  assert.equal(geminiError(401).kind, 'auth');
  assert.match(geminiError(403, 'Your API key was reported as leaked.').message, /leaked/);
  assert.equal(geminiError(404).kind, 'model');
  assert.equal(geminiError(429, 'Resource has been exhausted').kind, 'rate');
  assert.equal(geminiError(503).kind, 'busy');
});

// ── Models per task, and keeping up with new ones ─────────────────────────────

test('“Newest …” picks the newest of a family, by date when there is one, else by version', () => {
  const claude = [
    { id: 'claude-opus-4-8', label: 'Claude Opus 4.8', createdAt: '2026-03-01T00:00:00Z' },
    { id: 'claude-opus-5-5', label: 'Claude Opus 5.5', createdAt: '2026-10-01T00:00:00Z' },
    { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5', createdAt: '2026-10-01T00:00:00Z' },
  ];
  assert.equal(resolveChoice('anthropic', 'auto:opus', claude).id, 'claude-opus-5-5');
  assert.equal(resolveChoice('anthropic', 'auto:sonnet', claude).id, 'claude-sonnet-5-5');
  // A release the site has never heard of is picked up as soon as the provider lists it.
  const later = [...claude, { id: 'claude-opus-6', label: 'Claude Opus 6', createdAt: '2027-02-01T00:00:00Z' }];
  assert.equal(resolveChoice('anthropic', 'auto:opus', later).label, 'Claude Opus 6');

  const gemini = ['gemini-3.6-flash', 'gemini-3.10-flash', 'gemini-3.8-flash', 'gemini-3.5-flash-lite', 'gemini-3-flash-preview', 'gemini-4-hydrogen']
    .map((id) => ({ id, label: id }));
  assert.equal(resolveChoice('gemini', 'auto:flash', gemini).id, 'gemini-3.10-flash', 'versions compare as numbers, previews are skipped');
  assert.equal(resolveChoice('gemini', 'auto:flash-lite', gemini).id, 'gemini-3.5-flash-lite');
  // No list yet (or an empty one): the built-in fallback.
  assert.equal(resolveChoice('gemini', 'auto:flash', []).id, 'gemini-3.8-flash');
  // An exact id stays exactly that.
  assert.equal(resolveChoice('gemini', 'gemini-4-hydrogen', gemini).id, 'gemini-4-hydrogen');
});

test('each task can have its own model; a blank one goes back to the default', () => {
  const s = applyAiPatch({ ...defaultAiSettings(), apiKey: 'k' }, { taskModels: { 'meal-plan': 'auto:sonnet', notes: 'claude-haiku-5-5', nonsense: 'x' } });
  assert.deepEqual(s.taskModels, { 'meal-plan': 'auto:sonnet', notes: 'claude-haiku-5-5' });
  assert.equal(choiceFor(s, 'meal-plan'), 'auto:sonnet');
  assert.equal(choiceFor(s, 'study-tests'), 'auto:opus');
  assert.equal(choiceFor(s), 'auto:opus');
  assert.deepEqual(applyAiPatch(s, { taskModels: { 'meal-plan': '', notes: 'claude-haiku-5-5' } }).taskModels, { notes: 'claude-haiku-5-5' });
  assert.throws(() => applyAiPatch(s, { taskModels: { notes: 'bad model!' } }), AiSettingsError);
  assert.deepEqual(applyAiPatch(s, { provider: 'gemini' }).taskModels, {}, 'another provider’s models are dropped');
});

test('a job uses the model picked for its task', async () => {
  let used = '';
  const jobs = createAiJobs({
    loadSettings: async () => ({ ...ready, taskModels: { notes: 'claude-haiku-5-5' } }),
    providerFor: () => fakeProvider(async ({ model }) => { used = model; return 'x'; }),
  });
  const a = await jobs.start('user:a', 'hi', as('a'), 'notes');
  await settle(jobs, 'user:a', a.id);
  assert.equal(used, 'claude-haiku-5-5');
  const b = await jobs.start('user:a', 'hi', as('a'), 'meal-plan');
  await settle(jobs, 'user:a', b.id);
  assert.equal(used, 'claude-opus-5-5', 'the default, Newest Opus, with no list yet');
});

test('the model list is fetched once a day, and an old one is used if the provider can’t be reached', async () => {
  const settings = { ...ready, scope: 'site' };
  let calls = 0;
  let fail = false;
  const provider: Provider = {
    ...fakeProvider(async () => 'x'),
    listModels: async () => { calls++; if (fail) throw new AiError('network', 'down'); return [{ id: 'claude-opus-9', label: 'Claude Opus 9', createdAt: '2030-01-01T00:00:00Z' }]; },
  };
  const t0 = Date.parse('2026-11-20T12:00:00Z');
  const first = await currentCatalog(settings, provider, t0);
  assert.equal(first?.models[0].id, 'claude-opus-9');
  assert.equal(modelForTask(settings, first).id, 'claude-opus-9', 'Newest Opus follows the list');
  await currentCatalog(settings, provider, t0 + 60 * 60_000);
  assert.equal(calls, 1, 'an hour later the saved list is used');
  fail = true;
  const stale = await currentCatalog(settings, provider, t0 + 25 * 60 * 60_000);
  assert.equal(calls, 2, 'a day later it asks again');
  assert.equal(stale?.models[0].id, 'claude-opus-9', 'and keeps the old list when that fails');
  // A different key (or provider) never reuses another's list.
  assert.equal(await savedCatalog({ ...settings, apiKey: 'sk-ant-other' }), null);
});

// ── Keys per account, set by the admin ────────────────────────────────────────

test('an account’s own key is used before the site’s, and only the admin sets it', () => {
  const s = applyAiPatch({ ...defaultAiSettings(), apiKey: 'sk-ant-site', allowedUserIds: ['wife'] }, {
    accounts: { wife: { provider: 'gemini', apiKey: 'AIza-wife', taskModels: { 'study-tests': 'auto:flash-lite' } } },
  });
  assert.throws(() => applyAiPatch(s, { accounts: { '../bad id': {} } }), AiSettingsError, 'odd ids are refused');
  const wife = connectionFor(s, { userId: 'wife', isAdmin: false });
  assert.equal(wife?.apiKey, 'AIza-wife');
  assert.equal(wife?.provider, 'gemini');
  assert.equal(wife?.scope, 'user:wife');
  assert.equal(choiceFor(wife!, 'study-tests'), 'auto:flash-lite');
  assert.equal(connectionFor(s, { userId: null, isAdmin: true })?.apiKey, 'sk-ant-site', 'Admin uses the site key');
  assert.equal(connectionFor(s, { userId: 'partner', isAdmin: false }), null, 'nobody else gets anything');
});

test('without its own key an account falls back to the site key only if it’s allowed', () => {
  const s = applyAiPatch({ ...defaultAiSettings(), apiKey: 'sk-ant-site' }, { accounts: { wife: { provider: 'gemini' } } });
  assert.equal(connectionFor(s, { userId: 'wife', isAdmin: false }), null);
  const allowed = applyAiPatch(s, { allowedUserIds: ['wife'] });
  assert.equal(connectionFor(allowed, { userId: 'wife', isAdmin: false })?.scope, 'site');
  // Switched off means off for everyone, own keys included.
  const off = applyAiPatch(applyAiPatch(s, { accounts: { wife: { apiKey: 'AIza-wife' } } }), { enabled: false });
  assert.equal(connectionFor(off, { userId: 'wife', isAdmin: false }), null);
});

test('an account’s key follows the same rules: new provider forgets it, remove takes it away', () => {
  const s = applyAiPatch(defaultAiSettings(), { accounts: { wife: { provider: 'gemini', apiKey: 'AIza-wife' } } });
  assert.equal(applyAiPatch(s, { accounts: { wife: { provider: 'anthropic' } } }).accounts.wife.apiKey, '');
  assert.equal(applyAiPatch(s, { accounts: { wife: { model: 'gemini-3.6-flash' } } }).accounts.wife.apiKey, 'AIza-wife', 'a blank key keeps it');
  assert.deepEqual(applyAiPatch(s, { accounts: { wife: { remove: true } } }).accounts, {});
  assert.throws(() => applyAiPatch(s, { accounts: { wife: { apiKey: 'has spaces' } } }), AiSettingsError);
  const pub = toPublic(s);
  assert.equal(pub.accounts.wife.keyHint, '…wife');
  assert.ok(!JSON.stringify(pub).includes('AIza-wife'), 'the admin page never gets an account’s key either');
});

test('a job runs on the account’s own key and provider', async () => {
  let seen = '';
  const jobs = createAiJobs({
    loadSettings: async () => applyAiPatch({ ...ready }, { accounts: { c: { provider: 'gemini', apiKey: 'AIza-c' } } }),
    providerFor: (id) => fakeProvider(async ({ apiKey, model }) => { seen = `${id}|${apiKey}|${model}`; return 'x'; }),
  });
  const { id } = await jobs.start('user:c', 'hi', as('c'), 'study-tests');
  await settle(jobs, 'user:c', id);
  assert.equal(seen, 'gemini|AIza-c|gemini-3.8-flash');
});

test('deleting an account forgets its AI settings', async () => {
  await saveAiSettings({ enabled: true, allowedUserIds: ['gone', 'stays'], accounts: { gone: { provider: 'gemini', apiKey: 'AIza-gone' } } });
  await forgetAiAccount('gone');
  const s = await getAiSettings();
  assert.deepEqual(s.allowedUserIds, ['stays']);
  assert.equal(s.accounts.gone, undefined);
});

// ── Replies ───────────────────────────────────────────────────────────────────

const lines = (...l: string[]) => l.join('\n');

test('a code fence around the whole reply is taken off', () => {
  assert.equal(stripCodeFence(lines('```json', '{"a": 1}', '```')), '{"a": 1}');
  assert.equal(stripCodeFence('  ```JSON\r\n{"a": 1}\r\n```  \n'), '{"a": 1}');
  assert.equal(stripCodeFence(lines('```markdown', '- **Point:** one', '  - two', '```')), lines('- **Point:** one', '  - two'));
  assert.equal(stripCodeFence(lines('```', 'plain', '```')), 'plain');
  assert.equal(stripCodeFence(lines('~~~', '{"a": 1}', '~~~')), '{"a": 1}');
  assert.equal(stripCodeFence(lines('````md', 'Some *notes*', '````')), 'Some *notes*');
  // Markdown wrapped whole, with a code sample of its own inside.
  assert.equal(stripCodeFence(lines('```markdown', '# Notes', '```js', 'let a = 1;', '```', 'Done.', '```')), lines('# Notes', '```js', 'let a = 1;', '```', 'Done.'));
  // A reply that ran out of room before the closing fence.
  assert.equal(stripCodeFence(lines('```json', '{"a": [1, 2')), '{"a": [1, 2');
});

test('a short lead-in before the one block is dropped with the fence', () => {
  assert.equal(stripCodeFence(lines('Here’s the JSON:', '```json', '{"a": 1}', '```')), '{"a": 1}');
  assert.equal(stripCodeFence(lines('Sure! Here you go:', '', '```', '- one', '- two', '```')), lines('- one', '- two'));
  assert.equal(stripCodeFence(lines('Sure thing', '```json', '[1, 2]', '```')), '[1, 2]');
});

test('fences that are part of the content are left alone', () => {
  const same = (text: string) => assert.equal(stripCodeFence(text), text);
  same('{"a": 1}');
  same(lines('```json', '{"a": 1}', '```', '', 'And the second:', '', '```json', '{"b": 2}', '```'));
  same(lines('To list files, run this', '```bash', 'ls -la', '```'));
  same(lines('Here’s the JSON:', '```json', '{"a": 1}', '```', 'Let me know if you want changes.'));
  same(lines(`${'A long opening paragraph that explains things. '.repeat(5)}:`, '```json', '{}', '```'));
  same('Use ```code``` sparingly.');
});

