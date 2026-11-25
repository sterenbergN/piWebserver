import { NextResponse } from 'next/server';
import { updateJson } from '@/lib/json-store';
import { createLimiter } from '@/lib/security/rate-limit';
import { ApiError, handleApiError } from '@/lib/workout/api';
import { ticketsFile } from '@/lib/tickets/store';
import { addComment, emptyTickets, normalizeTickets, reopenByReporter, toMineAmong, TicketInputError, type MineTicket, type TicketsData } from '@/lib/tickets/tickets';
import { requireReporter } from '@/lib/tickets/who';

// One of your own tickets: POST { comment } adds a follow-up while it is open or in
// progress; POST { reopen: "why" } opens a done or won't-fix one again (within 60 days of
// closing it, with a reason). Both go into the ticket's timeline.

export const dynamic = 'force-dynamic';
const PRIVATE = { 'Cache-Control': 'no-store, private' };
const ID = /^[\w-]{1,64}$/;
// Follow-ups and reopens together: plenty for a person, and a stuck button can't flood the admin.
const limiter = createLimiter({ max: 20, windowMs: 60 * 60_000 });

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const who = await requireReporter();
    const { id } = await params;
    const body = await request.json().catch(() => null);
    if (!ID.test(id) || !body || typeof body !== 'object') throw new ApiError(400, 'Invalid request');
    const { comment, reopen } = body as { comment?: unknown; reopen?: unknown };
    if (comment === undefined && reopen === undefined) throw new ApiError(400, 'Invalid request');
    const wait = limiter.retryAfter(who.userId);
    if (wait) throw new ApiError(429, `That's a lot of changes. Try again in ${Math.ceil(wait / 60)} minutes.`);
    const mine = await updateJson<TicketsData, MineTicket | false>(ticketsFile(), emptyTickets(), (stored) => {
      const list = normalizeTickets(stored).tickets;
      const found = list.find((t) => t.id === id && t.userId === who.userId);
      if (!found) return false;
      const now = new Date();
      try {
        if (reopen !== undefined) reopenByReporter(found, reopen, now);
        else addComment(found, comment, now);
      } catch (error) {
        if (error instanceof TicketInputError) throw new ApiError(400, error.message);
        throw error;
      }
      stored.tickets = list;
      return toMineAmong(found, new Set(list.filter((t) => t.userId === who.userId).map((t) => t.id)), now);
    });
    if (!mine) throw new ApiError(404, 'Ticket not found');
    limiter.hit(who.userId);
    return NextResponse.json({ success: true, ticket: mine }, { headers: PRIVATE });
  } catch (error) {
    return handleApiError(error, 'Update own ticket failed');
  }
}
