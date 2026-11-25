import { NextResponse } from 'next/server';
import { updateJson } from '@/lib/json-store';
import { isAdminAuthenticated } from '@/lib/security/server-auth';
import { withHistory } from '@/lib/tickets/history';
import { deleteTicketImage, ticketsFile } from '@/lib/tickets/store';
import { addCommit, applyPatch, dropLinksTo, emptyTickets, linkTickets, normalizeTickets, TicketInputError, unlinkTickets, type Ticket, type TicketsData } from '@/lib/tickets/tickets';

// One ticket, admin only. PATCH changes status (reopening a closed one needs `reason`),
// reply (the author sees it), internal note, marks it seen, and also takes
// `link: { id, rel }` / `unlink: id` (both tickets change) and `commit: { hash, message? }`.
// Every change goes into the ticket's timeline. DELETE removes it and links to it.
// Answers { ticket, changed } with timelines filled in; `changed` includes the other side of a link.

export const dynamic = 'force-dynamic';
const unauthorized = () => NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
const ID = /^[\w-]{1,64}$/;
const EDITS = ['status', 'reply', 'note'] as const;

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await isAdminAuthenticated())) return unauthorized();
  const { id } = await params;
  const patch = await request.json().catch(() => null);
  if (!ID.test(id) || !patch || typeof patch !== 'object' || Array.isArray(patch)) return NextResponse.json({ error: 'Bad request' }, { status: 400 });
  try {
    const result = await updateJson<TicketsData, { ticket: Ticket; changed: Ticket[] } | null>(ticketsFile(), emptyTickets(), (stored) => {
      const list = normalizeTickets(stored).tickets;
      const found = list.find((t) => t.id === id);
      if (!found) return null;
      const now = new Date();
      const changed = new Map<string, Ticket>([[found.id, found]]);
      const touched = EDITS.some((k) => patch[k] !== undefined);
      // The status first, so a commit recorded with "done" reads after it in the timeline.
      if (touched) applyPatch(found, patch, now);
      if (patch.link !== undefined) {
        const link = patch.link && typeof patch.link === 'object' ? (patch.link as { id?: unknown; rel?: unknown }) : {};
        for (const t of linkTickets(list, id, link.id, link.rel, 'admin', now)) changed.set(t.id, t);
      }
      if (patch.unlink !== undefined) for (const t of unlinkTickets(list, id, patch.unlink, 'admin', now)) changed.set(t.id, t);
      if (patch.commit !== undefined) {
        const c: { hash?: unknown; message?: unknown } = patch.commit && typeof patch.commit === 'object' ? patch.commit : { hash: patch.commit };
        addCommit(found, c.hash, c.message, 'admin', now);
      }
      // Anything at all (including "seen" alone) means they've looked at it.
      found.seenAt ??= now.toISOString();
      stored.tickets = list;
      return { ticket: withHistory(found), changed: [...changed.values()].map(withHistory) };
    });
    return result ? NextResponse.json(result) : NextResponse.json({ error: 'Not found' }, { status: 404 });
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
    const rest = list.filter((t) => t !== found);
    dropLinksTo(rest, [found.id]);
    stored.tickets = rest;
    return found.image;
  });
  if (image === false) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  await deleteTicketImage(image);
  return NextResponse.json({ ok: true });
}
