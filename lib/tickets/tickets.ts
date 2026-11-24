// Tickets: bug reports, ideas and questions an enabled account files from any page.
// Pure logic only (cleaning input, the stored shape, the size cap); files and
// sessions live in store.ts and the routes.

import type { AutoInfo } from './auto';

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
  const ticket: Ticket = { id: extra.id, userId: who.userId, username: who.username, kind, message, status: 'open', createdAt: iso, updatedAt: iso, context };
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

export type TicketPatch = { status?: unknown; reply?: unknown; note?: unknown; seen?: unknown };

/** Apply an admin edit in place. An empty reply or note clears it. */
export function applyPatch(ticket: Ticket, patch: TicketPatch, now: Date) {
  const iso = now.toISOString();
  if (patch.status !== undefined) {
    const status = oneOf(STATUSES, patch.status);
    if (!status) throw new TicketInputError('Unknown status');
    ticket.status = status;
  }
  if (patch.reply !== undefined) {
    const text = cleanText(patch.reply, MAX_REPLY);
    if (!text) delete ticket.reply;
    else if (ticket.reply?.text !== text) ticket.reply = { text, at: iso };
  }
  if (patch.note !== undefined) {
    const note = cleanText(patch.note, MAX_REPLY);
    if (note) ticket.note = note; else delete ticket.note;
  }
  // Any admin action means they've looked at it.
  if (!ticket.seenAt) ticket.seenAt = iso;
  ticket.updatedAt = iso;
}

/** A follow-up from the reporter. Only while the ticket is still being worked on. */
export function addComment(ticket: Ticket, text: unknown, now: Date) {
  if (ticket.status === 'done' || ticket.status === 'wontfix') throw new TicketInputError('This one is closed. File a new ticket instead');
  const clean = cleanText(text, MAX_MESSAGE);
  if (!clean) throw new TicketInputError('Write a few words first');
  const comments = ticket.comments ?? [];
  if (comments.length >= MAX_COMMENTS) throw new TicketInputError('That’s a lot of follow-ups. File a new ticket instead');
  ticket.comments = [...comments, { text: clean, at: now.toISOString() }];
  ticket.updatedAt = now.toISOString();
  // New words from the reporter should light the dot again.
  delete ticket.seenAt;
}

/** What the person who filed it may see: no internal note and no technical details beyond the page. */
export function toMine(t: Ticket) {
  return { id: t.id, kind: t.kind, severity: t.severity, message: t.message, status: t.status, createdAt: t.createdAt, updatedAt: t.updatedAt, hasImage: !!t.image, page: t.context.path, reply: t.reply, comments: t.comments ?? [] };
}

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
