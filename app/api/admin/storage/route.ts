import { NextResponse } from 'next/server';
import { isAdminAuthenticated } from '@/lib/security/server-auth';
import { getBackupSettings } from '@/lib/backup';
import { measureStorage, measureSystem } from '@/lib/storage-usage';

export const dynamic = 'force-dynamic';

/**
 * A cached measurement: kept for a while, and one walk shared between admins
 * asking at the same time. Walking every file takes a while on an SD card.
 */
function cached<T extends { scannedAt: string }>(freshMs: number, measure: () => Promise<T>) {
  let last: T | null = null;
  let running: Promise<T> | null = null;
  return {
    peek: () => last,
    async get(refresh: boolean): Promise<T> {
      if (!running && (refresh || !last || Date.now() - Date.parse(last.scannedAt) > freshMs)) {
        running = measure().finally(() => { running = null; });
      }
      if (running) last = await running;
      return last!;
    },
  };
}

const backupDir = () => getBackupSettings().then((s) => s.dir).catch(() => undefined);
const site = cached(5 * 60_000, async () => measureStorage({ backupDir: await backupDir() }));
// The whole drive is slow (it can take a couple of minutes on the Pi), so only when asked.
const system = cached(30 * 60_000, async () => measureSystem({ backupDir: await backupDir() }));

export async function GET(request: Request) {
  if (!(await isAdminAuthenticated())) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  const params = new URL(request.url).searchParams;
  const refresh = params.has('refresh');
  try {
    if (params.has('system')) return NextResponse.json({ success: true, data: await system.get(refresh) });
    // The drive breakdown comes along when there's one already, so it survives a reload.
    return NextResponse.json({ success: true, data: await site.get(refresh), system: system.peek() });
  } catch (error) {
    console.error('Storage scan failed:', error);
    return NextResponse.json({ success: false, error: 'Could not measure the disk' }, { status: 500 });
  }
}
