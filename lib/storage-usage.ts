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

// ── Everything else on the drive ─────────────────────────────────────────────
// The rest of the drive the site is on, with the site's own folders left out
// (they're measured above). Big, so only run when asked, and stopped after a
// time limit rather than tying up the Pi.

export type SystemFolder = {
  path: string;
  label?: string;
  /** What it is, and how to free it when that's safe. */
  hint?: string;
  bytes: number;
  files: number;
  /** The biggest things inside, drilling through folders that hold nearly all of it. */
  inside?: SystemFolder[];
};
export type SystemReport = {
  /** Where the drive starts: / on the Pi's SD card, a mount point for a USB drive. */
  root: string;
  bytes: number;
  files: number;
  folders: SystemFolder[];
  /** Folders only root can open: their size can't be counted. */
  unreadable: { count: number; examples: string[] };
  /** Ran out of time, so some folders were only partly counted. */
  partial: boolean;
  scannedAt: string;
  tookMs: number;
};

type TreeNode = { path: string; bytes: number; files: number; children?: TreeNode[] };

/** How deep the folder tree is kept for drilling (root is 0). */
const KEEP_DEPTH = 6;
/** Biggest children kept per folder. */
const KEEP_CHILDREN = 12;

/** Plain names and tips for the usual places space goes on a Raspberry Pi OS install. */
const SYSTEM_PLACES: { match: RegExp; label: string; hint?: string }[] = [
  { match: /^\/usr$/, label: 'Installed programs & libraries', hint: 'The operating system and everything installed with apt.' },
  { match: /^\/usr\/lib$/, label: 'Program libraries' },
  { match: /^\/usr\/share$/, label: 'Shared program files', hint: 'Icons, docs, fonts and data for installed programs.' },
  { match: /^\/usr\/local$/, label: 'Programs installed by hand', hint: 'Things installed outside apt, e.g. Node.js.' },
  { match: /^\/var$/, label: 'Logs, caches & program data' },
  { match: /^\/var\/log$/, label: 'System logs' },
  { match: /^\/var\/log\/journal$/, label: 'System journal', hint: 'Safe to trim: sudo journalctl --vacuum-size=100M' },
  { match: /^\/var\/cache\/apt$/, label: 'Downloaded package files', hint: 'Safe to clear: sudo apt clean' },
  { match: /^\/var\/lib\/apt\/lists$/, label: 'Package lists', hint: 'Rebuilt by sudo apt update.' },
  { match: /^\/var\/lib\/docker$/, label: 'Docker', hint: 'docker system prune removes unused images.' },
  { match: /^\/var\/swap$|^\/swapfile$/, label: 'Swap file', hint: 'Spare memory on disk. Its size is set in /etc/dphys-swapfile.' },
  { match: /^\/boot(\/firmware)?$/, label: 'Boot files' },
  { match: /^\/opt$/, label: 'Optional software' },
  { match: /^\/tmp$/, label: 'Temporary files', hint: 'Cleared on reboot.' },
  { match: /^\/home$/, label: 'Home folders' },
  { match: /^\/root$/, label: 'Root user’s home' },
  { match: /^\/snap$/, label: 'Snap packages' },
  { match: /^\/lib\/modules$|^\/usr\/lib\/modules$/, label: 'Kernel modules', hint: 'Old kernels’ modules go when sudo apt autoremove removes the kernels.' },
  { match: /\/\.npm$|\/\.npm\/_cacache$/, label: 'npm download cache', hint: 'Safe to clear: npm cache clean --force' },
  { match: /\/\.cache$/, label: 'Program caches', hint: 'Usually safe to delete; programs rebuild what they need.' },
  { match: /\/\.cache\/pip$/, label: 'pip download cache', hint: 'Safe to clear: pip cache purge' },
  { match: /\/\.pm2\/logs$/, label: 'pm2 logs', hint: 'The site’s own output logs. Safe to clear: pm2 flush' },
  { match: /\/\.pm2$/, label: 'pm2 (runs the site)' },
  { match: /\/\.vscode-server$/, label: 'VS Code remote server', hint: 'Left by VS Code remote editing; reinstalls itself next time.' },
  { match: /\/\.nvm$/, label: 'Node versions (nvm)', hint: 'nvm uninstall <version> removes old ones.' },
  { match: /\/\.local\/share\/Trash$/, label: 'Trash', hint: 'Files deleted from the desktop. Safe to empty.' },
  { match: /\/node_modules$/, label: 'node_modules' },
];

function describe(p: string): { label?: string; hint?: string } {
  const posix = p.replace(/\\/g, '/');
  const place = SYSTEM_PLACES.find((s) => s.match.test(posix));
  return place ? { label: place.label, ...(place.hint ? { hint: place.hint } : {}) } : {};
}

/** The top of the drive a path is on: climb while the parent is the same device. */
export async function driveRoot(p: string): Promise<string> {
  let cur = await fs.realpath(p);
  const dev = (await fs.stat(cur)).dev;
  for (;;) {
    const up = path.dirname(cur);
    if (up === cur) return cur;
    const st = await fs.stat(up).catch(() => null);
    if (!st || st.dev !== dev) return cur;
    cur = up;
  }
}

/** Every folder the site's own report covers, as real paths, so the drive scan skips them. */
export async function siteFolders(opts: { cwd?: string; backupDir?: string } = {}): Promise<string[]> {
  const cwd = path.resolve(opts.cwd ?? process.cwd());
  const app = appDir(cwd);
  const candidates = [
    app ?? cwd, cwd,
    path.join(cwd, '.data'), path.join(cwd, '.cache'), path.join(cwd, 'backups'),
    path.join(cwd, 'public', 'uploads'), path.join(cwd, 'public', 'content'),
    ...(opts.backupDir ? [opts.backupDir] : []),
  ];
  const real = await Promise.all(candidates.map((c) => fs.realpath(c).catch(() => null)));
  return [...new Set(real.filter((r): r is string => !!r))];
}

class TreeWalker {
  private seen = new Set<string>();
  unreadable = { count: 0, examples: [] as string[] };
  partial = false;

  constructor(private dev: number, private skip: Set<string>, private deadline: number) {}

  async node(p: string, depth: number): Promise<TreeNode | null> {
    if (this.skip.has(p)) return null;
    const st = await fs.lstat(p).catch(() => null);
    // Links, and other drives mounted inside this one (/proc, /boot/firmware…), aren't this drive's space.
    if (!st || st.isSymbolicLink() || st.dev !== this.dev) return null;
    if (!st.isDirectory()) {
      if (st.nlink > 1) {
        const key = `${st.dev}:${st.ino}`;
        if (this.seen.has(key)) return null;
        this.seen.add(key);
      }
      return { path: p, bytes: sizeOf(st), files: 1 };
    }
    const node: TreeNode = { path: p, bytes: sizeOf(st), files: 0 };
    if (Date.now() > this.deadline) { this.partial = true; return node; }
    let names: string[];
    try {
      names = await fs.readdir(p);
    } catch {
      this.unreadable.count++;
      if (this.unreadable.examples.length < 5) this.unreadable.examples.push(p);
      return node;
    }
    const keep = depth < KEEP_DEPTH;
    const kids: TreeNode[] = [];
    for (let i = 0; i < names.length; i += 16) {
      const parts = await Promise.all(names.slice(i, i + 16).map((name) => this.node(path.join(p, name), depth + 1)));
      for (const part of parts) {
        if (!part) continue;
        node.bytes += part.bytes;
        node.files += part.files;
        if (keep && part.bytes > 0) kids.push(part);
      }
    }
    if (keep && kids.length) node.children = kids.sort((a, b) => b.bytes - a.bytes).slice(0, KEEP_CHILDREN);
    return node;
  }
}

const toFolder = (n: TreeNode): SystemFolder => ({ path: n.path, ...describe(n.path), bytes: n.bytes, files: n.files });

/** The biggest things in a folder, going straight through any folder that is nearly all of its parent (/home → /home/pi). */
function biggestInside(n: TreeNode): SystemFolder[] {
  const kids = n.children ?? [];
  if (kids[0]?.children?.length && kids[0].bytes >= n.bytes * 0.95) return biggestInside(kids[0]);
  return kids.slice(0, 8).map(toFolder);
}

export async function measureSystem(opts: { cwd?: string; backupDir?: string; root?: string; skip?: string[]; timeLimitMs?: number } = {}): Promise<SystemReport> {
  const started = Date.now();
  const cwd = path.resolve(opts.cwd ?? process.cwd());
  const root = opts.root ? await fs.realpath(opts.root) : await driveRoot(cwd);
  const skip = new Set(opts.skip ?? await siteFolders(opts));
  const dev = (await fs.stat(root)).dev;
  const walker = new TreeWalker(dev, skip, started + (opts.timeLimitMs ?? 150_000));
  const tree = (await walker.node(root, 0)) ?? { path: root, bytes: 0, files: 0 };

  const folders: SystemFolder[] = (tree.children ?? []).map((n) => {
    const inside = biggestInside(n);
    return { ...toFolder(n), ...(inside.length ? { inside } : {}) };
  });
  const shown = folders.reduce((s, f) => s + f.bytes, 0);
  if (tree.bytes - shown > 0 && (tree.children?.length ?? 0) >= KEEP_CHILDREN) {
    folders.push({ path: '', label: 'Everything smaller', bytes: tree.bytes - shown, files: Math.max(0, tree.files - folders.reduce((s, f) => s + f.files, 0)) });
  }
  return {
    root,
    bytes: tree.bytes,
    files: tree.files,
    folders,
    unreadable: walker.unreadable,
    partial: walker.partial,
    scannedAt: new Date().toISOString(),
    tookMs: Date.now() - started,
  };
}
