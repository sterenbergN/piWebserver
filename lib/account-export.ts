import crypto from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import { walk } from '@/lib/backup';
import { choresFile, findHousehold } from '@/lib/chores/households';
import { readFeedback, readUserDaily } from '@/lib/daily/store';
import { folder as privatePostsFolder } from '@/lib/journal/private-posts';
import { householdKitchenFile, personalKitchenFile } from '@/lib/recipes/kitchen-store';
import { getWorkoutData } from '@/lib/workout/data';
import { isPhotoId, photoPath } from '@/lib/workout/photos';
import { SESSIONS_FILE, type SharedSession } from '@/lib/workout/shared-session';
import { findWorkoutUser, toSafeUser } from '@/lib/workout/users';
import { ZipWriter } from '@/lib/zip-stream';

// "Download my data": a zip of one account's data, and only that account's.
// Everything here is an allow-list: a file is named from the account's own id or
// household, and a store shared between accounts only hands over records that
// say they're this account's. A new data file stays out until it's added here.

type Item = { entry: string; file: string } | { entry: string; json: unknown };

/** Shared workout files holding one list, with the field that says whose each record is. */
const OWNED_RECORDS: [file: string, key: string, owner: 'userId' | 'ownerId'][] = [
  ['history.json', 'history', 'userId'],
  ['bodyweight.json', 'entries', 'userId'],
  ['calibration.json', 'calibrations', 'userId'],
  ['gyms.json', 'gyms', 'ownerId'],
  ['workout_types.json', 'types', 'ownerId'],
  ['programs.json', 'programs', 'ownerId'],
  ['goals.json', 'goals', 'ownerId'],
  ['workout-shares.json', 'shares', 'ownerId'],
];

/** Half-written exports wait here, on the data drive (a Pi's /tmp can be RAM). Backups skip `.tmp` files. */
const tempDir = () => path.join(process.cwd(), '.data', 'account-exports');
/** Left behind by a crash mid-download. */
const STALE_MS = 24 * 60 * 60 * 1000;

const perUserFile = (folder: string, userId: string) => path.join(process.cwd(), '.data', folder, `${userId}.json`);

/** A partner's progress and plan stay theirs: what you did in a shared session, and the plan only if you hosted. */
function ownSessionView(session: SharedSession, userId: string) {
  const me = session.participants?.find((p) => p.userId === userId);
  if (!me) return [];
  const hostedByMe = session.hostUserId === userId;
  const { name, gymName } = session.planTemplate ?? {};
  return [{
    id: session.id,
    status: session.status,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    hostedByMe,
    planTemplate: hostedByMe ? session.planTemplate : { name, gymName },
    joinedAt: me.joinedAt,
    progress: me.progress,
  }];
}

async function workoutItems(userId: string): Promise<Item[]> {
  const items: Item[] = [];
  const user = await findWorkoutUser(userId);
  if (user) items.push({ entry: 'workouts/profile.json', json: toSafeUser(user) });

  const photos = new Set<string>();
  for (const [file, key, owner] of OWNED_RECORDS) {
    const stored = await getWorkoutData<Record<string, unknown>>(file, {});
    const list: any[] = Array.isArray(stored[key]) ? stored[key] : [];
    const mine = list.filter((record) => record?.[owner] === userId);
    if (!mine.length) continue;
    items.push({ entry: `workouts/${file}`, json: { [key]: mine } });
    if (file !== 'gyms.json') continue;
    for (const gym of mine) for (const station of gym.stations ?? []) {
      // A station's photo id comes from the browser: never let it name a path.
      if (typeof station?.photo === 'string' && isPhotoId(station.photo)) photos.add(station.photo);
    }
  }
  for (const id of photos) items.push({ entry: `workouts/photos/${id}.webp`, file: photoPath(id) });

  const health = await getWorkoutData<{ users?: Record<string, any> }>('health.json', {});
  if (health.users?.[userId]) {
    const { keyHash, ...rest } = health.users[userId];
    items.push({ entry: 'workouts/health.json', json: rest });
  }
  const kinds = await getWorkoutData<{ users?: Record<string, unknown> }>('equipment-kinds.json', {});
  if (kinds.users?.[userId]) items.push({ entry: 'workouts/equipment-kinds.json', json: kinds.users[userId] });

  const sessions = await getWorkoutData<{ sessions?: SharedSession[] }>(SESSIONS_FILE, {});
  const mySessions = (sessions.sessions ?? []).flatMap((session) => ownSessionView(session, userId));
  if (mySessions.length) items.push({ entry: 'workouts/shared-sessions.json', json: { sessions: mySessions } });
  return items;
}

/** Everything that goes in this account's zip. Files that don't exist are left out when it's written. */
export async function collectAccountItems(userId: string): Promise<Item[]> {
  if (!/^[\w-]{1,64}$/.test(userId)) throw new Error('Invalid account');

  const postsDir = privatePostsFolder(userId);
  const posts = (await walk(postsDir))
    .filter((file) => !file.endsWith('.tmp'))
    .map((file) => ({ entry: `private-posts/${path.relative(postsDir, file).split(path.sep).join('/')}`, file }));

  const daily = await readUserDaily(userId);
  const feedback = (await readFeedback()).entries?.filter((entry) => entry.userId === userId) ?? [];

  // Read-only: signing in to download shouldn't make a household or move a kitchen.
  const household = await findHousehold(userId);

  return [
    { entry: 'journal.json', file: perUserFile('journal', userId) },
    ...posts,
    { entry: 'habits.json', file: perUserFile('habits', userId) },
    { entry: 'daily/answers.json', json: daily },
    ...(feedback.length ? [{ entry: 'daily/feedback.json', json: { entries: feedback } }] : []),
    { entry: 'loop-lab-notebook.json', file: perUserFile('loop-lab', userId) },
    { entry: 'kitchen/personal.json', file: personalKitchenFile(userId) },
    ...(household ? [
      { entry: 'kitchen/household.json', file: householdKitchenFile(household.id) },
      { entry: 'chores.json', file: choresFile(household.id) },
    ] : []),
    ...(await workoutItems(userId)),
  ];
}

async function clearStaleExports(dir: string) {
  for (const name of await fs.readdir(dir).catch(() => [] as string[])) {
    const file = path.join(dir, name);
    const stat = await fs.stat(file).catch(() => null);
    if (stat && Date.now() - stat.mtimeMs > STALE_MS) await fs.rm(file, { force: true });
  }
}

/** Write this account's zip to a temp file and return its path. The caller deletes it. */
export async function writeAccountExport(userId: string): Promise<string> {
  const items = await collectAccountItems(userId);
  const dir = tempDir();
  await fs.mkdir(dir, { recursive: true });
  await clearStaleExports(dir);
  const target = path.join(dir, `${crypto.randomBytes(12).toString('hex')}.zip.tmp`);
  const zip = await ZipWriter.create(target);
  try {
    const included: string[] = [];
    for (const item of items) {
      if ('json' in item) {
        await zip.addBuffer(item.entry, Buffer.from(JSON.stringify(item.json, null, 2)));
        included.push(item.entry);
      } else if ((await zip.addFile(item.entry, item.file)) !== null) {
        included.push(item.entry);
      }
    }
    await zip.addBuffer('manifest.json', Buffer.from(JSON.stringify({ exportedAt: new Date().toISOString(), files: included }, null, 2)));
    await zip.close();
    return target;
  } catch (error) {
    await zip.abort();
    await fs.rm(target, { force: true });
    throw error;
  }
}
