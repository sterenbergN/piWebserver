import crypto from 'crypto';
import fs from 'fs/promises';
import path from 'path';

// The models the notes run on the Pi (handwriting, and speech for recordings) are fetched
// once, from a fixed version on Hugging Face, and refused unless each file is exactly the
// expected one. They're kept in .cache, which survives updates.

async function sha256(file: string) {
  return crypto.createHash('sha256').update(await fs.readFile(file)).digest('hex');
}

/**
 * Make sure every file is in `folder`, fetching what isn't. `files` maps each name to its
 * SHA-256, or null for a small file that isn't worth checking. `onFetch` is told before the
 * first download, so the caller can say it's downloading.
 */
export async function ensureModelFiles(repo: string, revision: string, files: Record<string, string | null>, folder: string, what: string, onFetch?: () => void) {
  for (const [name, hash] of Object.entries(files)) {
    const target = path.join(folder, name);
    if (await fs.stat(target).then((s) => s.size > 0, () => false)) continue;
    onFetch?.();
    await fs.mkdir(path.dirname(target), { recursive: true });
    const res = await fetch(`https://huggingface.co/${repo}/resolve/${revision}/${name}`);
    if (!res.ok) throw new Error(`The ${what} model wouldn't download (${res.status}).`);
    const temp = `${target}.download`;
    await fs.writeFile(temp, Buffer.from(await res.arrayBuffer()));
    if (hash && (await sha256(temp)) !== hash) {
      await fs.rm(temp, { force: true });
      throw new Error(`The ${what} model that downloaded isn’t the expected one, so it wasn’t used.`);
    }
    await fs.rename(temp, target);
  }
  return folder;
}
