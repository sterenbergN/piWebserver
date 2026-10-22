import fs from 'fs/promises';
import path from 'path';
import { resolvePathInside } from '@/lib/security/paths';
import { queueThumbnails, removeThumbnails } from '@/lib/media/thumbnails';
import type { ModelExtension } from './models';

// The CAD list (public/content/cad.json) and its model files (public/uploads/cad).

export type CadEntry = {
  id: string; name?: string; link?: string;
  model?: string; modelName?: string; modelSize?: number;
  /** Where the model file came from, and when it was stored. */
  modelSource?: 'upload' | 'onshape'; modelUpdatedAt?: string;
  /** A still picture of the model, shown until someone opens the 3D view; `posterFor` is the model file it was taken of. */
  poster?: string; posterFor?: string;
  [key: string]: unknown;
};

/** Fields only the model routes change (an edit of the entry leaves them alone). */
export const MODEL_FIELDS = ['model', 'modelName', 'modelSize', 'modelSource', 'modelUpdatedAt', 'poster', 'posterFor'] as const;

/** Still pictures: PNG, JPEG or WebP, told apart by their first bytes. */
export const POSTER_MAX_BYTES = 4 * 1024 * 1024;
export function posterExtension(data: Uint8Array): '.png' | '.jpg' | '.webp' | null {
  const ascii = (from: number, to: number) => String.fromCharCode(...data.subarray(from, to));
  if (data.byteLength > 8 && data[0] === 0x89 && ascii(1, 4) === 'PNG') return '.png';
  if (data.byteLength > 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return '.jpg';
  if (data.byteLength > 12 && ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return '.webp';
  return null;
}

const cadFile = () => path.join(process.cwd(), 'public', 'content', 'cad.json');

/** Where CAD model files are stored (served at /api/media/uploads/cad/…). */
export const modelDir = () => path.join(process.cwd(), 'public', 'uploads', 'cad');

export async function readCadEntries(): Promise<CadEntry[]> {
  try {
    const raw = JSON.parse(await fs.readFile(cadFile(), 'utf-8'));
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
}

export async function writeCadEntries(entries: CadEntry[]) {
  await fs.mkdir(path.dirname(cadFile()), { recursive: true });
  await fs.writeFile(cadFile(), JSON.stringify(entries, null, 2));
}

/** Delete a stored model file or still picture (only ever inside uploads/cad). */
export async function removeModelFile(model: string | undefined) {
  if (!model?.startsWith('/uploads/cad/')) return;
  const file = resolvePathInside(modelDir(), model.slice('/uploads/cad/'.length));
  if (file) await fs.unlink(file).catch(() => {});
  await removeThumbnails(model).catch(() => {});
}

/** Delete an entry's model file and still picture. */
export async function removeModelFiles(entry: CadEntry | undefined) {
  await removeModelFile(entry?.model);
  await removeModelFile(entry?.poster);
}

/** Store a still picture of an entry's current model, replacing any earlier one. Null if there's no such entry. */
export async function storePoster(id: string, data: Uint8Array, ext: '.png' | '.jpg' | '.webp') {
  const entries = await readCadEntries();
  const entry = entries.find((e) => e.id === id);
  if (!entry?.model) return null;
  const safeId = id.toLowerCase().replace(/[^a-z0-9-]+/g, '-').slice(0, 60) || 'model';
  const name = `${safeId}-still-${Date.now()}${ext}`;
  await fs.mkdir(modelDir(), { recursive: true });
  await fs.writeFile(path.join(modelDir(), name), data);
  const old = entry.poster;
  entry.poster = `/uploads/cad/${name}`;
  entry.posterFor = entry.model;
  await writeCadEntries(entries);
  queueThumbnails(entry.poster);
  if (old && old !== entry.poster) await removeModelFile(old);
  return entry;
}

/** Store a model file for an entry, replacing any earlier one. Null if there's no such entry. */
export async function storeModel(id: string, data: Uint8Array, fileName: string, ext: ModelExtension, source: CadEntry['modelSource']) {
  const entries = await readCadEntries();
  const entry = entries.find((e) => e.id === id);
  if (!entry) return null;
  const safeId = id.toLowerCase().replace(/[^a-z0-9-]+/g, '-').slice(0, 60) || 'model';
  const name = `${safeId}-${Date.now()}${ext}`;
  await fs.mkdir(modelDir(), { recursive: true });
  await fs.writeFile(path.join(modelDir(), name), data);
  const old = entry.model;
  Object.assign(entry, { model: `/uploads/cad/${name}`, modelName: fileName.slice(0, 120), modelSize: data.byteLength, modelSource: source, modelUpdatedAt: new Date().toISOString() });
  await writeCadEntries(entries);
  if (old && old !== entry.model) await removeModelFile(old);
  return entry;
}
