import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import { readJson, updateJson, withLock, writeJsonAtomic } from '../json-store';

const privateDir = () => path.join(process.cwd(), '.data', 'workouts');
const legacyDir = () => path.join(process.cwd(), 'public', 'uploads', 'workouts');

async function migrateLegacyWorkoutData(targetDir: string) {
  const sourceDir = legacyDir();

  try {
    const entries = await fs.readdir(sourceDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      const sourcePath = path.join(sourceDir, entry.name);
      const targetPath = path.join(targetDir, entry.name);

      try {
        await fs.access(targetPath);
      } catch {
        await fs.copyFile(sourcePath, targetPath);
      }

      await fs.unlink(sourcePath).catch(() => {});
    }
  } catch {
    // No legacy directory to migrate from.
  }
}

const getDir = () => privateDir();

// Directory creation + legacy migration only needs to happen once per process
// (per data directory), not on every read and write.
const ensuredDirs = new Map<string, Promise<void>>();

export function ensureWorkoutDir() {
  const dir = getDir();
  let pending = ensuredDirs.get(dir);
  if (!pending) {
    pending = (async () => {
      await fs.mkdir(dir, { recursive: true });
      await migrateLegacyWorkoutData(dir);
    })().catch((error) => {
      ensuredDirs.delete(dir);
      throw error;
    });
    ensuredDirs.set(dir, pending);
  }
  return pending;
}

function resolveDataPath(filename: string) {
  // Filenames are fixed strings in code, but guard against path traversal anyway.
  if (filename !== path.basename(filename)) {
    throw new Error(`Invalid workout data filename: ${filename}`);
  }
  return path.join(getDir(), filename);
}

// ─── Reading and writing ───────────────────────────────────────────────────────
// The shared store (lib/json-store.ts) does the work: a per-file lock, because
// every mutation is read → modify → write and two concurrent requests (e.g. both
// partners in a shared session) would otherwise drop each other's changes; atomic
// writes; and reads that fail loudly on a damaged file instead of handing back
// the default, which the caller would then save over the user's real data.

export async function getWorkoutData<T>(filename: string, defaultData: T): Promise<T> {
  await ensureWorkoutDir();
  // A copy, so a caller that changes what it gets back can't change the default.
  return readJson(resolveDataPath(filename), structuredClone(defaultData));
}

export async function saveWorkoutData<T>(filename: string, data: T): Promise<boolean> {
  try {
    await ensureWorkoutDir();
    const file = resolveDataPath(filename);
    await withLock(file, () => writeJsonAtomic(file, data, true));
    return true;
  } catch (error) {
    console.error(`Error writing ${filename}:`, error);
    return false;
  }
}

/**
 * Atomically read, modify and write a data file.
 *
 * The mutator receives the current contents and may modify them in place.
 * Return `false` from the mutator to skip the write (e.g. validation failed or
 * nothing changed). Any other return value is passed back to the caller.
 */
export async function updateWorkoutData<T, R = void>(
  filename: string,
  defaultData: T,
  mutator: (data: T) => R | Promise<R>,
): Promise<R> {
  await ensureWorkoutDir();
  return updateJson(resolveDataPath(filename), structuredClone(defaultData), mutator, true);
}

/** Short random id for new records. */
export function generateId() {
  return crypto.randomBytes(6).toString('base64url');
}
