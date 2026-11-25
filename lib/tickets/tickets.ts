// Tickets: bug reports, ideas and questions an enabled account files from any page.
// Pure logic only (cleaning input, the stored shape, the size cap); files and
// sessions live in store.ts and the routes.

import type { AutoInfo } from './auto';
import { cleanCommit, closedAt, historyOf, inverseRelation, isClosed, LINK_RELATIONS, MAX_LINKS, recordEvent, reporterHistory, type LinkRelation, type TicketActor, type TicketEvent, type TicketLink } from './history';

export const KINDS = ['bug', 'idea', 'question', 'other'] as const;
export const SEVERITIES = ['minor', 'annoying', 'blocking'] as const;
export const STATUSES = ['open', 'in_progress', 'done', 'wontfix'] as const;
export type TicketKind = (typeof KINDS)[number];
export type TicketSeverity = (typeof SEVERITIES)[number];
export type TicketStatus = (typeof STATUSES)[number];

export const MAX_MESSAGE = 4000;
export const MAX_REPLY = 4000;
export const MAX_TICKETS = 1000;
export const MAX_ERRORS = 10;
export const MAX_COMMENTS = 20;
/** Why a closed ticket was opened again. */
export const MAX_REASON = 500;
/** How long after closing the reporter can still reopen it. */
export const REOPEN_DAYS = 60;
/** Times a reporter may reopen one ticket. */
export const MAX_REPORTER_REOPENS = 5;

/** What the browser reports about itself. Everything here is client-supplied, so it's only trusted as text. */
export type TicketContext = {
  path: string;
  title?: string;
  clientTime?: string;
  timezone?: string;
  viewport?: string;
  screen?: string;
  pixelRatio?: number;
  userAgent?: string;
  theme?: string;
  online?: boolean;
  standalone?: boolean;
  referrer?: string;
  errors: string[];
  /** Set by the server from build-info.json. */
  build?: string;
};

export type TicketComment = { text: string; at: string };

export type Ticket = {
  id: string;
  /** From the session, never from the request. */
  userId: string;
  username: string;
  kind: TicketKind;
  severity?: TicketSeverity;
  message: string;
  status: TicketStatus;
  createdAt: string;
  updatedAt: string;
  /** Id of the stored image, if one was attached. */
  image?: string;
  context: TicketContext;
  /** Shown to the person who filed it. */
  reply?: { text: string; at: string };
  /** Follow-ups the reporter added while it was still open. */
  comments?: TicketComment[];
  /** Admin only. */
  note?: string;
  /** When the admin first opened it; absent means new. */
  seenAt?: string;
  /** Filed by the site itself (lib/tickets/auto.ts): how often, where and on which builds. */
  auto?: AutoInfo;
  /** What happened, oldest first (lib/tickets/history.ts). Absent on tickets stored before timelines. */
  history?: TicketEvent[];
  /** Other tickets this one is tied to; both sides hold the link. */
  links?: TicketLink[];
};

export type TicketsData = { tickets: Ticket[] };
export type TicketSettings = { enabledUserIds: string[] };

export const emptyTickets = (): TicketsData => ({ tickets: [] });
export const emptySettings = (): TicketSettings => ({ enabledUserIds: [] });

const ID = /^[\w-]{1,64}$/;
export const isUserId = (v: unknown): v is string => typeof v === 'string' && ID.test(v);

const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g;
const str = (v: unknown, max: number) => (typeof v === 'string' ? v.replace(CONTROL, '').trim().slice(0, max) : '');
const oneOf = <T extends string>(list: readonly T[], v: unknown): T | undefined => (list.includes(v as T) ? (v as T) : undefined);

/** Trimmed, capped text with runs of blank lines folded. */
export function cleanText(value: unknown, max: number): string {
  if (typeof value !== 'string') return '';
  return str(value.replace(/\r\n?/g, '\n').replace(/\n{3,}/g, '\n\n'), max);
}

/** A path on this site only, never an address somewhere else. */
export function cleanPath(value: unknown): string {
  const p = str(value, 400);
  return p.startsWith('/') && !p.startsWith('//') ? p : '/';
}

const isoOrUndefined = (v: unknown) => (typeof v === 'string' && !Number.isNaN(Date.parse(v)) ? new Date(v).toISOString() : undefined);
const bool = (v: unknown) => (typeof v === 'boolean' ? v : undefined);

export function cleanContext(value: unknown): TicketContext {
  const raw = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  const ctx: TicketContext = { path: cleanPath(raw.path), errors: [] };
  const set = <K extends keyof TicketContext>(key: K, v: TicketContext[K] | '' | undefined) => {
    if (v !== undefined && v !== '') ctx[key] = v as TicketContext[K];
  };
  set('title', str(raw.title, 160));
  set('clientTime', isoOrUndefined(raw.clientTime));
  set('timezone', str(raw.timezone, 60));
  set('viewport', str(raw.viewport, 20));
  set('screen', str(raw.screen, 20));
  set('pixelRatio', typeof raw.pixelRatio === 'number' && Number.isFinite(raw.pixelRatio) ? Math.round(raw.pixelRatio * 100) / 100 : undefined);
  set('userAgent', str(raw.userAgent, 400));
  set('theme', str(raw.theme, 20));
  set('online', bool(raw.online));
  set('standalone', bool(raw.standalone));
  set('referrer', str(raw.referrer, 300));
  if (Array.isArray(raw.errors)) ctx.errors = raw.errors.map((e) => str(e, 300)).filter(Boolean).slice(-MAX_ERRORS);
  return ctx;
}

export type NewTicketInput = { kind: unknown; severity?: unknown; message: unknown; context?: unknown };

export class TicketInputError extends Error {}

/** A new ticket from client input plus the facts the server knows. */
export function buildTicket(input: NewTicketInput, who: { userId: string; username: string }, extra: { id: string; now: Date; image?: string; build?: string }): Ticket {
  const kind = oneOf(KINDS, input.kind);
  if (!kind) throw new TicketInputError('Pick what kind of ticket this is');
  const message = cleanText(input.message, MAX_MESSAGE);
  if (!message) throw new TicketInputError('Write a few words about it first');
  const iso = extra.now.toISOString();
  const context = cleanContext(input.context);
  if (extra.build) context.build = extra.build;
  const ticket: Ticket = { id: extra.id, userId: who.userId, username: who.username, kind, message, status: 'open', createdAt: iso, updatedAt: iso, context, history: [{ at: iso, by: 'reporter', kind: 'filed' }] };
  const severity = kind === 'bug' ? oneOf(SEVERITIES, input.severity) : undefined;
  if (severity) ticket.severity = severity;
  if (extra.image) ticket.image = extra.image;
  return ticket;
}

/** Make room: drop the oldest closed tickets first, then the oldest of all. Returns the removed tickets. */
export function enforceCap(tickets: Ticket[], max = MAX_TICKETS): Ticket[] {
  const removed: Ticket[] = [];
  const closed = (t: Ticket) => t.status === 'done' || t.status === 'wontfix';
  while (tickets.length > max) {
    // Tickets are kept newest first, so the oldest is the last match.
    let idx = -1;
    for (let i = tickets.length - 1; i >= 0; i--) if (closed(tickets[i])) { idx = i; break; }
    if (idx < 0) idx = tickets.length - 1;
    removed.push(...tickets.splice(idx, 1));
  }
  return removed;
}

export type TicketPatch = { status?: unknown; reply?: unknown; note?: unknown; seen?: unknown; reason?: unknown };
type Editor = Extract<TicketActor, 'admin' | 'claude'>;

/** Change the status, noting it in the timeline. Opening a closed ticket again needs a reason. */
function changeStatus(ticket: Ticket, to: TicketStatus, reason: unknown, by: TicketActor, now: Date) {
  const from = ticket.status;
  if (from === to) return;
  if (isClosed(from) && !isClosed(to)) {
    const why = cleanText(reason, MAX_REASON);
    if (!why) throw new TicketInputError('Say why it’s being reopened');
    recordEvent(ticket, { by, kind: 'reopened', from, to, reason: why }, now);
  } else {
    recordEvent(ticket, { by, kind: 'status', from, to }, now);
  }
  ticket.status = to;
}

/** Apply an admin edit (or one from Claude's report) in place. An empty reply or note clears it. */
export function applyPatch(ticket: Ticket, patch: TicketPatch, now: Date, by: Editor = 'admin') {
  const iso = now.toISOString();
  if (patch.status !== undefined) {
    const status = oneOf(STATUSES, patch.status);
    if (!status) throw new TicketInputError('Unknown status');
    changeStatus(ticket, status, patch.reason, by, now);
  }
  if (patch.reply !== undefined) {
    const text = cleanText(patch.reply, MAX_REPLY);
    if (!text) {
      // Withdrawn: the reporter's view hides the earlier reply events too.
      if (ticket.reply) recordEvent(ticket, { by, kind: 'reply', text: '' }, now);
      delete ticket.reply;
    } else if (ticket.reply?.text !== text) {
      ticket.reply = { text, at: iso };
      recordEvent(ticket, { by, kind: 'reply', text }, now);
    }
  }
  if (patch.note !== undefined) {
    const note = cleanText(patch.note, MAX_REPLY);
    if (note !== (ticket.note ?? '')) recordEvent(ticket, { by, kind: 'note', text: note }, now);
    if (note) ticket.note = note; else delete ticket.note;
  }
  // Any admin action means they've looked at it.
  if (!ticket.seenAt) ticket.seenAt = iso;
  ticket.updatedAt = iso;
}

/** A follow-up from the reporter. Only while the ticket is still being worked on. */
export function addComment(ticket: Ticket, text: unknown, now: Date) {
  if (isClosed(ticket.status)) throw new TicketInputError('This one is closed. Reopen it, or file a new ticket');
  const clean = cleanText(text, MAX_MESSAGE);
  if (!clean) throw new TicketInputError('Write a few words first');
  const comments = ticket.comments ?? [];
  if (comments.length >= MAX_COMMENTS) throw new TicketInputError('That’s a lot of follow-ups. File a new ticket instead');
  ticket.comments = [...comments, { text: clean, at: now.toISOString() }];
  recordEvent(ticket, { by: 'reporter', kind: 'comment', text: clean }, now);
  ticket.updatedAt = now.toISOString();
  // New words from the reporter should light the dot again.
  delete ticket.seenAt;
}

/** Whether the reporter can still reopen it: closed, within REOPEN_DAYS, and not reopened too often. */
export function canReporterReopen(ticket: Ticket, now: Date): boolean {
  const closed = closedAt(ticket);
  if (!closed) return false;
  if (now.getTime() - Date.parse(closed) > REOPEN_DAYS * 86_400_000) return false;
  return historyOf(ticket).filter((e) => e.kind === 'reopened' && e.by === 'reporter').length < MAX_REPORTER_REOPENS;
}

/** The reporter says a closed ticket isn't sorted after all. Needs a reason. */
export function reopenByReporter(ticket: Ticket, reason: unknown, now: Date) {
  if (!isClosed(ticket.status)) throw new TicketInputError('This one is still open');
  const why = cleanText(reason, MAX_REASON);
  if (!why) throw new TicketInputError('Say what’s still wrong');
  if (!canReporterReopen(ticket, now)) throw new TicketInputError('This one was closed a while ago. File a new ticket instead');
  changeStatus(ticket, 'open', why, 'reporter', now);
  ticket.updatedAt = now.toISOString();
  delete ticket.seenAt;
}

/** Record the commit that fixed (or worked on) it. Returns false if that commit is already there. */
export function addCommit(ticket: Ticket, hash: unknown, message: unknown, by: TicketActor, now: Date): boolean {
  const clean = cleanCommit(hash);
  if (!clean) throw new TicketInputError('A commit is 7 to 40 hex characters');
  if (historyOf(ticket).some((e) => e.kind === 'commit' && !!e.hash && (e.hash.startsWith(clean) || clean.startsWith(e.hash)))) return false;
  const text = cleanText(message, 200);
  recordEvent(ticket, { by, kind: 'commit', hash: clean, ...(text ? { message: text } : {}) }, now);
  ticket.updatedAt = now.toISOString();
  return true;
}

/**
 * Link two tickets, both sides. `rel` is from the first ticket's side ("a is a duplicate
 * of b" gives b "duplicated by a"). Linking again with another relation replaces it.
 * Returns the tickets that changed (none if it was already so).
 */
export function linkTickets(list: Ticket[], fromId: unknown, toId: unknown, rel: unknown, by: TicketActor, now: Date): Ticket[] {
  const relation = oneOf(LINK_RELATIONS, rel);
  if (!relation) throw new TicketInputError('Unknown kind of link');
  if (typeof fromId !== 'string' || typeof toId !== 'string' || !ID.test(fromId) || !ID.test(toId)) throw new TicketInputError('That isn’t a ticket id');
  if (fromId === toId) throw new TicketInputError('A ticket can’t be linked to itself');
  const a = list.find((t) => t.id === fromId);
  const b = list.find((t) => t.id === toId);
  if (!a || !b) throw new TicketInputError('No ticket with that id');
  const back = inverseRelation(relation);
  if (a.links?.some((l) => l.id === b.id && l.rel === relation) && b.links?.some((l) => l.id === a.id && l.rel === back)) return [];
  for (const t of [a, b]) {
    const other = t === a ? b : a;
    if ((t.links ?? []).filter((l) => l.id !== other.id).length >= MAX_LINKS) throw new TicketInputError('That ticket has too many links already');
  }
  const iso = now.toISOString();
  const attach = (t: Ticket, other: Ticket, r: LinkRelation) => {
    t.links = [...(t.links ?? []).filter((l) => l.id !== other.id), { id: other.id, rel: r, at: iso }];
    recordEvent(t, { by, kind: 'linked', other: other.id, rel: r }, now);
    t.updatedAt = iso;
  };
  attach(a, b, relation);
  attach(b, a, back);
  return [a, b];
}

/** Undo a link, both sides (the other side may be gone already). Returns the tickets that changed. */
export function unlinkTickets(list: Ticket[], fromId: unknown, toId: unknown, by: TicketActor, now: Date): Ticket[] {
  const a = typeof fromId === 'string' ? list.find((t) => t.id === fromId) : undefined;
  const link = typeof toId === 'string' ? a?.links?.find((l) => l.id === toId) : undefined;
  if (!a || !link) throw new TicketInputError('Those tickets aren’t linked');
  const iso = now.toISOString();
  const changed: Ticket[] = [];
  const detach = (t: Ticket, otherId: string) => {
    const had = t.links?.find((l) => l.id === otherId);
    if (!had) return;
    const rest = (t.links ?? []).filter((l) => l.id !== otherId);
    if (rest.length) t.links = rest; else delete t.links;
    recordEvent(t, { by, kind: 'unlinked', other: otherId, rel: had.rel }, now);
    t.updatedAt = iso;
    changed.push(t);
  };
  detach(a, link.id);
  const b = list.find((t) => t.id === link.id);
  if (b) detach(b, a.id);
  return changed;
}

/** Drop links that point at tickets no longer in the list (after a delete or the cap). */
export function dropLinksTo(list: Ticket[], goneIds: Iterable<string>) {
  const gone = new Set(goneIds);
  if (!gone.size) return;
  for (const t of list) {
    if (!t.links?.some((l) => gone.has(l.id))) continue;
    const rest = t.links.filter((l) => !gone.has(l.id));
    if (rest.length) t.links = rest; else delete t.links;
  }
}

/**
 * What the person who filed it may see: no internal note, no technical details beyond
 * the page, a timeline without notes or commit hashes, and links only to other tickets
 * they filed themselves (`ownIds`).
 */
export function toMineAmong(t: Ticket, ownIds: ReadonlySet<string>, now = new Date()) {
  return {
    id: t.id, kind: t.kind, severity: t.severity, message: t.message, status: t.status, createdAt: t.createdAt, updatedAt: t.updatedAt,
    hasImage: !!t.image, page: t.context.path, reply: t.reply, comments: t.comments ?? [],
    history: reporterHistory(t, ownIds),
    links: (t.links ?? []).filter((l) => ownIds.has(l.id) && l.id !== t.id).map((l) => ({ id: l.id, rel: l.rel })),
    canReopen: canReporterReopen(t, now),
  };
}

/** The reporter's view without any links (when the rest of their tickets aren't at hand). */
export function toMine(t: Ticket) {
  return toMineAmong(t, new Set());
}

export type MineTicket = ReturnType<typeof toMineAmong>;

/** Whatever was stored, as tickets with the fields the app relies on, newest first. */
export function normalizeTickets(value: unknown): TicketsData {
  const list = value && typeof value === 'object' && Array.isArray((value as TicketsData).tickets) ? (value as TicketsData).tickets : [];
  const tickets = list.filter((t): t is Ticket => !!t && typeof t === 'object' && typeof t.id === 'string' && ID.test(t.id) && typeof t.userId === 'string' && typeof t.message === 'string' && typeof t.createdAt === 'string' && !!t.context && typeof t.context === 'object');
  tickets.sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
  return { tickets };
}

export function normalizeSettings(value: unknown): TicketSettings {
  const list = value && typeof value === 'object' && Array.isArray((value as TicketSettings).enabledUserIds) ? (value as TicketSettings).enabledUserIds : [];
  return { enabledUserIds: [...new Set(list.filter(isUserId))].slice(0, 500) };
}

export const isNew = (t: Ticket) => !t.seenAt;

export type BulkUpdate = { id: string; status?: unknown; reply?: unknown; reason?: unknown; commit?: unknown; related?: unknown };

/**
 * Several updates at once: "mark in progress" after copying, or Claude's pasted report
 * (`by` "claude": its commit is recorded and its related tickets linked both ways).
 * Throws on a bad status, a bad commit or a reopen without a reason, so the caller
 * can reject the lot. Changes the tickets in place.
 */
export function applyBulk(list: Ticket[], updates: BulkUpdate[], by: 'admin' | 'claude', now: Date) {
  const changed = new Map<string, Ticket>();
  const missing: string[] = [];
  const skippedLinks: string[] = [];
  for (const u of updates) {
    const found = list.find((t) => t.id === u.id);
    if (!found) { missing.push(u.id); continue; }
    // Only pass what was given: an absent reply must not clear an existing one.
    const patch: TicketPatch = {};
    const reply = typeof u.reply === 'string' && u.reply.trim() ? u.reply : undefined;
    if (u.status !== undefined) {
      patch.status = u.status;
      // A report that reopens a closed ticket gives its reason in the reply.
      const reopening = isClosed(found.status) && !isClosed(u.status as TicketStatus);
      patch.reason = u.reason ?? (reopening && by === 'claude' ? reply ?? 'Reopened in Claude’s report' : undefined);
    }
    if (reply) patch.reply = reply;
    applyPatch(found, patch, now, by);
    if (u.commit !== undefined) addCommit(found, u.commit, undefined, by, now);
    changed.set(found.id, found);
    for (const other of Array.isArray(u.related) ? u.related : []) {
      // Already linked (say, marked a duplicate by hand): a report doesn't turn it into "related".
      if (found.links?.some((l) => l.id === other)) continue;
      try {
        for (const t of linkTickets(list, found.id, other, 'related', by, now)) changed.set(t.id, t);
      } catch (error) {
        if (!(error instanceof TicketInputError)) throw error;
        skippedLinks.push(`${found.id} → ${String(other).slice(0, 64)}: ${error.message}`);
      }
    }
  }
  return { changed: [...changed.values()], missing, skippedLinks };
}
