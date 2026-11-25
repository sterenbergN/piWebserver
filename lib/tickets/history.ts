import type { Ticket, TicketStatus } from './tickets';

// Each ticket's timeline: what happened to it, by whom, in order. Append-only and
// capped (the oldest drop off). Tickets stored before timelines existed get one built
// at read time from what they have (createdAt, comments, the reply, the status), so
// the file isn't rewritten just to look at them. Pure: no files, no runtime imports
// from tickets.ts (it imports from here).

export const MAX_HISTORY = 200;
export const MAX_LINKS = 50;

export type TicketActor = 'reporter' | 'admin' | 'site' | 'claude';
export const LINK_RELATIONS = ['related', 'duplicate_of', 'duplicated_by'] as const;
export type LinkRelation = (typeof LINK_RELATIONS)[number];
export type TicketLink = { id: string; rel: LinkRelation; at: string };

type Base = {
  at: string;
  by: TicketActor;
  /** Built at read time for a ticket stored before timelines: the time may be a guess. */
  approx?: true;
};

export type TicketEvent = Base & (
  | { kind: 'filed' }
  | { kind: 'status'; from: TicketStatus; to: TicketStatus }
  | { kind: 'reply'; text: string }
  /** Admin only. Empty text means the note was cleared. */
  | { kind: 'note'; text: string }
  | { kind: 'comment'; text: string }
  | { kind: 'reopened'; from: TicketStatus; to: TicketStatus; reason: string }
  | { kind: 'linked'; other: string; rel: LinkRelation }
  | { kind: 'unlinked'; other: string; rel: LinkRelation }
  /** Admin only in full; reporters see "Fixed in a site update". */
  | { kind: 'commit'; hash?: string; message?: string }
  | { kind: 'seen_again'; build?: string; count: number }
);

/** An event as it's recorded: `at` defaults to now. */
export type NewEvent = TicketEvent extends infer E ? (E extends TicketEvent ? Omit<E, 'at' | 'approx'> & { at?: string } : never) : never;

export const isClosed = (s: TicketStatus) => s === 'done' || s === 'wontfix';

/** The other side of a link: a duplicate of B makes B duplicated by A. */
export const inverseRelation = (rel: LinkRelation): LinkRelation => (rel === 'duplicate_of' ? 'duplicated_by' : rel === 'duplicated_by' ? 'duplicate_of' : 'related');

const COMMIT = /^[0-9a-f]{7,40}$/i;
/** A short or full git hash, lower case; undefined if it isn't one. */
export function cleanCommit(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const v = value.trim();
  return COMMIT.test(v) ? v.toLowerCase() : undefined;
}

/** The timeline a ticket stored before timelines would have had, as near as can be told. */
function reconstruct(t: Ticket): TicketEvent[] {
  const filer: TicketActor = t.auto ? 'site' : 'reporter';
  const events: TicketEvent[] = [{ at: t.createdAt, by: filer, kind: 'filed' }];
  for (const c of t.comments ?? []) events.push({ at: c.at, by: 'reporter', kind: 'comment', text: c.text });
  if (t.reply) events.push({ at: t.reply.at, by: 'admin', kind: 'reply', text: t.reply.text });
  if (t.status !== 'open') events.push({ at: t.updatedAt || t.createdAt, by: 'admin', kind: 'status', from: 'open', to: t.status, approx: true });
  // By time (sort is stable), with the filing first even if a clock disagreed.
  const [filed, ...rest] = events;
  return [filed, ...rest.sort((a, b) => a.at.localeCompare(b.at))];
}

/** The ticket's timeline, oldest first. Never changes the ticket. */
export function historyOf(t: Ticket): TicketEvent[] {
  return Array.isArray(t.history) && t.history.length ? t.history : reconstruct(t);
}

/** Add an event (building the old timeline first if there wasn't one). Drops the oldest past the cap. */
export function recordEvent(t: Ticket, event: NewEvent, now = new Date()): TicketEvent {
  const history = Array.isArray(t.history) && t.history.length ? t.history : reconstruct(t);
  const full = { ...event, at: event.at ?? now.toISOString() } as TicketEvent;
  history.push(full);
  if (history.length > MAX_HISTORY) history.splice(0, history.length - MAX_HISTORY);
  t.history = history;
  return full;
}

/** When it was last closed (done or won't fix), or undefined while it's open. */
export function closedAt(t: Ticket): string | undefined {
  if (!isClosed(t.status)) return undefined;
  const history = historyOf(t);
  for (let i = history.length - 1; i >= 0; i--) {
    const e = history[i];
    if ((e.kind === 'status' || e.kind === 'reopened') && isClosed(e.to)) return e.at;
  }
  return t.updatedAt || t.createdAt;
}

/** The ticket with its timeline filled in, for the admin. */
export const withHistory = (t: Ticket): Ticket => ({ ...t, history: historyOf(t), links: t.links ?? [] });

export type ReporterEvent =
  | { at: string; by: 'reporter' | 'admin'; kind: 'filed' }
  | { at: string; by: 'reporter' | 'admin'; kind: 'status'; from: TicketStatus; to: TicketStatus }
  | { at: string; by: 'reporter' | 'admin'; kind: 'reply'; text: string }
  | { at: string; by: 'reporter' | 'admin'; kind: 'comment'; text: string }
  | { at: string; by: 'reporter' | 'admin'; kind: 'reopened'; from: TicketStatus; to: TicketStatus; reason: string }
  | { at: string; by: 'reporter' | 'admin'; kind: 'linked' | 'unlinked'; other: string; rel: LinkRelation }
  | { at: string; by: 'reporter' | 'admin'; kind: 'commit' };

/**
 * What the reporter may see of the timeline: no admin notes, no commit hashes or
 * messages (just that a site update fixed it), links only to their own tickets, and
 * no site-side counts. Claude's and the site's actions read as the admin's.
 */
export function reporterHistory(t: Ticket, ownIds: ReadonlySet<string>): ReporterEvent[] {
  const all = historyOf(t);
  // A reply the admin later withdrew (cleared) shouldn't linger in the reporter's view.
  let lastWithdrawn = -1;
  all.forEach((e, i) => { if (e.kind === 'reply' && !e.text) lastWithdrawn = i; });
  const out: ReporterEvent[] = [];
  all.forEach((e, i) => {
    const by = e.by === 'reporter' ? 'reporter' : 'admin';
    const base = { at: e.at, by } as const;
    switch (e.kind) {
      case 'filed': out.push({ ...base, kind: 'filed' }); break;
      case 'status': out.push({ ...base, kind: 'status', from: e.from, to: e.to }); break;
      case 'reply': if (e.text && i > lastWithdrawn) out.push({ ...base, kind: 'reply', text: e.text }); break;
      case 'comment': out.push({ ...base, kind: 'comment', text: e.text }); break;
      case 'reopened': out.push({ ...base, kind: 'reopened', from: e.from, to: e.to, reason: e.reason }); break;
      case 'linked': case 'unlinked': if (ownIds.has(e.other) && e.other !== t.id) out.push({ ...base, kind: e.kind, other: e.other, rel: e.rel }); break;
      case 'commit': out.push({ ...base, kind: 'commit' }); break;
      default: break; // notes and site counts stay with the admin
    }
  });
  return out;
}
