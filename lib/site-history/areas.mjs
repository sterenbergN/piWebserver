// Which part of the site a commit belongs to. One function, used by the generator, so the
// mapping lives in a single testable place. Plain .mjs so `node scripts/site-history.mjs`
// can import it without a TypeScript step.

/** Areas that are support work rather than something a visitor can open. */
export const SUPPORT_AREAS = ['Infrastructure', 'Navigation', 'Accounts', 'Other'];

// A folder name (or message scope) -> area. Keys are lowercase with only letters and digits.
const ALIASES = {
  workout: 'Workout', health: 'Workout', coach: 'Workout', gym: 'Workout',
  notes: 'Notes', note: 'Notes', quicknotes: 'Quick notes',
  reader: 'Reader', library: 'Library', golf: 'Golf',
  skills: 'Skills', skill: 'Skills',
  study: 'Study', pastudy: 'Study', pa: 'Study',
  recipes: 'Recipes', recipe: 'Recipes',
  habits: 'Habits', habit: 'Habits',
  daily: 'Daily questions', dailyquestions: 'Daily questions', dailypacks: 'Daily questions', dailygenerator: 'Daily questions',
  party: 'Party', kartclash: 'Party', debate: 'Party',
  game: 'Arcade', games: 'Arcade', arcade: 'Arcade',
  looplab: 'Loop Lab', lab: 'Loop Lab',
  tools: 'Tools', tool: 'Tools', calculators: 'Tools', calculator: 'Tools', calc: 'Tools',
  movies: 'Tools', movie: 'Tools', moviepicker: 'Tools', movielist: 'Tools', wheretoeat: 'Tools',
  blog: 'Blog', gallery: 'Gallery', media: 'Gallery',
  journal: 'Journal', chores: 'Chores', resume: 'Resume', cad: 'CAD',
  stats: 'Stats', systemstats: 'Stats', storageusage: 'Stats', cpudetail: 'Stats',
  today: 'Today', progress: 'Today',
  admin: 'Admin', backup: 'Admin', backups: 'Admin',
  ai: 'AI',
  security: 'Accounts', login: 'Accounts', account: 'Accounts', accounts: 'Accounts', auth: 'Accounts',
  accountexport: 'Accounts', accountsession: 'Accounts', accountmenu: 'Accounts', proxy: 'Accounts',
  nav: 'Navigation', navigation: 'Navigation', navbar: 'Navigation', launcher: 'Navigation', rooms: 'Navigation',
  explore: 'Navigation', home: 'Navigation', homeapps: 'Navigation', search: 'Navigation', sitesearch: 'Navigation',
  apps: 'Navigation', navlinks: 'Navigation', navbadges: 'Navigation', usenavpins: 'Navigation',
  upload: 'Gallery', delete: 'Gallery', downloadalbum: 'Gallery', uploadclient: 'Gallery',
  addtohomescreen: 'Navigation', sitepopup: 'Navigation', sitecontent: 'Navigation',
  serviceworkerregistrar: 'Infrastructure', analyticstracker: 'Infrastructure', themeprovider: 'Infrastructure',
  progressbar: 'Infrastructure', usewakelock: 'Infrastructure', jsonstore: 'Infrastructure', zipstream: 'Infrastructure',
  ci: 'Infrastructure', release: 'Infrastructure', deploy: 'Infrastructure', shell: 'Infrastructure',
  mobile: 'Infrastructure', tests: 'Infrastructure', test: 'Infrastructure', e2e: 'Infrastructure',
  docs: 'Infrastructure', scripts: 'Infrastructure',
};

const norm = (s) => s.toLowerCase().replace(/(\.test)?\.[a-z]+$/, '').replace(/[^a-z0-9]/g, '');
const lookup = (s) => ALIASES[norm(s)] ?? null;

// Files that are plumbing wherever they sit.
const INFRA_ROOT = /^(\.github|\.githooks|\.claude|tools|e2e|public|seed|next\.config|package|tsconfig|eslint|playwright|instrumentation|benchmark|README|LICENSE|CLAUDE|AGENTS|\.gitignore|\.gitattributes)/;
const APP_ROOT_INFRA = /^(layout|globals|icon|apple-icon|favicon|manifest|robots|not-found|opengraph|sitemap|feed)/;

/** The area a single changed path belongs to. */
export function areaForPath(file) {
  const p = file.replace(/\\/g, '/');
  const parts = p.split('/');
  const top = parts[0];
  const second = parts[1] ?? '';
  const third = parts[2] ?? '';
  if (top === 'app') {
    if (parts.length === 2) {
      if (second === 'page.tsx' || second.startsWith('home.') || second.startsWith('page.')) return 'Navigation';
      if (APP_ROOT_INFRA.test(second)) return 'Infrastructure';
      return 'Infrastructure';
    }
    if (second === 'api') return lookup(third) ?? 'Other';
    return lookup(second) ?? 'Other';
  }
  if (top === 'lib' || top === 'components') {
    if (parts.length === 2) return lookup(second) ?? 'Other';
    return lookup(second) ?? 'Other';
  }
  if (top === 'docs') return lookup(second) ?? 'Infrastructure';
  if (top === 'scripts') return /daily/.test(second) ? 'Daily questions' : 'Infrastructure';
  if (top === 'tests') return /recipe|kitchen/.test(second) ? 'Recipes' : 'Infrastructure';
  if (top === 'proxy.ts') return 'Accounts';
  if (INFRA_ROOT.test(p) || parts.length === 1) return 'Infrastructure';
  return 'Other';
}

/** Scopes written in a message: "feat(a,b): x", or a free-form "Workout: x" / "Loop Lab phase 1: x" start. */
export function areasFromMessage(subject) {
  const out = new Set();
  const s = subject.replace(/^﻿/, '').replace(/^[^\p{L}\p{N}]+/u, '');
  const conv = /^[a-z]+\(([^)]*)\)!?:/i.exec(s);
  if (conv) {
    for (const scope of conv[1].split(/[,/]/)) {
      const a = lookup(scope.trim());
      if (a) out.add(a);
    }
    return [...out];
  }
  const head = s.split(':')[0];
  if (head !== s && head.length <= 40) {
    // "Loop Lab phase 1" -> the longest leading run of words (up to three) that names an area.
    const words = head.trim().split(/\s+/);
    for (let n = Math.min(words.length, 3); n >= 1; n--) {
      const a = lookup(words.slice(0, n).join(' '));
      if (a) { out.add(a); break; }
    }
  }
  return [...out];
}

/**
 * The areas of one commit, strongest first. `files` is [{path, weight}] (weight = lines changed).
 * Path areas count when they carry a real share of the change; shared plumbing (Navigation,
 * Infrastructure, Accounts) only when it is a big part of the commit or the message names it.
 */
export function areasForCommit(subject, files) {
  const fromMessage = areasFromMessage(subject);
  const weight = new Map();
  let total = 0;
  for (const f of files) {
    const a = areaForPath(f.path);
    const w = Math.max(1, f.weight);
    weight.set(a, (weight.get(a) ?? 0) + w);
    total += w;
  }
  const ranked = [...weight.entries()].sort((x, y) => y[1] - x[1]);
  const picked = [];
  for (const [a, w] of ranked) {
    const share = total ? w / total : 0;
    const support = SUPPORT_AREAS.includes(a);
    if (share >= (support ? 0.3 : 0.1) || fromMessage.includes(a)) picked.push(a);
    if (picked.length >= 6) break;
  }
  for (const a of fromMessage) if (!picked.includes(a)) picked.push(a);
  if (!picked.length && ranked.length) picked.push(ranked[0][0]);
  // Drop the catch-all when something real is named.
  const real = picked.filter((a) => a !== 'Other');
  return real.length ? real : picked.length ? picked : ['Other'];
}
