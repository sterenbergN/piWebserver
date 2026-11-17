import { NextResponse } from 'next/server';
import { isAdminAuthenticated } from '@/lib/security/server-auth';
import { getBackupSettings } from '@/lib/backup';
import { measureStorage, type StorageReport } from '@/lib/storage-usage';

export const dynamic = 'force-dynamic';

// Walking every photo takes a while on an SD card: keep the answer for a few
// minutes, and share one walk between admins asking at the same time.
const FRESH_MS = 5 * 60_000;
let last: StorageReport | null = null;
let running: Promise<StorageReport> | null = null;

export async function GET(request: Request) {
  if (!(await isAdminAuthenticated())) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  const refresh = new URL(request.url).searchParams.has('refresh');
  try {
    if (!running && (refresh || !last || Date.now() - Date.parse(last.scannedAt) > FRESH_MS)) {
      running = getBackupSettings()
        .then((s) => measureStorage({ backupDir: s.dir }))
        .finally(() => { running = null; });
      last = await running;
    } else if (running) {
      last = await running;
    }
    return NextResponse.json({ success: true, data: last });
  } catch (error) {
    console.error('Storage scan failed:', error);
    return NextResponse.json({ success: false, error: 'Could not measure the disk' }, { status: 500 });
  }
}
