import { NextResponse } from 'next/server';
import { updateJson } from '@/lib/json-store';
import { isAdminAuthenticated } from '@/lib/security/server-auth';
import { cleanCommit, withHistory } from '@/lib/tickets/history';
import { ticketsFile } from '@/lib/tickets/store';
import { applyBulk, emptyTickets, normalizeTickets, STATUSES, TicketInputError, type BulkUpdate, type Ticket, type TicketsData } from '@/lib/tickets/tickets';

// Several tickets at once, admin only: POST { updates: [{ id, status?, reply?, reason?, commit?, related?, duplicateOf? }], source? }.
// Used by "mark in progress" after copying and by "Paste Claude's report" (source "claude",
// which records the commit and links the related tickets as Claude's). All or nothing:
// one bad status or commit rejects the lot so a half-applied report never happens.

export const dynamic = 'force-dynamic';
const MAX_UPDATES = 200;

export async function POST(request: Request) {
  if (!(await isAdminAuthenticated())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const body = await request.json().catch(() => null);
  const updates: unknown = body && typeof body === 'object' ? (body as { updates?: unknown }).updates : null;
  const by = body && (body as { source?: unknown }).source === 'claude' ? 'claude' : 'admin';
  if (!Array.isArray(updates) || updates.length === 0 || updates.length > MAX_UPDATES) return NextResponse.json({ error: 'Expected a list of updates' }, { status: 400 });
  for (const u of updates) {
    const o = u && typeof u === 'object' ? (u as Record<string, unknown>) : null;
    if (!o || typeof o.id !== 'string') return NextResponse.json({ error: 'Every update needs an id' }, { status: 400 });
    if (o.status !== undefined && !STATUSES.includes(o.status as never)) return NextResponse.json({ error: 'Unknown status' }, { status: 400 });
    if (o.commit !== undefined && !cleanCommit(o.commit)) return NextResponse.json({ error: `${o.id}: a commit is 7 to 40 hex characters` }, { status: 400 });
    if (o.related !== undefined && !Array.isArray(o.related)) return NextResponse.json({ error: `${o.id}: related must be a list of ticket ids` }, { status: 400 });
    if (o.duplicateOf !== undefined && typeof o.duplicateOf !== 'string') return NextResponse.json({ error: `${o.id}: duplicateOf must be a ticket id` }, { status: 400 });
  }
  try {
    const result = await updateJson<TicketsData, { changed: Ticket[]; missing: string[]; skippedLinks: string[] }>(ticketsFile(), emptyTickets(), (stored) => {
      const list = normalizeTickets(stored).tickets;
      const out = applyBulk(list, updates as BulkUpdate[], by, new Date());
      stored.tickets = list;
      return { ...out, changed: out.changed.map(withHistory) };
    });
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof TicketInputError) return NextResponse.json({ error: error.message }, { status: 400 });
    console.error('Bulk update tickets failed:', error);
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}
