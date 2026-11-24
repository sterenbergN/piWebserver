import crypto from 'crypto';
import { enforceCap, type Ticket } from './tickets';

// Tickets the site files about itself: errors in people's browsers, server errors,
// AI replies that couldn't be read, failed background jobs, and installs that had to
// roll back. The same problem seen again adds to one ticket (a count, the pages and
// builds it shows up on, a few samples) instead of making a new one. Pure, so it's
// tested without a server; store.ts and auto-store.ts do the files.

export type AutoSource = 'browser' | 'server' | 'ai' | 'job' | 'deploy';

export type AutoInfo = {
  source: AutoSource;
  fingerprint: string;
  count: number;
  firstSeen: string;
  lastSeen: string;
  /** Builds it was seen on, newest last. */
  builds: string[];
  /** Pages (or routes) it was seen on. */
  pages: string[];
  /** A few distinct examples (messages, the first lines of a stack). */
  samples: string[];
  /** Times it came back on a newer build after being marked done. */
  reopened?: number;
};

export type AutoIssue = {
  source: AutoSource;
  /** One line: what went wrong. */
  title: string;
  /** More, for the samples: a stack's first lines, the AI's complaint… */
  detail?: string;
  page?: string;
  build?: string;
  userAgent?: string;
  /** How many times this stands for (repeats gathered before writing). */
  count?: number;
};

export const SITE_USER = { userId: 'site', username: 'The site (automatic)' };
const MAX_LIST = 6;
/** New self-filed tickets per day; past that they're dropped (their counts still go on existing ones). */
export const MAX_NEW_PER_DAY = 25;
/** Open self-filed tickets at once. */
export const MAX_OPEN_AUTO = 80;

/** Messages that aren't the site's fault, or say nothing: extensions, being offline, cancelled requests. */
const NOISE = [
  /^script error\.?$/i,
  /resizeobserver loop/i,
  /(chrome|moz|safari(-web)?)-extension:\/\//i,
  /^(typeerror: )?(failed to fetch|load failed|networkerror when attempting to fetch resource\.?)$/i,
  /network ?error/i,
  /aborterror|the (operation|user) aborted|signal is aborted|cancell?ed/i,
  /^unhandled rejection: (undefined|null|\[object object\])?$/i,
  /__gcrweb|webkit\.messagehandlers|instagram|fb_?iab/i,
];

/** Noise, looking past the wrappers a browser puts round it ("Uncaught …", "Unhandled rejection: …"). */
export function isNoise(message: string) {
  const bare = message.trim().replace(/^(unhandled rejection: |uncaught (in promise )?)/i, '').replace(/\s*\([^)]*:\d+\)$/, '');
  return NOISE.some((re) => re.test(bare) || re.test(message.trim()));
}

/** The message with what varies taken out (addresses, ids, numbers, chunk names), for grouping. */
export function normalizeMessage(message: string): string {
  return message
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, '<url>')
    .replace(/\(?\/_next\/[^\s)]+\)?/g, '<chunk>')
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/g, '<id>')
    .replace(/\b[0-9a-z_-]*\d[0-9a-z_-]{5,}\b/g, '<id>')
    .replace(/\d+/g, '#')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 300);
}

/** A page's path with ids in it made generic: /study/tests/sets/3c7uUJl3Ber7?x=1 → /study/tests/sets/:id. */
export function normalizePage(page: string | undefined): string | undefined {
  if (!page) return undefined;
  const path = page.split(/[?#]/)[0] || '/';
  return path.split('/').map((seg) => (/\d/.test(seg) && seg.length >= 6 ? ':id' : seg)).join('/').slice(0, 120);
}

export function fingerprintOf(issue: Pick<AutoIssue, 'source' | 'title'>): string {
  return crypto.createHash('sha1').update(`${issue.source}|${normalizeMessage(issue.title)}`).digest('hex').slice(0, 16);
}

const pushUnique = (list: string[], value: string | undefined) => {
  if (!value || list.includes(value)) return list;
  return [...list, value].slice(-MAX_LIST);
};

const SOURCE_LABEL: Record<AutoSource, string> = { browser: 'Error in a browser', server: 'Server error', ai: 'AI problem', job: 'Background job failed', deploy: 'Install rolled back' };

/**
 * Add one occurrence to the tickets (newest first, changed in place). Returns what
 * happened, for logs and tests.
 */
export function applyAutoIssue(tickets: Ticket[], issue: AutoIssue, now: Date, newId: () => string): 'added' | 'counted' | 'reopened' | 'dropped' {
  const iso = now.toISOString();
  const fingerprint = fingerprintOf(issue);
  const page = normalizePage(issue.page);
  const sample = [issue.title, issue.detail].filter(Boolean).join('\n').slice(0, 600);
  const times = Math.max(1, Math.floor(issue.count ?? 1));
  const existing = tickets.find((t) => t.auto?.fingerprint === fingerprint && (t.status === 'open' || t.status === 'in_progress'))
    ?? tickets.find((t) => t.auto?.fingerprint === fingerprint);

  if (existing?.auto) {
    const auto = existing.auto;
    // Marked done, and here again on a build it wasn't seen on before: the fix didn't take.
    const cameBack = existing.status === 'done' && !!issue.build && !auto.builds.includes(issue.build);
    auto.count += times;
    auto.lastSeen = iso;
    auto.builds = pushUnique(auto.builds, issue.build);
    auto.pages = pushUnique(auto.pages, page);
    if (auto.samples.length < 3) auto.samples = pushUnique(auto.samples, sample);
    existing.updatedAt = iso;
    if (cameBack) {
      existing.status = 'open';
      auto.reopened = (auto.reopened ?? 0) + 1;
      delete existing.seenAt;
      return 'reopened';
    }
    return 'counted';
  }

  const today = iso.slice(0, 10);
  const newToday = tickets.filter((t) => t.auto && t.auto.firstSeen.slice(0, 10) === today).length;
  const openAuto = tickets.filter((t) => t.auto && (t.status === 'open' || t.status === 'in_progress')).length;
  if (newToday >= MAX_NEW_PER_DAY || openAuto >= MAX_OPEN_AUTO) return 'dropped';

  tickets.unshift({
    id: newId(),
    ...SITE_USER,
    kind: 'bug',
    severity: issue.source === 'server' || issue.source === 'deploy' ? 'annoying' : 'minor',
    message: `${SOURCE_LABEL[issue.source]}: ${issue.title}`.slice(0, 1000),
    status: 'open',
    createdAt: iso,
    updatedAt: iso,
    context: { path: page ?? '(none)', errors: issue.detail ? [issue.detail.slice(0, 300)] : [], build: issue.build, userAgent: issue.userAgent?.slice(0, 300) },
    auto: { source: issue.source, fingerprint, count: times, firstSeen: iso, lastSeen: iso, builds: issue.build ? [issue.build] : [], pages: page ? [page] : [], samples: [sample] },
  });
  enforceCap(tickets);
  return 'added';
}
