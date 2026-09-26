import fs from 'fs/promises';
import path from 'path';
import { NextResponse } from 'next/server';
import { isAdminAuthenticated } from '@/lib/security/server-auth';
import {
  createBackup, getBackupSettings, importBackup, listBackups, normalizeSettings, resolveBackup, restoreBackup, saveBackupSettings,
} from '@/lib/backup';

export const dynamic = 'force-dynamic';

const unauthorized = () => NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
const fail = (error: unknown, status = 400) =>
  NextResponse.json({ success: false, error: error instanceof Error ? error.message : 'Backup action failed' }, { status });

export async function GET(request: Request) {
  if (!(await isAdminAuthenticated())) return unauthorized();
  const download = new URL(request.url).searchParams.get('download');
  if (download) {
    try {
      const file = await resolveBackup(download);
      const buffer = await fs.readFile(file);
      return new NextResponse(new Uint8Array(buffer), {
        headers: {
          'Content-Type': 'application/zip',
          'Content-Disposition': `attachment; filename="${path.basename(file)}"`,
          'Content-Length': String(buffer.length),
        },
      });
    } catch (error) {
      return fail(error, 404);
    }
  }
  const settings = await getBackupSettings();
  return NextResponse.json({ success: true, settings, backups: await listBackups(settings) });
}

export async function POST(request: Request) {
  if (!(await isAdminAuthenticated())) return unauthorized();
  const body = await request.json().catch(() => null);
  try {
    switch (body?.action) {
      case 'create':
        return NextResponse.json({ success: true, backup: await createBackup('manual') });
      case 'restore':
        return NextResponse.json({ success: true, ...(await restoreBackup(String(body.name || ''))) });
      case 'delete': {
        const file = await resolveBackup(String(body.name || ''));
        await fs.unlink(file);
        return NextResponse.json({ success: true });
      }
      case 'settings': {
        const settings = normalizeSettings(body.settings, await getBackupSettings());
        await fs.mkdir(settings.dir, { recursive: true });
        await saveBackupSettings(settings);
        return NextResponse.json({ success: true, settings, backups: await listBackups(settings) });
      }
      default:
        return fail(new Error('Unknown action'));
    }
  } catch (error) {
    return fail(error);
  }
}

/** Upload a backup zip made elsewhere (e.g. from another device). */
export async function PUT(request: Request) {
  if (!(await isAdminAuthenticated())) return unauthorized();
  try {
    const form = await request.formData();
    const file = form.get('file');
    if (!(file instanceof File) || !file.name.endsWith('.zip')) throw new Error('Choose a .zip backup file');
    return NextResponse.json({ success: true, backup: await importBackup(Buffer.from(await file.arrayBuffer())) });
  } catch (error) {
    return fail(error);
  }
}
