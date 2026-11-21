import { NextResponse } from 'next/server';
import { updateJson } from '@/lib/json-store';
import { isAdminAuthenticated } from '@/lib/security/server-auth';
import { ticketsFile } from '@/lib/tickets/store';
import { applyPatch, emptyTickets, normalizeTickets, STATUSES, TicketInputError, type Ticket, type TicketsData } from '@/lib/tickets/tickets';

// Several tickets at once, admin only: POST { updates: [{ id, status?, reply? }] }.
// Used by "mark in progress" after copying and by "Paste Claude's report". All or nothing:
// one bad status rejects the lot so a half-applied report never happens.

export const dynamic = 'force-dynamic';
const MAX_UPDATES = 200;

export async function POST(request: Request) {
  if (!(await isAdminAuthenticated())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const body = await request.json().catch(() => null);
  const updates: unknown = body && typeof body === 'object' ? (body as { updates?: unknown }).updates : null;
  if (!Array.isArray(updates) || updates.length === 0 || updates.length > MAX_UPDATES) return NextResponse.json({ error: 'Expected a list of updates' }, { status: 400 });
  for (const u of updates) {
    const o = u && typeof u === 'object' ? (u as Record<string, unknown>) : null;
    if (!o || typeof o.id !== 'string') return NextResponse.json({ error: 'Every update needs an id' }, { status: 400 });
    if (o.status !== undefined && !STATUSES.includes(o.status as never)) return NextResponse.json({ error: 'Unknown status' }, { status: 400 });
  }
  try {
    const result = await updateJson<TicketsData, { changed: Ticket[]; missing: string[] }>(ticketsFile(), emptyTickets(), (stored) => {
      const list = normalizeTickets(stored).tickets;
      const changed: Ticket[] = [];
      const missing: string[] = [];
      const now = new Date();
      for (const u of updates as { id: string; status?: unknown; reply?: unknown }[]) {
        const found = list.find((t) => t.id === u.id);
        if (!found) { missing.push(u.id); continue; }
        // Only pass what was given: an absent reply must not clear an existing one.
        const patch: Record<string, unknown> = {};
        if (u.status !== undefined) patch.status = u.status;
        if (typeof u.reply === 'string' && u.reply.trim()) patch.reply = u.reply;
        applyPatch(found, patch, now);
        changed.push(found);
      }
      stored.tickets = list;
      return { changed, missing };
    });
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof TicketInputError) return NextResponse.json({ error: error.message }, { status: 400 });
    console.error('Bulk update tickets failed:', error);
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}
