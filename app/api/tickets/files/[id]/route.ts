import { readJson } from '@/lib/json-store';
import { getAuthenticatedWorkoutUserId, isAdminAuthenticated } from '@/lib/security/server-auth';
import { isImageId, readTicketImage, ticketsFile } from '@/lib/tickets/store';
import { emptyTickets, normalizeTickets } from '@/lib/tickets/tickets';

export const dynamic = 'force-dynamic';

/** A ticket's image, for the person who filed it or the admin; anyone else gets a 404 so ids can't be probed. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isImageId(id)) return new Response('Not found', { status: 404 });
  const [admin, userId] = await Promise.all([isAdminAuthenticated(), getAuthenticatedWorkoutUserId()]);
  if (!admin && !userId) return new Response('Not found', { status: 404 });
  if (!admin) {
    const data = normalizeTickets(await readJson(ticketsFile(), emptyTickets()));
    if (!data.tickets.some((t) => t.image === id && t.userId === userId)) return new Response('Not found', { status: 404 });
  }
  const image = await readTicketImage(id);
  if (!image) return new Response('Not found', { status: 404 });
  return new Response(new Uint8Array(image), { headers: { 'Content-Type': 'image/webp', 'Cache-Control': 'private, max-age=31536000, immutable' } });
}
