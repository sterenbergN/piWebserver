import { NextResponse } from 'next/server';
import { updateJson } from '@/lib/json-store';
import { ApiError, handleApiError } from '@/lib/workout/api';
import { ticketsFile } from '@/lib/tickets/store';
import { addComment, emptyTickets, normalizeTickets, toMine, TicketInputError, type TicketsData } from '@/lib/tickets/tickets';
import { requireReporter } from '@/lib/tickets/who';

// A follow-up on one of your own tickets: POST { comment }. Only while it is still open or in progress.

export const dynamic = 'force-dynamic';
const PRIVATE = { 'Cache-Control': 'no-store, private' };
const ID = /^[\w-]{1,64}$/;

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const who = await requireReporter();
    const { id } = await params;
    const body = await request.json().catch(() => null);
    if (!ID.test(id) || !body || typeof body !== 'object') throw new ApiError(400, 'Invalid request');
    const mine = await updateJson<TicketsData, ReturnType<typeof toMine> | null>(ticketsFile(), emptyTickets(), (stored) => {
      const list = normalizeTickets(stored).tickets;
      const found = list.find((t) => t.id === id && t.userId === who.userId);
      if (!found) return null;
      try {
        addComment(found, (body as { comment?: unknown }).comment, new Date());
      } catch (error) {
        if (error instanceof TicketInputError) throw new ApiError(400, error.message);
        throw error;
      }
      stored.tickets = list;
      return toMine(found);
    });
    if (!mine) throw new ApiError(404, 'Ticket not found');
    return NextResponse.json({ success: true, ticket: mine }, { headers: PRIVATE });
  } catch (error) {
    return handleApiError(error, 'Add follow-up failed');
  }
}
