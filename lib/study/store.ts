import fs from 'fs/promises';
import path from 'path';
import { readJson, updateJson, writeJsonAtomic } from '@/lib/json-store';
import { emptyMap, normalizeMap, type AnkiData, type MapData } from './coverage';
import { isExpired, isToken, type PartnerSession } from './partner';
import { eatTest, emptyPlan, normalizePlan, noteClean, type PlanData } from './plan';
import { emptyPractice, normalizePractice, type PracticeData } from './practice';
import { emptyShares, normalizeShares, type Share, type SharesData } from './sharing';
import { studyXp } from './xp';
import { dueMisses, emptyProgress, emptyTests, normalizeProgress, normalizeTests, type ProgressData, type TestsData } from './study';

// One folder per account in .data/study (kept by backups). The tests themselves
// change rarely and can get large, so saving your place in a test only rewrites
// the small progress file. Classes and deck matches are in map.json, and the
// numbers from the last Anki import in anki.json. The planner is in plan.json,
// and grids, patient cases and Differential are in practice.json.

export function studyFolder(userId: string) {
  if (!/^[\w-]{1,64}$/.test(userId)) throw new Error('Invalid account');
  return path.join(process.cwd(), '.data', 'study', userId);
}

const testsFile = (userId: string) => path.join(studyFolder(userId), 'tests.json');
const progressFile = (userId: string) => path.join(studyFolder(userId), 'progress.json');

export const readTests = async (userId: string) => normalizeTests(await readJson<Partial<TestsData>>(testsFile(userId), emptyTests()));
export const readProgress = async (userId: string) => normalizeProgress(await readJson<Partial<ProgressData>>(progressFile(userId), emptyProgress()));

export function updateTests<R>(userId: string, mutate: (data: TestsData) => R) {
  return updateJson<TestsData, R>(testsFile(userId), emptyTests(), (stored) => {
    Object.assign(stored, normalizeTests(stored));
    return mutate(stored);
  });
}

export function updateProgress<R>(userId: string, mutate: (data: ProgressData) => R) {
  return updateJson<ProgressData, R>(progressFile(userId), emptyProgress(), (stored) => {
    Object.assign(stored, normalizeProgress(stored));
    return mutate(stored);
  });
}

const mapFile = (userId: string) => path.join(studyFolder(userId), 'map.json');
const ankiFile = (userId: string) => path.join(studyFolder(userId), 'anki.json');

export const readMap = async (userId: string) => normalizeMap(await readJson<Partial<MapData>>(mapFile(userId), emptyMap()));

export function updateMap<R>(userId: string, mutate: (data: MapData) => R) {
  return updateJson<MapData, R>(mapFile(userId), emptyMap(), (stored) => {
    Object.assign(stored, normalizeMap(stored));
    return mutate(stored);
  });
}

export const readAnki = (userId: string) => readJson<AnkiData | null>(ankiFile(userId), null);
export const writeAnki = (userId: string, data: AnkiData) => writeJsonAtomic(ankiFile(userId), data);
export const removeAnki = (userId: string) => fs.rm(ankiFile(userId), { force: true });

const planFile = (userId: string) => path.join(studyFolder(userId), 'plan.json');

export const readPlan = async (userId: string) => normalizePlan(await readJson<Partial<PlanData>>(planFile(userId), emptyPlan()));

/** Wrapped, since a mutator answering `false` (not a clean plate today) would otherwise tell updateJson to skip the write. */
export async function updatePlan<R>(userId: string, mutate: (data: PlanData) => R): Promise<R> {
  const { result } = await updateJson<PlanData, { result: R }>(planFile(userId), emptyPlan(), (stored) => {
    Object.assign(stored, normalizePlan(stored));
    return { result: mutate(stored) };
  });
  return result;
}

/** Work done here counts by itself: a handed-in test eats its pancakes, and clearing reviews or playing can clean the plate. */
export async function afterStudying(userId: string, today: string, testId?: string) {
  const progress = await readProgress(userId);
  await updatePlan(userId, (plan) => {
    if (testId) eatTest(plan, testId, today);
    noteClean(plan, today, dueMisses(progress, today).length, progress.reviewDays.includes(today));
  });
}

const practiceFile = (userId: string) => path.join(studyFolder(userId), 'practice.json');

export const readPractice = async (userId: string) => normalizePractice(await readJson<Partial<PracticeData>>(practiceFile(userId), emptyPractice()));

export async function updatePractice<R>(userId: string, mutate: (data: PracticeData) => R): Promise<R> {
  const { result } = await updateJson<PracticeData, { result: R }>(practiceFile(userId), emptyPractice(), (stored) => {
    Object.assign(stored, normalizePractice(stored));
    return { result: mutate(stored) };
  });
  return result;
}

const sharesFile = (userId: string) => path.join(studyFolder(userId), 'shares.json');

export const readShares = async (userId: string) => normalizeShares(await readJson<Partial<SharesData>>(sharesFile(userId), emptyShares()));

export function updateShares<R>(userId: string, mutate: (data: SharesData) => R) {
  return updateJson<SharesData, { result: R }>(sharesFile(userId), emptyShares(), (stored) => {
    Object.assign(stored, normalizeShares(stored));
    return { result: mutate(stored) };
  }).then((out) => out.result);
}

/** Every account's shares, for the shared list and for opening a link. Only read here, never changed. */
export async function everyShare(): Promise<{ ownerId: string; share: Share }[]> {
  const root = path.join(process.cwd(), '.data', 'study');
  const folders = await fs.readdir(root, { withFileTypes: true }).catch(() => []);
  const owners = folders.filter((f) => f.isDirectory() && /^[\w-]{1,64}$/.test(f.name)).map((f) => f.name);
  // One account's damaged file (already logged by the read) mustn't take the shared list down for everyone.
  const lists = await Promise.all(owners.map(async (ownerId) => (await readShares(ownerId).catch(() => emptyShares())).shares.map((share) => ({ ownerId, share }))));
  return lists.flat();
}

/** A drill or a sitting counts as studying today, which is part of what cleans the plate. */
export async function noteStudied(userId: string, today: string) {
  await updateProgress(userId, (progress) => {
    if (!progress.reviewDays.includes(today)) progress.reviewDays.push(today);
  });
  await afterStudying(userId, today);
}

export async function readStudyXp(userId: string) {
  const [tests, progress, plan, practice] = await Promise.all([readTests(userId), readProgress(userId), readPlan(userId), readPractice(userId)]);
  return studyXp(tests, progress, plan, practice);
}

// Private links live outside the account folders, and outside backups: they only
// last a day. Each one's whole name is its random token.

const sessionsFolder = () => path.join(process.cwd(), '.data', 'study-sessions');
const sessionFile = (token: string) => {
  if (!isToken(token)) throw new Error('Invalid link');
  return path.join(sessionsFolder(), `${token}.json`);
};

/** The session for this link, unless it's run out. */
export async function readSession(token: string) {
  const session = await readJson<PartnerSession | null>(sessionFile(token), null);
  return session && !isExpired(session, new Date()) ? session : null;
}

export const writeNewSession = (session: PartnerSession) => writeJsonAtomic(sessionFile(session.token), session);

export async function updateSession<R>(token: string, mutate: (session: PartnerSession) => R): Promise<R | null> {
  // A link ended while this was on its way has nothing to update, and mustn't come back as an empty file.
  const out = await updateJson<PartnerSession, { result: R } | false>(sessionFile(token), {} as PartnerSession, (stored) => (stored.token ? { result: mutate(stored) } : false));
  return out ? out.result : null;
}

async function allSessions() {
  const names = await fs.readdir(sessionsFolder()).catch(() => [] as string[]);
  const tokens = names.flatMap((name) => (name.endsWith('.json') && isToken(name.slice(0, -5)) ? [name.slice(0, -5)] : []));
  // A damaged link counts as none: they only last a day, and this is how run-out ones get cleaned up.
  return Promise.all(tokens.map(async (token) => ({ token, session: await readJson<PartnerSession | null>(sessionFile(token), null).catch(() => null) })));
}

/** One link per account at a time: opening a new one, or ending it, closes the old. Run-out ones anyone left behind get cleaned up too. */
export async function endSessionsOf(userId: string, now: Date) {
  for (const { token, session } of await allSessions()) {
    if (!session || session.ownerId === userId || isExpired(session, now)) await fs.rm(sessionFile(token), { force: true });
  }
}

/** Her open link, if any, so she can come back to it. */
export async function liveSessionOf(userId: string) {
  const now = new Date();
  const found = (await allSessions()).find(({ session }) => session?.ownerId === userId && !isExpired(session, now));
  return found?.session ?? null;
}
