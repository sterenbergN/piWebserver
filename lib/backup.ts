import fs from 'fs/promises';
import path from 'path';
import AdmZip from 'adm-zip';

// Backups of everything the site stores: private data (.data), home-page
// content (public/content) and the uploads metadata (album lists, blog posts
// and markdown, library index). Photos/PDFs are optional because they're big.
// Backups are zip files in a configurable folder — point it at a USB drive.

const root = () => process.cwd();
const SETTINGS_FILE = () => path.join(root(), '.data', 'backup-settings.json');
const NAME_RE = /^backup-\d{4}-\d{2}-\d{2}-\d{6}(-[a-z0-9-]{1,30})?\.zip$/;
const DATA_EXTENSIONS = new Set(['.json', '.md', '.txt']);
/**
 * Zips are built in memory, so photos/PDFs are included only up to this much
 * per backup (a Pi can run out of RAM otherwise). Data files always go in.
 */
export const MEDIA_BUDGET_BYTES = 512 * 1024 * 1024;
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
  lastAutoBackup?: string;
};

export type BackupInfo = { name: string; size: number; createdAt: string; label: string };

export function defaultSettings(): BackupSettings {
  return {
    enabled: true,
    dir: process.env.BACKUP_DIR || path.join(root(), 'backups'),
    keep: 14,
    hour: 3,
    includeMedia: false,
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
  };
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

export async function createBackup(label = 'manual'): Promise<BackupInfo> {
  const settings = await getBackupSettings();
  const safeLabel = label.toLowerCase().replace(/[^a-z0-9-]+/g, '-').slice(0, 30);
  const name = `backup-${stamp()}${safeLabel ? `-${safeLabel}` : ''}.zip`;
  const files = await collectBackupFiles(settings.includeMedia);

  const zip = new AdmZip();
  let mediaBytes = 0;
  let added = 0;
  const skippedMedia: string[] = [];
  for (const file of files) {
    const isMedia = file.startsWith('public/uploads/') && !DATA_EXTENSIONS.has(path.extname(file).toLowerCase());
    if (isMedia) {
      const size = (await fs.stat(path.join(root(), file)).catch(() => null))?.size ?? 0;
      if (mediaBytes + size > MEDIA_BUDGET_BYTES) { skippedMedia.push(file); continue; }
      mediaBytes += size;
    }
    const buffer = await fs.readFile(path.join(root(), file)).catch(() => null);
    if (buffer) { zip.addFile(file, buffer); added++; }
  }
  if (skippedMedia.length) console.warn(`Backup ${name}: left out ${skippedMedia.length} media files over the ${MEDIA_BUDGET_BYTES / 1024 / 1024} MB limit`);
  zip.addFile('backup-manifest.json', Buffer.from(JSON.stringify({
    createdAt: new Date().toISOString(),
    label: safeLabel,
    files: added,
    includeMedia: settings.includeMedia,
    skippedMedia: skippedMedia.length,
  }, null, 2)));

  await fs.mkdir(settings.dir, { recursive: true });
  const target = path.join(settings.dir, name);
  const tmp = `${target}.tmp`;
  await fs.writeFile(tmp, zip.toBuffer());
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
export async function restoreBackup(name: string): Promise<{ restored: number; safetyBackup: string }> {
  const file = await resolveBackup(name);
  const zip = new AdmZip(file);
  const safety = await createBackup('pre-restore');
  let restored = 0;
  for (const entry of zip.getEntries()) {
    if (entry.isDirectory || !isRestorablePath(entry.entryName)) continue;
    const target = path.join(root(), ...entry.entryName.split('/'));
    await fs.mkdir(path.dirname(target), { recursive: true });
    const tmp = `${target}.restore.tmp`;
    await fs.writeFile(tmp, entry.getData());
    await fs.rename(tmp, target);
    restored++;
  }
  return { restored, safetyBackup: safety.name };
}

/** Save an uploaded backup zip into the backup folder (after a sanity check). */
export async function importBackup(buffer: Buffer): Promise<BackupInfo> {
  const zip = new AdmZip(buffer);
  if (!zip.getEntry('backup-manifest.json')) throw new Error('That file is not a site backup');
  const settings = await getBackupSettings();
  await fs.mkdir(settings.dir, { recursive: true });
  const name = `backup-${stamp()}-uploaded.zip`;
  await fs.writeFile(path.join(settings.dir, name), buffer);
  const stat = await fs.stat(path.join(settings.dir, name));
  return { name, size: stat.size, createdAt: stat.mtime.toISOString(), label: 'uploaded' };
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
      if (!isNightlyDue(settings)) return;
      const info = await createBackup('nightly');
      await saveBackupSettings({ ...(await getBackupSettings()), lastAutoBackup: new Date().toISOString() });
      console.log(`Nightly backup written: ${info.name}`);
    } catch (error) {
      console.error('Nightly backup failed:', error);
    }
  };
  setTimeout(tick, 60 * 1000).unref?.();
  setInterval(tick, 15 * 60 * 1000).unref?.();
}
