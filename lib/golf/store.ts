import fs from 'fs/promises';
import path from 'path';
import { readJson, updateJson, withLock, writeJsonAtomic } from '@/lib/json-store';
import { normalizeCourse, normalizeGolfUser } from './course';
import { canAccess, normalizeRound, summarize } from './round';
import type { Course, GolfUser, Round, RoundSummary } from './types';

// Golf data in .data/golf/ (backed up with the rest of .data):
//   rounds/<id>.json   one file per round, so saving a hole never rewrites every round
//   rounds-index.json  who played what, for lists and stats without opening every round
//   courses.json       shared by everyone
//   users/<userId>.json  each account's bag and settings

const root = () => path.join(process.cwd(), '.data', 'golf');
const isId = (id: string) => /^[\w-]{1,64}$/.test(id);

export const roundFile = (id: string) => {
  if (!isId(id)) throw new Error('Invalid round id');
  return path.join(root(), 'rounds', `${id}.json`);
};
const indexFile = () => path.join(root(), 'rounds-index.json');
const coursesFile = () => path.join(root(), 'courses.json');
export const golfUserFile = (userId: string) => {
  if (!isId(userId)) throw new Error('Invalid account');
  return path.join(root(), 'users', `${userId}.json`);
};
/** The old Tools scorecard's rounds, saved when signed in as admin. */
export const LEGACY_FILE = () => path.join(process.cwd(), '.data', 'golf-saved-games.json');
const legacyDoneFile = () => path.join(root(), 'legacy-imported.json');

type Index = { rounds: RoundSummary[] };

export async function readRound(id: string): Promise<Round | null> {
  if (!isId(id)) return null;
  return normalizeRound(await readJson<unknown>(roundFile(id), null));
}

async function writeIndexEntry(round: Round | null, id: string) {
  await updateJson<Index>(indexFile(), { rounds: [] }, (index) => {
    if (!Array.isArray(index.rounds)) index.rounds = [];
    index.rounds = index.rounds.filter((r) => r.id !== id);
    if (round) index.rounds.push(summarize(round));
  });
}

/**
 * Read → change → write one round under its file lock, keeping the index in step.
 * Return `round: undefined` to leave it as it was, or `null` to delete it.
 */
export function updateRound<R>(id: string, mutate: (round: Round | null) => { round?: Round | null; result: R } | Promise<{ round?: Round | null; result: R }>): Promise<R> {
  const file = roundFile(id);
  return withLock(file, async () => {
    const current = normalizeRound(await readJson<unknown>(file, null));
    const { round, result } = await mutate(current);
    if (round === undefined) return result;
    if (round) await writeJsonAtomic(file, round);
    else await fs.rm(file, { force: true });
    await writeIndexEntry(round, id);
    return result;
  });
}

export async function listRoundSummaries(userId: string): Promise<RoundSummary[]> {
  const index = await readJson<Index>(indexFile(), { rounds: [] });
  return (Array.isArray(index.rounds) ? index.rounds : [])
    .filter((r) => r.userIds?.includes(userId))
    .sort((a, b) => b.date.localeCompare(a.date));
}

/** Every round this account can see, newest first. */
export async function readRoundsFor(userId: string): Promise<Round[]> {
  const summaries = await listRoundSummaries(userId);
  const rounds = await Promise.all(summaries.map((s) => readRound(s.id)));
  return rounds.filter((r): r is Round => !!r && canAccess(r, userId));
}

export async function readCourses(): Promise<Course[]> {
  const data = await readJson<{ courses?: unknown[] }>(coursesFile(), { courses: [] });
  return (Array.isArray(data.courses) ? data.courses : []).map(normalizeCourse).filter((c): c is Course => !!c);
}

export function updateCourses<R>(mutate: (courses: Course[]) => R) {
  return updateJson<{ courses: Course[] }, R>(coursesFile(), { courses: [] }, (data) => {
    data.courses = (Array.isArray(data.courses) ? data.courses : []).map(normalizeCourse).filter((c): c is Course => !!c);
    return mutate(data.courses);
  });
}

export async function readGolfUser(userId: string): Promise<GolfUser> {
  return normalizeGolfUser(await readJson<unknown>(golfUserFile(userId), null));
}

export function updateGolfUser<R>(userId: string, mutate: (user: GolfUser) => R) {
  return updateJson<GolfUser, R>(golfUserFile(userId), normalizeGolfUser(null), (stored) => {
    Object.assign(stored, normalizeGolfUser(stored));
    return mutate(stored);
  });
}

/** The old admin scorecard's rounds, unless they've already been brought over. */
export async function readLegacyRounds(): Promise<unknown[] | null> {
  const done = await readJson<{ by?: string } | null>(legacyDoneFile(), null);
  if (done) return null;
  const games = await readJson<unknown>(LEGACY_FILE(), null);
  return Array.isArray(games) && games.length ? games : null;
}

export async function markLegacyImported(userId: string) {
  await writeJsonAtomic(legacyDoneFile(), { by: userId, at: new Date().toISOString() });
}
