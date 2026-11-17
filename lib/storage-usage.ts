import fs from 'fs/promises';
import type { Stats } from 'fs';
import path from 'path';

// Where the Pi's disk space goes: each part of the site (photos, notes,
// reader books, caches, backups, the code itself) and everything else on
// the drive. On the Pi the data folders are symlinks into APP_DIR/shared,
// so each area's own root is resolved; nothing below it is followed.

export type UsageItem = { name: string; label: string; bytes: number; files: number };
export type UsageArea = {
  id: string;
  label: string;
  icon: string;
  /** Where it lives, for the admin. */
  where: string;
  bytes: number;
  files: number;
  /** On a different drive from the site (a backup USB): not part of this disk's total. */
  otherDrive?: boolean;
  items: UsageItem[];
};
export type StorageReport = {
  disk: { total: number; used: number; free: number } | null;
  areas: UsageArea[];
  /** Used space on the site's drive that isn't any part of the site: the OS, other programs. */
  elsewhere: number | null;
  scannedAt: string;
  tookMs: number;
};

/** Friendlier names for the folders the site makes. Anything else shows its own name. */
const LABELS: Record<string, string> = {
  // public/uploads
  gallery: 'Photo gallery', blog: 'Blog posts & images', library: 'Library documents', recipes: 'Recipe photos',
  cad: '3D models', leaderboard: 'Game leaderboards',
  // .data
  notes: 'Notes', 'notes-files': 'Note files & recordings', reader: 'Reader progress', 'reader-books': 'Reader books & audiobooks',
  workouts: 'Workouts', skills: 'Skills', party: 'Party games', 'party-prompts.json': 'Party prompts', chores: 'Chores',
  movies: 'Movies', golf: 'Golf', daily: 'Daily questions', 'private-posts': 'Private journal', 'blog-drafts.json': 'Blog drafts',
  'analytics.json': 'Visit log', 'stats-history.json': 'Pi stats history', 'account-exports': 'Account exports',
  study: 'Study', habits: 'Habits', journal: 'Journal', 'loop-lab': 'Loop Lab',
  // .cache
  'thumbs-v2': 'Photo thumbnails', thumbs: 'Old photo thumbnails', 'notes-transcribe': 'Speech-to-text model', 'notes-handwriting': 'Handwriting model',
  // code
  node_modules: 'Libraries (node_modules)', '.next': 'Built site (.next)', '.next-build': 'Built site (.next-build)',
  '.next-dev': 'Dev build (.next-dev)', '.git': 'Git history',
};

const labelFor = (name: string) => LABELS[name] ?? name;

/** Real space on disk where the platform says (blocks), else the file's length. */
const sizeOf = (st: Stats) => (process.platform !== 'win32' && typeof st.blocks === 'number' ? st.blocks * 512 : st.size);

type Tally = { bytes: number; files: number };

class Walker {
  /** Hard-linked files count once. */
  private seen = new Set<string>();

  async size(target: string): Promise<Tally> {
    const st = await fs.lstat(target).catch(() => null);
    if (!st) return { bytes: 0, files: 0 };
    if (st.isSymbolicLink()) return { bytes: 0, files: 0 };
    if (!st.isDirectory()) {
      if (st.nlink > 1) {
        const key = `${st.dev}:${st.ino}`;
        if (this.seen.has(key)) return { bytes: 0, files: 0 };
        this.seen.add(key);
      }
      return { bytes: sizeOf(st), files: 1 };
    }
    const entries = await fs.readdir(target).catch(() => [] as string[]);
    const total: Tally = { bytes: sizeOf(st), files: 0 };
    // A few at a time: fast enough, and gentle on an SD card.
    for (let i = 0; i < entries.length; i += 16) {
      const parts = await Promise.all(entries.slice(i, i + 16).map((name) => this.size(path.join(target, name))));
      for (const p of parts) { total.bytes += p.bytes; total.files += p.files; }
    }
    return total;
  }
}

type AreaSpec = {
  id: string;
  label: string;
  icon: string;
  /** Folders whose top-level entries become the area's items. */
  roots: string[];
  /** Top-level names left out (counted in another area). */
  skip?: Set<string>;
};

async function realDir(p: string): Promise<string | null> {
  try {
    const real = await fs.realpath(p);
    return (await fs.stat(real)).isDirectory() ? real : null;
  } catch {
    return null;
  }
}

/** Past the biggest dozen, entries fold into one "others" line so the list stays readable. */
function tidy(items: UsageItem[]): UsageItem[] {
  const sorted = items.filter((i) => i.bytes > 0).sort((a, b) => b.bytes - a.bytes);
  const keep = sorted.slice(0, 12);
  const rest = sorted.slice(keep.length);
  if (rest.length > 1) {
    keep.push({ name: '', label: `${rest.length} other${rest.length === 1 ? '' : 's'}`, bytes: rest.reduce((s, i) => s + i.bytes, 0), files: rest.reduce((s, i) => s + i.files, 0) });
  } else keep.push(...rest);
  return keep;
}

async function measureArea(walker: Walker, spec: AreaSpec, siteDev: number | null, claimed: Set<string>): Promise<UsageArea | null> {
  const items: UsageItem[] = [];
  let where = '';
  let otherDrive = false;
  for (const root of spec.roots) {
    const real = await realDir(root);
    if (!real || claimed.has(real)) continue;
    claimed.add(real);
    where ||= real;
    const st = await fs.stat(real);
    if (siteDev !== null && st.dev !== siteDev) otherDrive = true;
    const names = await fs.readdir(real).catch(() => [] as string[]);
    for (const name of names) {
      if (spec.skip?.has(name)) continue;
      const full = path.join(real, name);
      // A link at the top (the data folders inside a release) belongs to its own area.
      const lst = await fs.lstat(full).catch(() => null);
      if (!lst || lst.isSymbolicLink()) continue;
      const t = await walker.size(full);
      const existing = items.find((i) => i.name === name);
      if (existing) { existing.bytes += t.bytes; existing.files += t.files; }
      else items.push({ name, label: labelFor(name), ...t });
    }
  }
  if (!where) return null;
  const bytes = items.reduce((s, i) => s + i.bytes, 0);
  const files = items.reduce((s, i) => s + i.files, 0);
  return { id: spec.id, label: spec.label, icon: spec.icon, where, bytes, files, ...(otherDrive ? { otherDrive } : {}), items: tidy(items) };
}

/** The release folder's parent when running under deploy.sh (APP_DIR/releases/<tag>). */
function appDir(cwd: string) {
  return path.basename(path.dirname(cwd)) === 'releases' ? path.dirname(path.dirname(cwd)) : null;
}

export async function measureStorage(opts: { cwd?: string; backupDir?: string } = {}): Promise<StorageReport> {
  const started = Date.now();
  const cwd = path.resolve(opts.cwd ?? process.cwd());
  const at = (...p: string[]) => path.join(cwd, ...p);
  const app = appDir(cwd);

  let disk: StorageReport['disk'] = null;
  let siteDev: number | null = null;
  try {
    const s = await fs.statfs(cwd);
    const total = s.blocks * s.bsize;
    const free = s.bavail * s.bsize;
    disk = { total, free, used: Math.max(0, total - s.bfree * s.bsize) };
  } catch { /* no disk figures */ }
  try { siteDev = (await fs.stat(cwd)).dev; } catch { /* unknown */ }

  const specs: AreaSpec[] = [
    { id: 'uploads', label: 'Photos & uploads', icon: '🖼️', roots: [at('public', 'uploads')] },
    { id: 'data', label: 'Site data', icon: '🗂️', roots: [at('.data'), at('public', 'content')] },
    { id: 'cache', label: 'Caches & AI models', icon: '🧠', roots: [at('.cache')] },
    { id: 'backups', label: 'Backups', icon: '💾', roots: [opts.backupDir ?? at('backups'), at('backups')] },
    {
      id: 'code', label: 'Site code', icon: '⚙️', roots: [cwd],
      skip: new Set(['.data', '.cache', 'backups', 'public']),
    },
  ];
  if (app) {
    specs.push({ id: 'releases', label: 'Older versions (kept for rollback)', icon: '🕰️', roots: [path.join(app, 'releases')], skip: new Set([path.basename(cwd)]) });
  }

  const walker = new Walker();
  const claimed = new Set<string>();
  const areas: UsageArea[] = [];
  for (const spec of specs) {
    const area = await measureArea(walker, spec, siteDev, claimed);
    if (area) areas.push(area);
  }
  // public/ minus uploads and content (icons, reader assets) is part of the code.
  const code = areas.find((a) => a.id === 'code');
  if (code) {
    const pub = await realDir(at('public'));
    if (pub) {
      const names = await fs.readdir(pub).catch(() => [] as string[]);
      let extra: Tally = { bytes: 0, files: 0 };
      for (const name of names) {
        if (name === 'uploads' || name === 'content') continue;
        const lst = await fs.lstat(path.join(pub, name)).catch(() => null);
        if (!lst || lst.isSymbolicLink()) continue;
        const t = await walker.size(path.join(pub, name));
        extra = { bytes: extra.bytes + t.bytes, files: extra.files + t.files };
      }
      if (extra.bytes) {
        code.bytes += extra.bytes;
        code.files += extra.files;
        code.items = tidy([...code.items.filter((i) => i.name), { name: 'public', label: 'Icons & static files', ...extra }]);
      }
    }
  }

  areas.sort((a, b) => b.bytes - a.bytes);
  const onSiteDrive = areas.filter((a) => !a.otherDrive).reduce((s, a) => s + a.bytes, 0);
  return {
    disk,
    areas,
    elsewhere: disk ? Math.max(0, disk.used - onSiteDrive) : null,
    scannedAt: new Date().toISOString(),
    tookMs: Date.now() - started,
  };
}
