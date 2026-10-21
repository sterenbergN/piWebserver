import fs from 'fs/promises';
import path from 'path';
import { ZipWriter, extractZipEntry, readZipEntries, readZipEntry } from './zip-stream';

// Backups of everything the site stores: private data (.data), home-page
// content (public/content) and the uploads metadata (album lists, blog posts
// and markdown, library index). Photos/PDFs are optional because they're big.
// Backups are zip files in a configurable folder — point it at a USB drive.
// Zips stream to and from disk (see zip-stream.ts), so photos of any size fit.

// Data lives next to the running app; tell the bundler not to trace it as code.
const root = () => path.resolve(/*turbopackIgnore: true*/ process.cwd());
const SETTINGS_FILE = () => path.join(root(), '.data', 'backup-settings.json');
const NAME_RE = /^backup-\d{4}-\d{2}-\d{2}-\d{6}(-[a-z0-9-]{1,30})?\.zip$/;
const DATA_EXTENSIONS = new Set(['.json', '.md', '.txt']);
/** Space to leave free on the backup drive after a backup. */
const FREE_MARGIN_BYTES = 50 * 1024 * 1024;
/** Where restores may write, relative to the project root. */
const RESTORE_PREFIXES = ['.data/', 'public/content/', 'public/uploads/'];

export type BackupSettings = {
  enabled: boolean;
  /** Absolute folder for backups (e.g. /media/usb/site-backups). */
  dir: string;
  /** How many backups to keep; older ones are deleted. */
  keep: number;
  /** Local hour (0–23) after which the nightly backup runs. */
  hour: number;
  includeMedia: boolean;
  /**
   * Only back up when the folder is on a different drive than the site (a
   * second USB). Stops backups quietly landing on the site drive when the
   * backup drive is unplugged or didn't mount.
   */
  requireSeparateDrive: boolean;
  lastAutoBackup?: string;
};

export type DriveStatus = { ok: boolean; message: string; freeBytes?: number; totalBytes?: number };

export type BackupInfo = { name: string; size: number; createdAt: string; label: string };

export function defaultSettings(): BackupSettings {
  return {
    enabled: true,
    dir: process.env.BACKUP_DIR || path.join(root(), 'backups'),
    keep: 14,
    hour: 3,
    includeMedia: false,
    requireSeparateDrive: !!process.env.BACKUP_DIR,
  };
}

export async function getBackupSettings(): Promise<BackupSettings> {
  try {
    const saved = JSON.parse(await fs.readFile(SETTINGS_FILE(), 'utf-8'));
    return { ...defaultSettings(), ...saved };
  } catch {
    return defaultSettings();
  }
}

export function normalizeSettings(input: any, current: BackupSettings): BackupSettings {
  const dir = typeof input?.dir === 'string' && input.dir.trim() ? input.dir.trim() : current.dir;
  if (!path.isAbsolute(dir)) throw new Error('Backup folder must be an absolute path');
  const keep = Math.round(Number(input?.keep ?? current.keep));
  const hour = Math.round(Number(input?.hour ?? current.hour));
  return {
    ...current,
    enabled: typeof input?.enabled === 'boolean' ? input.enabled : current.enabled,
    dir: path.resolve(dir),
    keep: Number.isFinite(keep) ? Math.min(365, Math.max(1, keep)) : current.keep,
    hour: Number.isFinite(hour) ? Math.min(23, Math.max(0, hour)) : current.hour,
    includeMedia: typeof input?.includeMedia === 'boolean' ? input.includeMedia : current.includeMedia,
    requireSeparateDrive: typeof input?.requireSeparateDrive === 'boolean' ? input.requireSeparateDrive : current.requireSeparateDrive,
  };
}

/**
 * Is the backup folder usable right now? With `requireSeparateDrive`, the
 * folder's parent must already exist (we never create a mount point) and sit
 * on a different device than the site.
 */
export async function checkBackupDrive(settings: BackupSettings): Promise<DriveStatus> {
  const parent = path.dirname(settings.dir);
  const target = await fs.stat(settings.dir).catch(() => null);
  const parentStat = await fs.stat(parent).catch(() => null);
  if (!target && !parentStat) {
    return { ok: false, message: `The backup drive isn't connected (${parent} doesn't exist).` };
  }
  if (settings.requireSeparateDrive) {
    const site = await fs.stat(root());
    const dev = (target || parentStat)!.dev;
    if (dev === site.dev) {
      return { ok: false, message: 'The backup folder is on the same drive as the site — is the backup USB plugged in and mounted?' };
    }
  }
  const stats = await fs.statfs(target ? settings.dir : parent).catch(() => null);
  const freeBytes = stats ? stats.bavail * stats.bsize : undefined;
  const totalBytes = stats ? stats.blocks * stats.bsize : undefined;
  if (freeBytes !== undefined && freeBytes < 50 * 1024 * 1024) {
    return { ok: false, message: 'The backup drive is almost full (under 50 MB free).', freeBytes, totalBytes };
  }
  return { ok: true, message: 'Backup drive ready', freeBytes, totalBytes };
}

export async function saveBackupSettings(settings: BackupSettings) {
  await fs.mkdir(path.dirname(SETTINGS_FILE()), { recursive: true });
  await fs.writeFile(SETTINGS_FILE(), JSON.stringify(settings, null, 2));
}

async function walk(dir: string): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
  const files: string[] = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...(await walk(full)));
    else if (entry.isFile()) files.push(full);
  }
  return files;
}

/** Files to back up, as paths relative to the project root (forward slashes). */
export async function collectBackupFiles(includeMedia: boolean): Promise<string[]> {
  const rel = (p: string) => path.relative(root(), p).split(path.sep).join('/');
  const data = (await walk(path.join(root(), '.data')))
    .map(rel)
    // Party rooms are throwaway; tmp files are half-written.
    .filter((p) => !p.startsWith('.data/party/') && !p.endsWith('.tmp'));
  const content = (await walk(path.join(root(), 'public', 'content'))).map(rel);
  const uploads = (await walk(path.join(root(), 'public', 'uploads')))
    .map(rel)
    .filter((p) => !p.includes('.tmp') && (includeMedia || DATA_EXTENSIONS.has(path.extname(p).toLowerCase())));
  return [...data, ...content, ...uploads].filter((p) => !p.startsWith('..'));
}

function stamp(date = new Date()) {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

export async function listBackups(settings?: BackupSettings): Promise<BackupInfo[]> {
  const { dir } = settings || (await getBackupSettings());
  const names = await fs.readdir(dir).catch(() => [] as string[]);
  const infos = await Promise.all(names.filter((n) => NAME_RE.test(n)).map(async (name) => {
    const stat = await fs.stat(path.join(dir, name)).catch(() => null);
    if (!stat) return null;
    const label = name.replace(/^backup-[\d-]+?-\d{6}-?/, '').replace(/\.zip$/, '') || 'manual';
    return { name, size: stat.size, createdAt: stat.mtime.toISOString(), label };
  }));
  return (infos.filter(Boolean) as BackupInfo[]).sort((a, b) => b.name.localeCompare(a.name));
}

export type BackupProgress = { done: number; total: number; bytes: number };
type OnProgress = (progress: BackupProgress) => void;

export async function createBackup(label = 'manual', onProgress?: OnProgress): Promise<BackupInfo> {
  const settings = await getBackupSettings();
  const safeLabel = label.toLowerCase().replace(/[^a-z0-9-]+/g, '-').slice(0, 30);
  const name = `backup-${stamp()}${safeLabel ? `-${safeLabel}` : ''}.zip`;
  const files = await collectBackupFiles(settings.includeMedia);

  const drive = await checkBackupDrive(settings);
  if (!drive.ok) throw new Error(drive.message);
  if (drive.freeBytes !== undefined) {
    let needed = 0;
    for (const file of files) needed += (await fs.stat(path.join(root(), file)).catch(() => null))?.size ?? 0;
    if (needed + FREE_MARGIN_BYTES > drive.freeBytes) {
      const mb = (n: number) => `${Math.ceil(n / 1024 / 1024)} MB`;
      throw new Error(`Not enough room on the backup drive: this backup needs about ${mb(needed)} and ${mb(drive.freeBytes)} is free.`);
    }
  }
  await fs.mkdir(settings.dir, { recursive: true });
  const target = path.join(settings.dir, name);
  const tmp = `${target}.tmp`;
  const zip = await ZipWriter.create(tmp);
  let added = 0;
  let bytes = 0;
  try {
    for (const [i, file] of files.entries()) {
      const size = await zip.addFile(file, path.join(root(), file));
      if (size !== null) { added++; bytes += size; }
      onProgress?.({ done: i + 1, total: files.length, bytes });
    }
    await zip.addBuffer('backup-manifest.json', Buffer.from(JSON.stringify({
      createdAt: new Date().toISOString(),
      label: safeLabel,
      files: added,
      includeMedia: settings.includeMedia,
    }, null, 2)));
    await zip.close();
  } catch (error) {
    await zip.abort();
    await fs.unlink(tmp).catch(() => {});
    throw error;
  }
  await fs.rename(tmp, target);
  await pruneBackups(settings, name);
  const stat = await fs.stat(target);
  return { name, size: stat.size, createdAt: stat.mtime.toISOString(), label: safeLabel || 'manual' };
}

/** Keep the newest `keep` backups (never deleting the one just made). */
async function pruneBackups(settings: BackupSettings, justMade: string) {
  const all = await listBackups(settings);
  for (const old of all.slice(settings.keep)) {
    if (old.name === justMade) continue;
    await fs.unlink(path.join(settings.dir, old.name)).catch(() => {});
  }
}

export async function resolveBackup(name: string): Promise<string> {
  if (!NAME_RE.test(name)) throw new Error('Unknown backup');
  const { dir } = await getBackupSettings();
  const file = path.join(dir, name);
  await fs.access(file);
  return file;
}

/** Only files under the data folders, with no path tricks, may be restored. */
export function isRestorablePath(entry: string) {
  const normalized = path.posix.normalize(entry);
  return normalized === entry
    && !normalized.startsWith('/')
    && !normalized.split('/').includes('..')
    && RESTORE_PREFIXES.some((prefix) => normalized.startsWith(prefix))
    && normalized !== '.data/backup-settings.json';
}

/**
 * Restore a backup over the current data. A safety backup of the current
 * state is taken first. Files that didn't exist when the backup was made are
 * left alone (nothing is deleted).
 */
export async function restoreBackup(name: string, onProgress?: OnProgress): Promise<{ restored: number; safetyBackup: string }> {
  const file = await resolveBackup(name);
  const entries = (await readZipEntries(file)).filter((e) => !e.isDirectory && isRestorablePath(e.name));
  const safety = await createBackup('pre-restore');
  let restored = 0;
  let bytes = 0;
  for (const entry of entries) {
    await extractZipEntry(file, entry, path.join(root(), ...entry.name.split('/')));
    restored++;
    bytes += entry.size;
    onProgress?.({ done: restored, total: entries.length, bytes });
  }
  return { restored, safetyBackup: safety.name };
}

/** Where an upload is written while it arrives: the backup folder, so a rename finishes it. */
export async function uploadTempPath() {
  const settings = await getBackupSettings();
  const drive = await checkBackupDrive(settings);
  if (!drive.ok) throw new Error(drive.message);
  await fs.mkdir(settings.dir, { recursive: true });
  return path.join(settings.dir, `upload-${Date.now()}.zip.tmp`);
}

/** Move an uploaded zip (already on disk) into the backup list, after checking it's a site backup. */
export async function importBackup(upload: string): Promise<BackupInfo> {
  try {
    const entries = await readZipEntries(upload).catch(() => []);
    const manifest = entries.find((e) => e.name === 'backup-manifest.json');
    const parsed = manifest ? await readZipEntry(upload, manifest).then((b) => JSON.parse(b.toString('utf-8'))).catch(() => null) : null;
    if (!parsed) throw new Error('That file is not a site backup');
    const settings = await getBackupSettings();
    const name = `backup-${stamp()}-uploaded.zip`;
    const target = path.join(settings.dir, name);
    await fs.rename(upload, target).catch(() => fs.copyFile(upload, target));
    const stat = await fs.stat(target);
    return { name, size: stat.size, createdAt: stat.mtime.toISOString(), label: 'uploaded' };
  } finally {
    await fs.unlink(upload).catch(() => {});
  }
}

// ─── Background jobs ───────────────────────────────────────────────────────────
// A backup with photos can take minutes — longer than a web request should
// wait — so it runs in the background and the admin page polls for progress.

export type BackupJob = BackupProgress & {
  kind: 'create' | 'restore' | 'nightly';
  startedAt: string;
  finishedAt?: string;
  error?: string;
  result?: Record<string, unknown>;
};

// On globalThis: the scheduler and the API route can each load their own copy of this module.
const jobs = globalThis as typeof globalThis & { __backupJob?: BackupJob };

export function getBackupJob(): BackupJob | null {
  return jobs.__backupJob ?? null;
}

export function isBackupRunning() {
  return !!jobs.__backupJob && !jobs.__backupJob.finishedAt;
}

/** Run `work` in the background. Throws if a backup or restore is already running. */
export function startBackupJob(kind: BackupJob['kind'], work: (onProgress: OnProgress) => Promise<Record<string, unknown>>): BackupJob {
  if (isBackupRunning()) throw new Error('A backup or restore is already running');
  const job: BackupJob = { kind, startedAt: new Date().toISOString(), done: 0, total: 0, bytes: 0 };
  jobs.__backupJob = job;
  work((progress) => Object.assign(job, progress))
    .then((result) => { job.result = result; })
    .catch((error) => {
      job.error = error instanceof Error ? error.message : 'Backup failed';
      console.error(`Backup (${kind}) failed:`, error);
    })
    .finally(() => { job.finishedAt = new Date().toISOString(); });
  return job;
}

// ─── Nightly schedule ──────────────────────────────────────────────────────────

let schedulerStarted = false;

/** Whether the nightly backup is due: enabled, past the hour, and not yet run today. */
export function isNightlyDue(settings: BackupSettings, now = new Date()) {
  if (!settings.enabled || now.getHours() < settings.hour) return false;
  if (!settings.lastAutoBackup) return true;
  const last = new Date(settings.lastAutoBackup);
  return last.toDateString() !== now.toDateString();
}

export function startBackupScheduler() {
  if (schedulerStarted) return;
  schedulerStarted = true;
  const tick = async () => {
    try {
      const settings = await getBackupSettings();
      if (!isNightlyDue(settings) || isBackupRunning()) return;
      startBackupJob('nightly', async (onProgress) => {
        const info = await createBackup('nightly', onProgress);
        await saveBackupSettings({ ...(await getBackupSettings()), lastAutoBackup: new Date().toISOString() });
        console.log(`Nightly backup written: ${info.name}`);
        return { backup: info };
      });
    } catch (error) {
      console.error('Nightly backup failed:', error);
    }
  };
  setTimeout(tick, 60 * 1000).unref?.();
  setInterval(tick, 15 * 60 * 1000).unref?.();
}
