import fs from 'fs/promises';
import path from 'path';
import { readJson, updateJson, writeJsonAtomic } from '@/lib/json-store';
import { emptyMap, normalizeMap, type AnkiData, type MapData } from './coverage';
import { eatTest, emptyPlan, normalizePlan, noteClean, type PlanData } from './plan';
import { dueMisses, emptyProgress, emptyTests, normalizeProgress, normalizeTests, type ProgressData, type TestsData } from './study';

// One folder per account in .data/study (kept by backups). The tests themselves
// change rarely and can get large, so saving your place in a test only rewrites
// the small progress file. Classes and deck matches are in map.json, and the
// numbers from the last Anki import in anki.json. The planner is in plan.json.

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
