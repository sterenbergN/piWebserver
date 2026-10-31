import path from 'path';
import { readJson, updateJson } from '@/lib/json-store';
import { emptyProgress, emptyTests, normalizeProgress, normalizeTests, type ProgressData, type TestsData } from './study';

// One folder per account in .data/study (kept by backups). The tests themselves
// change rarely and can get large, so saving your place in a test only rewrites
// the small progress file.

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
