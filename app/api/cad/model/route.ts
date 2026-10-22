import { NextResponse } from 'next/server';
import { isAdminAuthenticated } from '@/lib/security/server-auth';
import { MODEL_FIELDS, readCadEntries, removeModelFile, storeModel, writeCadEntries } from '@/lib/cad/files';
import { MAX_MODEL_BYTES, MODEL_EXTENSIONS, modelExtension } from '@/lib/cad/models';

// A CAD entry's 3D model file (admin only). POST multipart { id, file } stores
// it in public/uploads/cad and replaces any earlier one; DELETE { id } removes it.

export async function POST(request: Request) {
  if (!(await isAdminAuthenticated())) return NextResponse.json({ success: false }, { status: 401 });
  const form = await request.formData().catch(() => null);
  const id = String(form?.get('id') || '');
  const file = form?.get('file');
  if (!(file instanceof File) || file.size === 0) return NextResponse.json({ success: false, message: 'No file' }, { status: 400 });
  const ext = modelExtension(file.name);
  if (!ext) return NextResponse.json({ success: false, message: `Use one of: ${MODEL_EXTENSIONS.join(', ')}` }, { status: 400 });
  if (file.size > MAX_MODEL_BYTES) return NextResponse.json({ success: false, message: 'That file is over 50 MB' }, { status: 400 });

  const entry = await storeModel(id, new Uint8Array(await file.arrayBuffer()), file.name, ext, 'upload');
  if (!entry) return NextResponse.json({ success: false, message: 'Not found' }, { status: 404 });
  return NextResponse.json({ success: true, project: entry });
}

export async function DELETE(request: Request) {
  if (!(await isAdminAuthenticated())) return NextResponse.json({ success: false }, { status: 401 });
  const { id } = await request.json().catch(() => ({}));
  const entries = await readCadEntries();
  const entry = entries.find((e) => e.id === id);
  if (!entry) return NextResponse.json({ success: false, message: 'Not found' }, { status: 404 });
  await removeModelFile(entry.model);
  for (const field of MODEL_FIELDS) delete entry[field];
  await writeCadEntries(entries);
  return NextResponse.json({ success: true, project: entry });
}
