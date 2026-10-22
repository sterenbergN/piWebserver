import { NextResponse } from 'next/server';
import { isAdminAuthenticated } from '@/lib/security/server-auth';
import { readCadEntries, storeModel } from '@/lib/cad/files';
import { parseOnshapeLink } from '@/lib/cad/onshape';
import { exportPartStudioStl, OnshapeError } from '@/lib/cad/onshape-export';

// POST { id } (admin): export the entry's linked Onshape Part Studio as its 3D
// model, replacing any earlier model file. Run when the entry is saved or from
// "Refresh from Onshape", never when someone views the page.

export async function POST(request: Request) {
  if (!(await isAdminAuthenticated())) return NextResponse.json({ success: false }, { status: 401 });
  const { id } = await request.json().catch(() => ({}));
  const entry = (await readCadEntries()).find((e) => e.id === id);
  if (!entry) return NextResponse.json({ success: false, message: 'Not found' }, { status: 404 });
  const ref = parseOnshapeLink(entry.link);
  if (!ref) return NextResponse.json({ success: false, message: 'The link isn’t an Onshape Part Studio link.' }, { status: 400 });
  try {
    const data = await exportPartStudioStl(ref);
    const name = `${String(entry.name || 'model').replace(/[^\w .-]+/g, '').trim() || 'model'}.stl`;
    const saved = await storeModel(entry.id, data, name, '.stl', 'onshape');
    if (!saved) return NextResponse.json({ success: false, message: 'Not found' }, { status: 404 });
    return NextResponse.json({ success: true, project: saved });
  } catch (error) {
    if (error instanceof OnshapeError) return NextResponse.json({ success: false, message: error.message }, { status: 502 });
    console.error('Onshape export failed:', error);
    return NextResponse.json({ success: false, message: 'The Onshape export failed.' }, { status: 500 });
  }
}
