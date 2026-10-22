import { NextResponse } from 'next/server';
import { isAdminAuthenticated } from '@/lib/security/server-auth';
import { readCadEntries, storeModel } from '@/lib/cad/files';
import { parseOnshapeLink } from '@/lib/cad/onshape';
import { assemblyExportResult, exportPartStudioStl, OnshapeError, startAssemblyExport, tabKind } from '@/lib/cad/onshape-export';

// POST { id } (admin): export the entry's linked Onshape tab as its 3D model,
// replacing any earlier model file. Run when the entry is saved or from
// "Refresh from Onshape", never when someone views the page.
//   - A Part Studio comes back straight away: { success, project }.
//   - An assembly is exported in the background: { success, pending, translation }.
//     POST { id, translation } again every few seconds until it returns the project.
// Each request stays short, well inside Cloudflare's time limit.

export async function POST(request: Request) {
  if (!(await isAdminAuthenticated())) return NextResponse.json({ success: false }, { status: 401 });
  const { id, translation } = await request.json().catch(() => ({}));
  const entry = (await readCadEntries()).find((e) => e.id === id);
  if (!entry) return NextResponse.json({ success: false, message: 'Not found' }, { status: 404 });
  const ref = parseOnshapeLink(entry.link);
  if (!ref) return NextResponse.json({ success: false, message: 'The link isn’t a link to an Onshape tab.' }, { status: 400 });
  const baseName = String(entry.name || 'model').replace(/[^\w .-]+/g, '').trim() || 'model';

  try {
    if (translation) {
      const data = await assemblyExportResult(ref, translation);
      if (!data) return NextResponse.json({ success: true, pending: true, translation });
      // glTF from Onshape may be binary or JSON; the viewer reads either from a .glb.
      const saved = await storeModel(entry.id, data, `${baseName}.glb`, '.glb', 'onshape');
      return saved ? NextResponse.json({ success: true, project: saved }) : NextResponse.json({ success: false, message: 'Not found' }, { status: 404 });
    }

    if ((await tabKind(ref)) === 'assembly') {
      return NextResponse.json({ success: true, pending: true, translation: await startAssemblyExport(ref) });
    }
    const saved = await storeModel(entry.id, await exportPartStudioStl(ref), `${baseName}.stl`, '.stl', 'onshape');
    return saved ? NextResponse.json({ success: true, project: saved }) : NextResponse.json({ success: false, message: 'Not found' }, { status: 404 });
  } catch (error) {
    if (error instanceof OnshapeError) return NextResponse.json({ success: false, message: error.message }, { status: 502 });
    console.error('Onshape export failed:', error);
    return NextResponse.json({ success: false, message: 'The Onshape export failed.' }, { status: 500 });
  }
}
