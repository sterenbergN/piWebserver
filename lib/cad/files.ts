import fs from 'fs/promises';
import path from 'path';
import { resolvePathInside } from '@/lib/security/paths';
import type { ModelExtension } from './models';

// The CAD list (public/content/cad.json) and its model files (public/uploads/cad).

export type CadEntry = {
  id: string; name?: string; link?: string;
  model?: string; modelName?: string; modelSize?: number;
  /** Where the model file came from, and when it was stored. */
  modelSource?: 'upload' | 'onshape'; modelUpdatedAt?: string;
  [key: string]: unknown;
};

/** Fields only the model routes change (an edit of the entry leaves them alone). */
export const MODEL_FIELDS = ['model', 'modelName', 'modelSize', 'modelSource', 'modelUpdatedAt'] as const;

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

/** Delete a stored model file (only ever inside uploads/cad). */
export async function removeModelFile(model: string | undefined) {
  if (!model?.startsWith('/uploads/cad/')) return;
  const file = resolvePathInside(modelDir(), model.slice('/uploads/cad/'.length));
  if (file) await fs.unlink(file).catch(() => {});
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
