import { spawn } from 'child_process';
import fs from 'fs/promises';
import path from 'path';
import { NextResponse } from 'next/server';
import { isAdminAuthenticated } from '@/lib/security/server-auth';

export const dynamic = 'force-dynamic';

const REPO = process.env.DEPLOY_REPO || 'sterenbergN/piWebserver';

/** On the Pi each release runs from APP_DIR/releases/<tag>; deploy.sh sits in APP_DIR. */
function appDir() {
  const release = process.cwd();
  return path.basename(path.dirname(release)) === 'releases' ? path.dirname(path.dirname(release)) : null;
}

let latestCache: { at: number; tag: string | null; publishedAt?: string; notes?: string } | null = null;

async function latestRelease() {
  if (latestCache && Date.now() - latestCache.at < 10 * 60_000) return latestCache;
  try {
    const res = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, { headers: { Accept: 'application/vnd.github+json' }, cache: 'no-store' });
    const data = res.ok ? await res.json() : null;
    latestCache = { at: Date.now(), tag: data?.tag_name ?? null, publishedAt: data?.published_at, notes: typeof data?.body === 'string' ? data.body.slice(0, 500) : undefined };
  } catch {
    latestCache = { at: Date.now(), tag: null };
  }
  return latestCache;
}

export async function GET(request: Request) {
  if (!(await isAdminAuthenticated())) return NextResponse.json({ success: false }, { status: 401 });
  if (new URL(request.url).searchParams.get('refresh')) latestCache = null;
  const info = await fs.readFile(path.join(process.cwd(), 'build-info.json'), 'utf-8').then((t) => JSON.parse(t)).catch(() => null);
  const dir = appDir();
  const log = dir ? await fs.readFile(path.join(dir, 'deploy.log'), 'utf-8').then((t) => t.split('\n').slice(-40).join('\n')).catch(() => '') : '';
  return NextResponse.json({
    success: true,
    current: info,
    managed: !!dir,
    latest: await latestRelease(),
    log,
  });
}

/** Start deploy.sh in the background; it restarts the site when the new build is ready. */
export async function POST() {
  if (!(await isAdminAuthenticated())) return NextResponse.json({ success: false }, { status: 401 });
  const dir = appDir();
  if (!dir) return NextResponse.json({ success: false, error: 'This install is not managed by deploy.sh' }, { status: 400 });
  const script = path.join(dir, 'deploy.sh');
  try {
    await fs.access(script);
  } catch {
    return NextResponse.json({ success: false, error: 'deploy.sh not found in the site folder' }, { status: 400 });
  }
  const log = path.join(dir, 'deploy.log');
  await fs.appendFile(log, `\n=== Update requested from the admin page ${new Date().toISOString()} ===\n`);
  // pm2 kills the app's whole process tree on restart, and the deploy restarts
  // the app. Double-fork (inner shell backgrounds the job and exits) so deploy.sh
  // is re-parented away from this server and survives that restart.
  const child = spawn('bash', ['-c', 'setsid nohup bash "$0" >> "$1" 2>&1 < /dev/null &', script, log], {
    cwd: dir, detached: true, stdio: 'ignore', env: { ...process.env, APP_DIR: dir },
  });
  child.unref();
  return NextResponse.json({ success: true });
}
