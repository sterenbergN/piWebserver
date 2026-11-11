import path from 'path';
import { readJson, writeJsonAtomic, withLock } from '@/lib/json-store';
import { normalizeUserMovieState, type UserMovieState } from './movies-types';

export * from './movies-types';

export function userMovieFile(userId: string): string {
  if (!/^[\w-]{1,64}$/.test(userId)) throw new Error('Invalid account');
  return path.join(process.cwd(), '.data', 'movies', `${userId}.json`);
}

export async function loadUserMovieData(userId: string): Promise<UserMovieState> {
  const file = userMovieFile(userId);
  const raw = await readJson<unknown>(file, null);
  return normalizeUserMovieState(raw, userId);
}

export async function saveUserMovieData(userId: string, state: UserMovieState): Promise<UserMovieState> {
  const file = userMovieFile(userId);
  return withLock(file, async () => {
    const normalized = normalizeUserMovieState(
      {
        ...state,
        updatedAt: new Date().toISOString(),
      },
      userId,
      state.username
    );
    await writeJsonAtomic(file, normalized);
    return normalized;
  });
}
