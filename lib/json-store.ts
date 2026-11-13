import crypto from 'crypto';
import { constants } from 'fs';
import fs from 'fs/promises';
import path from 'path';

// The JSON-file store behind all site data (the workout module's own helpers sit
// on top of it): reads that fall back on a default only when there's nothing
// saved yet, atomic writes (never a half-written file), and a per-file lock so
// concurrent read-modify-write updates can't drop each other.

const locks = new Map<string, Promise<unknown>>();

/** Run `fn` while holding the lock for `file`, for changes updateJson can't make (like deleting it). */
export async function withLock<R>(file: string, fn: () => Promise<R>): Promise<R> {
  const previous = locks.get(file) || Promise.resolve();
  const run = previous.catch(() => {}).then(fn);
  const tail = run.catch(() => {});
  locks.set(file, tail);
  try {
    return await run;
  } finally {
    if (locks.get(file) === tail) locks.delete(file);
  }
}

/**
 * Keep a copy of a file that can't be read as JSON. Its modified time is in the
 * name, so a damaged file gets one copy however many times it's read, not one
 * per visit until the drive is full. (The name doesn't end in .json, so folder
 * listings that look for data files pass over it.)
 */
async function keepDamagedCopy(file: string) {
  const stat = await fs.stat(file).catch(() => null);
  const copy = `${file}.corrupt-${Math.round(stat?.mtimeMs ?? Date.now())}`;
  await fs.copyFile(file, copy, constants.COPYFILE_EXCL).catch(() => {});
  return copy;
}

/**
 * What's saved in `file`, or `fallback` when nothing has been saved yet (no
 * file, or an empty one).
 *
 * Anything else throws: a file that's there but can't be read, or isn't valid
 * JSON. Handing back the fallback would look like "no data", and the next save
 * would then write that over the real (if damaged) data for good.
 */
export async function readJson<T>(file: string, fallback: T): Promise<T> {
  let raw: string;
  try {
    raw = await fs.readFile(file, 'utf-8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') return fallback;
    console.error(`Data file ${file} could not be read:`, error);
    throw error;
  }
  if (!raw.trim()) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch (error) {
    const copy = await keepDamagedCopy(file);
    console.error(`Data file ${file} is not valid JSON and was left as it is; a copy is at ${copy}`);
    // No path in the message: some routes pass an error's message on to the browser.
    throw new Error('A data file is damaged', { cause: error });
  }
}

/**
 * Windows won't replace a file while something has it open for reading, and says
 * EPERM or EBUSY for a moment; Linux (the Pi) never does. A few short retries
 * ride that out, so development on Windows behaves like the Pi.
 */
async function renameRetrying(from: string, to: string) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fs.rename(from, to);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException)?.code;
      if (attempt >= 6 || (code !== 'EPERM' && code !== 'EBUSY' && code !== 'EACCES')) throw error;
      await new Promise((resolve) => setTimeout(resolve, 15 * 2 ** attempt));
    }
  }
}

export async function writeJsonAtomic(file: string, data: unknown, pretty = false) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  // Write to a temp file then rename, so a crash or power loss mid-write (not
  // unusual on a Raspberry Pi) can never leave a truncated file behind.
  const tmp = `${file}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  try {
    await fs.writeFile(tmp, JSON.stringify(data, null, pretty ? 2 : undefined));
    await renameRetrying(tmp, file);
  } catch (error) {
    await fs.unlink(tmp).catch(() => {});
    throw error;
  }
}

/**
 * Read → mutate → write under a lock. Return `false` from the mutator to skip the write.
 * A damaged file stops it before the mutator runs, so nothing is written over it.
 */
export async function updateJson<T, R = void>(file: string, fallback: T, mutator: (data: T) => R | Promise<R>, pretty = false): Promise<R> {
  return withLock(file, async () => {
    const data = await readJson(file, fallback);
    const result = await mutator(data);
    if ((result as unknown) !== false) await writeJsonAtomic(file, data, pretty);
    return result;
  });
}
