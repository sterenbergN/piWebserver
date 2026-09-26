import crypto from 'crypto';
import fs from 'fs/promises';
import path from 'path';

// Small JSON-file store for site data outside the workout module: reads that
// fall back on a default, atomic writes (never a half-written file), and a
// per-file lock so concurrent read-modify-write updates can't drop each other.

const locks = new Map<string, Promise<unknown>>();

async function withLock<R>(file: string, fn: () => Promise<R>): Promise<R> {
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

export async function readJson<T>(file: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await fs.readFile(file, 'utf-8')) as T;
  } catch {
    return fallback;
  }
}

export async function writeJsonAtomic(file: string, data: unknown, pretty = false) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(data, null, pretty ? 2 : undefined));
  await fs.rename(tmp, file);
}

/** Read → mutate → write under a lock. Return `false` from the mutator to skip the write. */
export async function updateJson<T, R = void>(file: string, fallback: T, mutator: (data: T) => R | Promise<R>, pretty = false): Promise<R> {
  return withLock(file, async () => {
    const data = await readJson(file, fallback);
    const result = await mutator(data);
    if ((result as unknown) !== false) await writeJsonAtomic(file, data, pretty);
    return result;
  });
}
