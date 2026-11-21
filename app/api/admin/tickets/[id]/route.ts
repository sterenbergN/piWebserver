import { NextResponse } from 'next/server';
import { updateJson } from '@/lib/json-store';
import { isAdminAuthenticated } from '@/lib/security/server-auth';
import { deleteTicketImage, ticketsFile } from '@/lib/tickets/store';
import { applyPatch, emptyTickets, normalizeTickets, TicketInputError, type Ticket, type TicketsData } from '@/lib/tickets/tickets';

// One ticket, admin only: change status, reply (the author sees it), internal note, mark seen, delete.

export const dynamic = 'force-dynamic';
const unauthorized = () => NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
const ID = /^[\w-]{1,64}$/;

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await isAdminAuthenticated())) return unauthorized();
  const { id } = await params;
  const patch = await request.json().catch(() => null);
  if (!ID.test(id) || !patch || typeof patch !== 'object') return NextResponse.json({ error: 'Bad request' }, { status: 400 });
  try {
    const ticket = await updateJson<TicketsData, Ticket | null>(ticketsFile(), emptyTickets(), (stored) => {
      const list = normalizeTickets(stored).tickets;
      const found = list.find((t) => t.id === id);
      if (!found) return null;
      // "seen" alone only clears the new dot; anything else is a real change.
      if (patch.seen === true && Object.keys(patch).length === 1) found.seenAt ??= new Date().toISOString();
      else applyPatch(found, patch, new Date());
      stored.tickets = list;
      return found;
    });
    return ticket ? NextResponse.json({ ticket }) : NextResponse.json({ error: 'Not found' }, { status: 404 });
  } catch (error) {
    if (error instanceof TicketInputError) return NextResponse.json({ error: error.message }, { status: 400 });
    console.error('Update ticket failed:', error);
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await isAdminAuthenticated())) return unauthorized();
  const { id } = await params;
  if (!ID.test(id)) return NextResponse.json({ error: 'Bad request' }, { status: 400 });
  const image = await updateJson<TicketsData, string | undefined | false>(ticketsFile(), emptyTickets(), (stored) => {
    const list = normalizeTickets(stored).tickets;
    const found = list.find((t) => t.id === id);
    if (!found) return false;
    stored.tickets = list.filter((t) => t !== found);
    return found.image;
  });
  if (image === false) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  await deleteTicketImage(image);
  return NextResponse.json({ ok: true });
}
