import { NextResponse } from 'next/server';
import { isAdminAuthenticated } from '@/lib/security/server-auth';
import { POSTER_MAX_BYTES, posterExtension, storePoster } from '@/lib/cad/files';

// POST multipart { id, file } (admin): a still picture of the entry's 3D model,
// taken in the browser from the viewer, shown until someone opens the 3D view.

export async function POST(request: Request) {
  if (!(await isAdminAuthenticated())) return NextResponse.json({ success: false }, { status: 401 });
  const form = await request.formData().catch(() => null);
  const id = String(form?.get('id') || '');
  const file = form?.get('file');
  if (!(file instanceof File) || file.size === 0) return NextResponse.json({ success: false, message: 'No picture' }, { status: 400 });
  if (file.size > POSTER_MAX_BYTES) return NextResponse.json({ success: false, message: 'That picture is over 4 MB' }, { status: 400 });
  const data = new Uint8Array(await file.arrayBuffer());
  const ext = posterExtension(data);
  if (!ext) return NextResponse.json({ success: false, message: 'The picture has to be PNG, JPEG or WebP' }, { status: 400 });
  const entry = await storePoster(id, data, ext);
  if (!entry) return NextResponse.json({ success: false, message: 'Not found, or it has no 3D model' }, { status: 404 });
  return NextResponse.json({ success: true, project: entry });
}
