import { NextResponse } from 'next/server';
import { readJson, updateJson } from '@/lib/json-store';
import { createLimiter } from '@/lib/security/rate-limit';
import { ApiError, handleApiError } from '@/lib/workout/api';
import { generateId } from '@/lib/workout/data';
import { MAX_IMAGE_BYTES, currentBuild, deleteTicketImage, saveTicketImage, ticketsFile } from '@/lib/tickets/store';
import { buildTicket, emptyTickets, enforceCap, normalizeTickets, toMine, TicketInputError, type TicketsData } from '@/lib/tickets/tickets';
import { requireReporter } from '@/lib/tickets/who';

// Tickets for the signed-in account: file one (multipart: "data" JSON + optional "image"),
// or list your own. Only accounts the admin turned tickets on for (or the admin) get in.

export const dynamic = 'force-dynamic';
const PRIVATE = { 'Cache-Control': 'no-store, private' };
// 10 an hour per account is plenty for a person, and stops a stuck button flooding the admin.
const limiter = createLimiter({ max: 10, windowMs: 60 * 60_000 });

export async function GET() {
  try {
    const who = await requireReporter();
    const data = normalizeTickets(await readJson(ticketsFile(), emptyTickets()));
    return NextResponse.json({ success: true, tickets: data.tickets.filter((t) => t.userId === who.userId).map(toMine) }, { headers: PRIVATE });
  } catch (error) {
    return handleApiError(error, 'Load tickets failed');
  }
}

export async function POST(request: Request) {
  let imageId: string | undefined;
  try {
    const who = await requireReporter();
    const wait = limiter.retryAfter(who.userId);
    if (wait) throw new ApiError(429, `You've sent a lot of tickets. Try again in ${Math.ceil(wait / 60)} minutes.`);

    const form = await request.formData().catch(() => null);
    if (!form) throw new ApiError(400, 'Invalid request');
    let input: Record<string, unknown>;
    try {
      const parsed = JSON.parse(String(form.get('data') ?? ''));
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error();
      input = parsed;
    } catch {
      throw new ApiError(400, 'Invalid request');
    }

    // Check the text before spending time on the image.
    const ticket = (() => {
      try {
        return buildTicket({ kind: input.kind, severity: input.severity, message: input.message, context: input.context }, who, { id: generateId(), now: new Date() });
      } catch (error) {
        if (error instanceof TicketInputError) throw new ApiError(400, error.message);
        throw error;
      }
    })();

    const file = form.get('image');
    if (file && typeof file !== 'string' && file.size > 0) {
      if (file.size > MAX_IMAGE_BYTES) throw new ApiError(413, 'That image is too large (10 MB max)');
      if (file.type && !file.type.startsWith('image/')) throw new ApiError(400, 'That file is not an image');
      imageId = await saveTicketImage(Buffer.from(await file.arrayBuffer())).catch(() => {
        throw new ApiError(400, 'Could not read that image');
      });
      ticket.image = imageId;
    }
    const build = await currentBuild();
    if (build) ticket.context.build = build;

    limiter.hit(who.userId);
    const dropped = await updateJson<TicketsData, string[]>(ticketsFile(), emptyTickets(), (stored) => {
      const next = normalizeTickets(stored).tickets;
      next.unshift(ticket);
      const removed = enforceCap(next);
      stored.tickets = next;
      return removed.map((t) => t.image).filter((v): v is string => !!v);
    });
    imageId = undefined; // kept: the ticket points at it
    await Promise.all(dropped.map((id) => deleteTicketImage(id)));
    return NextResponse.json({ success: true, id: ticket.id }, { headers: PRIVATE });
  } catch (error) {
    await deleteTicketImage(imageId);
    return handleApiError(error, 'File ticket failed');
  }
}
