import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';

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

// ─── Per-file write lock ───────────────────────────────────────────────────────
// Every mutation is read → modify → write. Without serialization two concurrent
// requests (e.g. both partners in a shared session) read the same snapshot and
// the second write silently discards the first.

const fileLocks = new Map<string, Promise<unknown>>();

async function withFileLock<R>(filename: string, fn: () => Promise<R>): Promise<R> {
  const previous = fileLocks.get(filename) || Promise.resolve();
  const run = previous.catch(() => {}).then(fn);
  const tail = run.catch(() => {});
  fileLocks.set(filename, tail);
  try {
    return await run;
  } finally {
    if (fileLocks.get(filename) === tail) fileLocks.delete(filename);
  }
}

async function readJsonFile<T>(filename: string, defaultData: T): Promise<T> {
  await ensureWorkoutDir();
  const filePath = resolveDataPath(filename);
  let raw: string;
  try {
    raw = await fs.readFile(filePath, 'utf-8');
  } catch (error: any) {
    if (error?.code === 'ENOENT') return structuredClone(defaultData);
    throw error;
  }

  if (!raw.trim()) return structuredClone(defaultData);

  try {
    return JSON.parse(raw);
  } catch (error) {
    // Never fall back to the default here: the caller would then save the empty
    // default over the user's real (if damaged) data. Keep a copy and fail loudly.
    const backupPath = `${filePath}.corrupt-${Date.now()}`;
    await fs.copyFile(filePath, backupPath).catch(() => {});
    console.error(`Workout data file ${filename} is not valid JSON; a copy was saved to ${backupPath}`);
    throw error;
  }
}

async function writeJsonFileAtomic<T>(filename: string, data: T) {
  await ensureWorkoutDir();
  const filePath = resolveDataPath(filename);
  // Write to a temp file then rename so a crash or power loss mid-write (not
  // unusual on a Raspberry Pi) can never leave a truncated JSON file behind.
  const tmpPath = `${filePath}.${crypto.randomBytes(6).toString('hex')}.tmp`;
  try {
    await fs.writeFile(tmpPath, JSON.stringify(data, null, 2));
    await fs.rename(tmpPath, filePath);
  } catch (error) {
    await fs.unlink(tmpPath).catch(() => {});
    throw error;
  }
}

export async function getWorkoutData<T>(filename: string, defaultData: T): Promise<T> {
  return readJsonFile(filename, defaultData);
}

export async function saveWorkoutData<T>(filename: string, data: T): Promise<boolean> {
  try {
    await withFileLock(filename, () => writeJsonFileAtomic(filename, data));
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
  return withFileLock(filename, async () => {
    const data = await readJsonFile(filename, defaultData);
    const result = await mutator(data);
    if ((result as unknown) !== false) {
      await writeJsonFileAtomic(filename, data);
    }
    return result;
  });
}

/** Short random id for new records. */
export function generateId() {
  return crypto.randomBytes(6).toString('base64url');
}
