import { NextResponse } from 'next/server';
import { createLimiter, clientAddress } from '@/lib/security/rate-limit';
import { recordServerIssue } from '@/lib/tickets/auto-store';
import { cleanText } from '@/lib/tickets/tickets';

// Problems browsers notice by themselves (script errors, AI replies a page couldn't
// read), filed as the site's own tickets. Anyone can send them, signed in or not, so
// they're short, rate-limited and only ever shown to the admin.

export const dynamic = 'force-dynamic';

const perVisitor = createLimiter({ max: 30, windowMs: 60 * 60_000 });
const overall = createLimiter({ max: 400, windowMs: 60 * 60_000 });

export async function POST(request: Request) {
  const who = clientAddress(request);
  const now = Date.now();
  if (perVisitor.retryAfter(who, now) || overall.retryAfter('all', now)) return new NextResponse(null, { status: 204 });
  perVisitor.hit(who, now);
  overall.hit('all', now);

  let body: Record<string, unknown>;
  try {
    const text = await request.text();
    if (text.length > 4000) return new NextResponse(null, { status: 413 });
    body = JSON.parse(text);
  } catch {
    return new NextResponse(null, { status: 400 });
  }
  const source = body.source === 'ai' ? 'ai' : 'browser';
  const message = cleanText(body.message, 300);
  if (!message) return new NextResponse(null, { status: 400 });
  recordServerIssue({
    source,
    title: message,
    detail: cleanText(body.detail, 600) || undefined,
    page: cleanText(body.page, 200) || undefined,
    userAgent: request.headers.get('user-agent')?.slice(0, 300),
  });
  return new NextResponse(null, { status: 204 });
}
