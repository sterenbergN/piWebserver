import { NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';
import { isAdminAuthenticated } from '@/lib/security/server-auth';
import { modelDir, removeModelFile } from '@/lib/cad/files';
import { MAX_MODEL_BYTES, MODEL_EXTENSIONS, modelExtension } from '@/lib/cad/models';

// A CAD entry's 3D model file (admin only). POST multipart { id, file } stores
// it in public/uploads/cad and replaces any earlier one; DELETE { id } removes it.

const publicRoot = path.join(process.cwd(), 'public');
const cadFile = path.join(publicRoot, 'content', 'cad.json');

type Entry = { id: string; model?: string; modelName?: string; modelSize?: number; [key: string]: unknown };

async function readEntries(): Promise<Entry[]> {
  try {
    const raw = JSON.parse(await fs.readFile(cadFile, 'utf-8'));
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
}

export async function POST(request: Request) {
  if (!(await isAdminAuthenticated())) return NextResponse.json({ success: false }, { status: 401 });
  const form = await request.formData().catch(() => null);
  const id = String(form?.get('id') || '');
  const file = form?.get('file');
  if (!(file instanceof File) || file.size === 0) return NextResponse.json({ success: false, message: 'No file' }, { status: 400 });
  const ext = modelExtension(file.name);
  if (!ext) return NextResponse.json({ success: false, message: `Use one of: ${MODEL_EXTENSIONS.join(', ')}` }, { status: 400 });
  if (file.size > MAX_MODEL_BYTES) return NextResponse.json({ success: false, message: 'That file is over 50 MB' }, { status: 400 });

  const entries = await readEntries();
  const entry = entries.find((e) => e.id === id);
  if (!entry) return NextResponse.json({ success: false, message: 'Not found' }, { status: 404 });

  const safeId = id.toLowerCase().replace(/[^a-z0-9-]+/g, '-').slice(0, 60) || 'model';
  const name = `${safeId}-${Date.now()}${ext}`;
  await fs.mkdir(modelDir(), { recursive: true });
  await fs.writeFile(path.join(modelDir(), name), Buffer.from(await file.arrayBuffer()));
  const old = entry.model;
  entry.model = `/uploads/cad/${name}`;
  entry.modelName = file.name.slice(0, 120);
  entry.modelSize = file.size;
  await fs.writeFile(cadFile, JSON.stringify(entries, null, 2));
  if (old !== entry.model) await removeModelFile(old);
  return NextResponse.json({ success: true, project: entry });
}

export async function DELETE(request: Request) {
  if (!(await isAdminAuthenticated())) return NextResponse.json({ success: false }, { status: 401 });
  const { id } = await request.json().catch(() => ({}));
  const entries = await readEntries();
  const entry = entries.find((e) => e.id === id);
  if (!entry) return NextResponse.json({ success: false, message: 'Not found' }, { status: 404 });
  await removeModelFile(entry.model);
  delete entry.model;
  delete entry.modelName;
  delete entry.modelSize;
  await fs.writeFile(cadFile, JSON.stringify(entries, null, 2));
  return NextResponse.json({ success: true, project: entry });
}
