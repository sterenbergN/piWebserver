import fs from 'fs/promises';
import path from 'path';
import { resolvePathInside } from '@/lib/security/paths';

/** Where CAD model files are stored (served at /api/media/uploads/cad/…). */
export const modelDir = () => path.join(process.cwd(), 'public', 'uploads', 'cad');

/** Delete a stored model file (only ever inside uploads/cad). */
export async function removeModelFile(model: string | undefined) {
  if (!model?.startsWith('/uploads/cad/')) return;
  const file = resolvePathInside(modelDir(), model.slice('/uploads/cad/'.length));
  if (file) await fs.unlink(file).catch(() => {});
}
