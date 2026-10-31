import test, { after, before } from 'node:test';
import { strict as assert } from 'node:assert';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { NextRequest } from 'next/server';
import { GET } from '../app/api/account/export/route';
import { writeAccountExport } from './account-export';
import { householdKitchenFile, personalKitchenFile } from './recipes/kitchen-store';
import { createAdminAuthToken, createWorkoutAuthToken } from './security/auth';
import { readZipEntries, readZipEntry } from './zip-stream';

// Three accounts: Alice and Carol share a household, Bob has his own. Every
// store holds a marker naming its owner (ALICE-…, BOB-…, CAROL-…), so a leak of
// any record or file shows up as another account's marker inside the zip.

const ALICE_PHOTO = 'alicePhotoAlicePhoto1';
const BOB_PHOTO = 'bobPhotoBobPhotoBobPhoto';

const write = async (file: string, data: unknown) => {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, typeof data === 'string' ? data : JSON.stringify(data));
};
const data = (...parts: string[]) => path.join(process.cwd(), '.data', ...parts);
const workouts = (file: string) => data('workouts', file);

function participant(userId: string, marker: string) {
  return { userId, username: userId, joinedAt: `${marker}-joined`, progress: { currentLiftName: `${marker}-lift` } };
}

async function seed() {
  for (const [id, marker] of [['alice', 'ALICE'], ['bob', 'BOB'], ['carol', 'CAROL']]) {
    await write(data('journal', `${id}.json`), { entries: { '2026-01-01': { text: `${marker}-journal` } } });
    await write(data('habits', `${id}.json`), { habits: [{ name: `${marker}-habit` }] });
    await write(data('loop-lab', `${id}.json`), { entries: [{ name: `${marker}-notebook` }] });
    await write(data('daily', 'attempts', `${id}.json`), { attempts: [{ note: `${marker}-answer` }] });
    await write(data('private-posts', id, 'posts.json'), [{ id: 'post-one', markdown: `${marker}-post` }]);
    await write(data('private-posts', id, 'images', 'picture-1.webp'), `${marker}-picture`);
    await write(personalKitchenFile(id), { list: [`${marker}-old-kitchen`] });
  }
  await write(data('daily', 'feedback.json'), { entries: [
    { userId: 'alice', questionId: 'q1', report: { note: 'ALICE-feedback' } },
    { userId: 'bob', questionId: 'q1', report: { note: 'BOB-feedback' } },
  ] });
  // Other files in the daily folder belong to the site, not to anyone.
  await write(data('daily', 'notes.md'), 'SITE-notes');
  await write(data('daily', 'practice.json'), { questions: [{ id: 'SITE-practice' }] });

  await write(data('chores', 'households.json'), { households: [
    { id: 'home-shared', members: ['alice', 'carol'], invite: 'SITE-invite-shared', createdOn: '' },
    { id: 'home-bob', members: ['bob'], invite: 'BOB-invite', createdOn: '' },
  ] });
  await write(data('chores', 'home-shared.json'), { chores: [{ name: 'HOUSEHOLD-chore' }] });
  await write(data('chores', 'home-bob.json'), { chores: [{ name: 'BOB-chore' }] });
  await write(householdKitchenFile('home-shared'), { list: ['HOUSEHOLD-kitchen'] });
  await write(householdKitchenFile('home-bob'), { list: ['BOB-kitchen'] });

  await write(workouts('users.json'), { users: ['alice', 'bob', 'carol'].map((id) => ({
    id, username: `${id.toUpperCase()}-username`, password: 'SITE-password-hash', birthdate: '',
  })) });
  await write(workouts('history.json'), { history: [
    { id: 'h1', userId: 'alice', name: 'ALICE-workout' },
    { id: 'h2', userId: 'bob', name: 'BOB-workout' },
    { id: 'h3', name: 'SITE-workout-with-no-owner' },
  ] });
  await write(workouts('bodyweight.json'), { entries: [{ userId: 'alice', date: 'ALICE-weight' }, { userId: 'bob', date: 'BOB-weight' }] });
  await write(workouts('calibration.json'), { calibrations: [{ userId: 'alice', liftKey: 'ALICE-calibration' }, { userId: 'bob', liftKey: 'BOB-calibration' }] });
  await write(workouts('gyms.json'), { gyms: [
    { id: 'g1', ownerId: 'alice', name: 'ALICE-gym', stations: [
      { id: 's1', photo: ALICE_PHOTO },
      // A browser can save anything here: none of these may reach another file.
      { id: 's2', photo: '../../journal/bob' },
      { id: 's3', photo: '..\\..\\journal\\bob.json' },
      { id: 's4', photo: { path: '../../journal/bob' } },
    ] },
    // A public gym of Bob's is visible to everyone in the app, but is still Bob's.
    { id: 'g2', ownerId: 'bob', isPublic: true, name: 'BOB-gym', stations: [{ id: 's5', photo: BOB_PHOTO }] },
  ] });
  await write(workouts('workout_types.json'), { types: [{ ownerId: 'alice', name: 'ALICE-type' }, { ownerId: 'bob', isPublic: true, name: 'BOB-type' }] });
  await write(workouts('programs.json'), { programs: [{ ownerId: 'alice', name: 'ALICE-program' }, { ownerId: 'bob', isPublic: true, name: 'BOB-program' }] });
  await write(workouts('goals.json'), { goals: [{ ownerId: 'alice', exercise: 'ALICE-goal' }, { ownerId: 'bob', exercise: 'BOB-goal' }] });
  await write(workouts('workout-shares.json'), { shares: [{ ownerId: 'alice', token: 'ALICE-share' }, { ownerId: 'bob', token: 'BOB-share' }] });
  await write(workouts('health.json'), { users: {
    alice: { keyHash: 'SITE-key-hash', days: { d: 'ALICE-health' } },
    bob: { keyHash: 'SITE-key-hash', days: { d: 'BOB-health' } },
  } });
  await write(workouts('equipment-kinds.json'), { users: { alice: { dismissed: ['ALICE-kind'] }, bob: { dismissed: ['BOB-kind'] } } });
  await write(workouts('workout-sessions.json'), { sessions: [
    // Bob hosts, Alice joined: Alice gets what they did, not Bob's plan or progress.
    {
      id: 'partnered', code: 'SITE-session-code', hostUserId: 'bob', createdAt: '', updatedAt: '', status: 'active',
      planTemplate: { name: 'Push day', gymName: 'Downtown', lifts: [{ name: 'BOB-plan-lift' }] },
      participants: [participant('bob', 'BOB'), participant('alice', 'ALICE')],
    },
    {
      id: 'bob-alone', code: 'SITE-session-code', hostUserId: 'bob', createdAt: '', updatedAt: '', status: 'finished',
      planTemplate: { name: 'BOB-solo', lifts: [] },
      participants: [participant('bob', 'BOB')],
    },
  ] });
  await write(workouts(path.join('photos', `${ALICE_PHOTO}.webp`)), 'ALICE-machine-photo');
  await write(workouts(path.join('photos', `${BOB_PHOTO}.webp`)), 'BOB-machine-photo');
}

function request(cookie?: string) {
  return new NextRequest('http://localhost/api/account/export', cookie ? { headers: { cookie } } : undefined);
}
const signedIn = (token: string) => request(`workout_auth=${token}`);

/** Every entry of the zip the route answers with, read back through a file. */
async function download(userId: string, req = signedIn(createWorkoutAuthToken(userId))) {
  const response = await GET(req);
  assert.equal(response.status, 200);
  const zipFile = path.join(os.tmpdir(), `export-test-${process.pid}-${userId}.zip`);
  await fs.writeFile(zipFile, Buffer.from(await response.arrayBuffer()));
  try {
    const entries = await readZipEntries(zipFile);
    const files = new Map<string, string>();
    for (const entry of entries) files.set(entry.name, (await readZipEntry(zipFile, entry)).toString('utf-8'));
    return { response, files, everything: [...files].map(([name, text]) => `${name}\n${text}`).join('\n') };
  } finally {
    await fs.rm(zipFile, { force: true });
  }
}

const original = process.cwd();
let dir = '';

before(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'account-export-'));
  process.chdir(dir);
  await seed();
});

after(async () => {
  process.chdir(original);
  await fs.rm(dir, { recursive: true, force: true });
});

test('signed-out requests get a 401 and no data', async () => {
  const response = await GET(request());
  assert.equal(response.status, 401);
  assert.ok(!(await response.text()).includes('ALICE'));
});

test('a forged, wrong-role or dead cookie gets a 401', async () => {
  const good = createWorkoutAuthToken('alice');
  const [payload, signature] = good.split('.');
  // Bob's id with Alice's signature: the id in a cookie is only believed when it's signed.
  const swapped = Buffer.from(Buffer.from(payload, 'base64url').toString().replace('alice', 'bob')).toString('base64url');
  const cases = [
    'garbage',
    `${swapped}.${signature}`,
    `${payload}.${signature.slice(0, -2)}xx`,
    createAdminAuthToken(),
    createWorkoutAuthToken('deleted-account'),
    createWorkoutAuthToken('../journal/bob'),
  ];
  for (const token of cases) assert.equal((await GET(signedIn(token))).status, 401, token);
  // The site admin has no account here, so the admin cookie alone doesn't open it either.
  assert.equal((await GET(request(`pi_auth=${createAdminAuthToken()}`))).status, 401);
});

test('the id in the query string or a header means nothing', async () => {
  const req = new NextRequest('http://localhost/api/account/export?userId=bob&id=bob', {
    headers: { cookie: `workout_auth=${createWorkoutAuthToken('alice')}`, 'x-user-id': 'bob' },
  });
  const { everything } = await download('alice', req);
  assert.ok(everything.includes('ALICE-journal'));
  assert.ok(!everything.includes('BOB'));
});

test('an account id that is not a plain name is refused before any path is built', async () => {
  await assert.rejects(writeAccountExport('../journal/bob'), /Invalid account/);
  await assert.rejects(writeAccountExport('..'), /Invalid account/);
});

test('every store of a user lands in their export', async () => {
  const { files, everything, response } = await download('alice');
  assert.equal(response.headers.get('content-type'), 'application/zip');
  assert.match(response.headers.get('content-disposition') || '', /^attachment; filename="my-data-\d{4}-\d{2}-\d{2}\.zip"$/);
  assert.equal(response.headers.get('cache-control'), 'no-store, private');
  assert.deepEqual([...files.keys()].sort(), [
    'chores.json',
    'daily/answers.json',
    'daily/feedback.json',
    'habits.json',
    'journal.json',
    'kitchen/household.json',
    'kitchen/personal.json',
    'loop-lab-notebook.json',
    'manifest.json',
    'private-posts/images/picture-1.webp',
    'private-posts/posts.json',
    'workouts/bodyweight.json',
    'workouts/calibration.json',
    'workouts/equipment-kinds.json',
    'workouts/goals.json',
    'workouts/gyms.json',
    'workouts/health.json',
    'workouts/history.json',
    `workouts/photos/${ALICE_PHOTO}.webp`,
    'workouts/profile.json',
    'workouts/programs.json',
    'workouts/shared-sessions.json',
    'workouts/workout-shares.json',
    'workouts/workout_types.json',
  ]);
  for (const marker of [
    'ALICE-journal', 'ALICE-habit', 'ALICE-notebook', 'ALICE-answer', 'ALICE-feedback', 'ALICE-post', 'ALICE-picture', 'ALICE-old-kitchen',
    'HOUSEHOLD-chore', 'HOUSEHOLD-kitchen', 'ALICE-username', 'ALICE-workout', 'ALICE-weight', 'ALICE-calibration', 'ALICE-gym', 'ALICE-type',
    'ALICE-program', 'ALICE-goal', 'ALICE-share', 'ALICE-health', 'ALICE-kind', 'ALICE-lift', 'ALICE-machine-photo',
  ]) assert.ok(everything.includes(marker), `missing ${marker}`);
});

test('one account never gets another account\'s data, in either direction', async () => {
  const others: Record<string, string[]> = { alice: ['BOB', 'CAROL'], bob: ['ALICE', 'CAROL', 'HOUSEHOLD'], carol: ['ALICE', 'BOB'] };
  for (const [userId, markers] of Object.entries(others)) {
    const { files, everything } = await download(userId);
    assert.ok(files.size > 1);
    for (const marker of markers) assert.ok(!everything.includes(marker), `${userId}'s export includes ${marker}: ${everything.split('\n').filter((l) => l.includes(marker)).join(' | ')}`);
    // Bob's photo id only ever appears in Bob's gym; another account can't list it.
    if (userId !== 'bob') assert.ok(!everything.includes(BOB_PHOTO));
    if (userId !== 'alice') assert.ok(!everything.includes(ALICE_PHOTO));
  }
});

test('secrets and site files are left out, even for their own account', async () => {
  for (const userId of ['alice', 'bob', 'carol']) {
    const { everything } = await download(userId);
    assert.ok(!everything.includes('SITE-'), `${userId}'s export includes a site value: ${everything.split('\n').filter((l) => l.includes('SITE-')).join(' | ')}`);
  }
  // Loading users rehashes a seeded password, so look for the field rather than its value.
  const { files } = await download('alice');
  const profile = JSON.parse(files.get('workouts/profile.json')!);
  assert.equal(profile.id, 'alice');
  assert.ok(!('password' in profile));
  assert.ok(!('keyHash' in JSON.parse(files.get('workouts/health.json')!)));
});

test('a partner in a shared session stays out of it', async () => {
  const { files } = await download('alice');
  const { sessions } = JSON.parse(files.get('workouts/shared-sessions.json')!);
  assert.equal(sessions.length, 1);
  assert.equal(sessions[0].hostedByMe, false);
  assert.equal(sessions[0].planTemplate.name, 'Push day');
  assert.equal(sessions[0].planTemplate.lifts, undefined);
  assert.equal(sessions[0].progress.currentLiftName, 'ALICE-lift');
  assert.ok(!files.get('workouts/shared-sessions.json')!.includes('"bob"'));
});

test('household mates share the household\'s chores and kitchen, and leaving ends that', async () => {
  const carol = await download('carol');
  assert.ok(carol.files.get('chores.json')!.includes('HOUSEHOLD-chore'));
  assert.ok(carol.files.get('kitchen/household.json')!.includes('HOUSEHOLD-kitchen'));

  const index = data('chores', 'households.json');
  const saved = await fs.readFile(index, 'utf-8');
  await write(index, { households: [
    { id: 'home-shared', members: ['alice'], invite: null, createdOn: '' },
    { id: 'home-bob', members: ['bob'], invite: null, createdOn: '' },
  ] });
  try {
    const { everything } = await download('carol');
    assert.ok(!everything.includes('HOUSEHOLD'));
  } finally {
    await fs.writeFile(index, saved);
  }
});

test('a symlink planted in a private-posts folder is not followed', async (t) => {
  const link = data('private-posts', 'alice', 'images', 'link.webp');
  try {
    await fs.symlink(data('journal', 'bob.json'), link);
  } catch {
    t.skip('this machine does not allow symlinks');
    return;
  }
  try {
    const { everything } = await download('alice');
    assert.ok(!everything.includes('BOB-journal'));
  } finally {
    await fs.rm(link, { force: true });
  }
});

const tempFiles = async () => fs.readdir(data('account-exports')).catch(() => [] as string[]);

test('the temp zip is gone once downloaded, or once the download is cancelled', async () => {
  const waitUntilGone = async () => {
    for (let i = 0; i < 100 && (await tempFiles()).length; i++) await new Promise((r) => setTimeout(r, 10));
    assert.deepEqual(await tempFiles(), []);
  };

  const finished = await GET(signedIn(createWorkoutAuthToken('alice')));
  assert.equal((await tempFiles()).length, 1);
  await finished.arrayBuffer();
  await waitUntilGone();

  const cancelled = await GET(signedIn(createWorkoutAuthToken('alice')));
  assert.equal((await tempFiles()).length, 1);
  await cancelled.body!.cancel();
  await waitUntilGone();
});

test('a temp zip left by a crash is cleared by the next export, a fresh one is not', async () => {
  const stale = data('account-exports', 'crashed.zip.tmp');
  const fresh = data('account-exports', 'running.zip.tmp');
  await write(stale, 'left behind');
  await write(fresh, 'someone else downloading');
  const old = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
  await fs.utimes(stale, old, old);
  const made = await writeAccountExport('alice');
  const left = await tempFiles();
  assert.ok(!left.includes('crashed.zip.tmp'));
  assert.ok(left.includes('running.zip.tmp'));
  await fs.rm(made, { force: true });
  await fs.rm(fresh, { force: true });
});
