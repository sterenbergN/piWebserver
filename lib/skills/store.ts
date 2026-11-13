import path from 'path';
import { readJson, updateJson } from '@/lib/json-store';
import { emptyProgress, emptySkills, type ProgressData, type SkillsData } from './types';

// One folder per account in .data/skills (kept by backups): skills.json holds the
// subjects with their topics, resources and questions; progress.json every answer
// and each question's review schedule, so answering only rewrites the small file.

export function skillsFolder(userId: string) {
  if (!/^[\w-]{1,64}$/.test(userId)) throw new Error('Invalid account');
  return path.join(process.cwd(), '.data', 'skills', userId);
}

const skillsFile = (userId: string) => path.join(skillsFolder(userId), 'skills.json');
const progressFile = (userId: string) => path.join(skillsFolder(userId), 'progress.json');

function normalizeSkills(raw: Partial<SkillsData> | null | undefined): SkillsData {
  return { subjects: Array.isArray(raw?.subjects) ? raw.subjects : [] };
}

function normalizeProgress(raw: Partial<ProgressData> | null | undefined): ProgressData {
  return {
    attempts: Array.isArray(raw?.attempts) ? raw.attempts : [],
    schedule: raw?.schedule && typeof raw.schedule === 'object' ? raw.schedule : {},
  };
}

export const readSkills = async (userId: string) => normalizeSkills(await readJson<Partial<SkillsData>>(skillsFile(userId), emptySkills()));
export const readSkillsProgress = async (userId: string) => normalizeProgress(await readJson<Partial<ProgressData>>(progressFile(userId), emptyProgress()));

/** Always written, whatever the mutator returns. */
export async function updateSkills<R>(userId: string, mutate: (data: SkillsData) => R): Promise<R> {
  const { result } = await updateJson<SkillsData, { result: R }>(skillsFile(userId), emptySkills(), (stored) => {
    Object.assign(stored, normalizeSkills(stored));
    return { result: mutate(stored) };
  });
  return result;
}

export async function updateSkillsProgress<R>(userId: string, mutate: (data: ProgressData) => R): Promise<R> {
  const { result } = await updateJson<ProgressData, { result: R }>(progressFile(userId), emptyProgress(), (stored) => {
    Object.assign(stored, normalizeProgress(stored));
    return { result: mutate(stored) };
  });
  return result;
}

/** Both files, skills first (the same order everywhere, so two requests can't wait on each other). */
export async function updateBoth<R>(userId: string, mutate: (data: SkillsData, progress: ProgressData) => R): Promise<R> {
  // The skills file waits for the progress change to finish (or throw) before it's written.
  const { result } = await updateJson<SkillsData, { result: R }>(skillsFile(userId), emptySkills(), async (stored) => {
    Object.assign(stored, normalizeSkills(stored));
    return { result: await updateSkillsProgress(userId, (progress) => mutate(stored, progress)) };
  });
  return result;
}
