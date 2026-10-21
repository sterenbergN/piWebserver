import fs from 'fs/promises';
import { createReadStream, createWriteStream } from 'fs';
import path from 'path';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';
import { NextResponse } from 'next/server';
import { isAdminAuthenticated } from '@/lib/security/server-auth';
import {
  checkBackupDrive, createBackup, getBackupJob, getBackupSettings, importBackup, isBackupRunning, listBackups, normalizeSettings,
  resolveBackup, restoreBackup, saveBackupSettings, startBackupJob, uploadTempPath,
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
      const { size } = await fs.stat(file);
      // Streamed: a backup with photos can be bigger than the Pi's memory.
      return new NextResponse(Readable.toWeb(createReadStream(file)) as ReadableStream, {
        headers: {
          'Content-Type': 'application/zip',
          'Content-Disposition': `attachment; filename="${path.basename(file)}"`,
          'Content-Length': String(size),
        },
      });
    } catch (error) {
      return fail(error, 404);
    }
  }
  const settings = await getBackupSettings();
  return NextResponse.json({
    success: true, settings, drive: await checkBackupDrive(settings), backups: await listBackups(settings), job: getBackupJob(),
  });
}

export async function POST(request: Request) {
  if (!(await isAdminAuthenticated())) return unauthorized();
  const body = await request.json().catch(() => null);
  try {
    switch (body?.action) {
      case 'create':
        // Runs in the background; the page polls GET for `job`.
        return NextResponse.json({ success: true, job: startBackupJob('create', async (onProgress) => ({ backup: await createBackup('manual', onProgress) })) });
      case 'restore': {
        const name = String(body.name || '');
        await resolveBackup(name);
        return NextResponse.json({ success: true, job: startBackupJob('restore', (onProgress) => restoreBackup(name, onProgress)) });
      }
      case 'delete': {
        if (isBackupRunning()) throw new Error('Wait for the running backup to finish');
        const file = await resolveBackup(String(body.name || ''));
        await fs.unlink(file);
        return NextResponse.json({ success: true });
      }
      case 'settings': {
        const settings = normalizeSettings(body.settings, await getBackupSettings());
        const drive = await checkBackupDrive(settings);
        // Don't create folders on the site drive by mistake; only once the drive checks out.
        if (drive.ok) await fs.mkdir(settings.dir, { recursive: true });
        await saveBackupSettings(settings);
        return NextResponse.json({ success: true, settings, drive, backups: await listBackups(settings) });
      }
      default:
        return fail(new Error('Unknown action'));
    }
  } catch (error) {
    return fail(error);
  }
}

/** Upload a backup zip made elsewhere (e.g. from another device). The body is the raw zip. */
export async function PUT(request: Request) {
  if (!(await isAdminAuthenticated())) return unauthorized();
  if (!request.body) return fail(new Error('Choose a .zip backup file'));
  let tmp = '';
  try {
    tmp = await uploadTempPath();
    await pipeline(Readable.fromWeb(request.body as import('stream/web').ReadableStream), createWriteStream(tmp));
    return NextResponse.json({ success: true, backup: await importBackup(tmp) });
  } catch (error) {
    if (tmp) await fs.unlink(tmp).catch(() => {});
    return fail(error);
  }
}
