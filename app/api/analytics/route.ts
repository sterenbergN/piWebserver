import { NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';
import { isAdminAuthenticated } from '@/lib/security/server-auth';
import { updateJson } from '@/lib/json-store';
import { clientAddress, createLimiter } from '@/lib/security/rate-limit';

const analyticsFile = path.join(process.cwd(), '.data', 'analytics.json');

export async function GET() {
  try {
    const isAdmin = await isAdminAuthenticated();
    if (!isAdmin) {
      return NextResponse.json({ success: false, message: 'Unauthorized' }, { status: 401 });
    }

    try {
      await fs.access(analyticsFile);
    } catch {
      return NextResponse.json({ success: true, visits: [] });
    }

    const data = await fs.readFile(analyticsFile, 'utf-8');
    const visits = JSON.parse(data);
    return NextResponse.json({ success: true, visits });
  } catch (error) {
    console.error("Analytics GET Error:", error);
    return NextResponse.json({ success: false, message: "Error reading analytics" }, { status: 500 });
  }
}

type Visit = { timestamp: string; path: string };
const MAX_VISITS = 10000;

// Crawlers, link-preview fetchers and monitoring tools, by user agent.
const BOT = /bot|crawl|spider|slurp|preview|facebookexternalhit|whatsapp|telegram|discord|slack|curl|wget|python|headless|lighthouse|monitor|uptime/i;
// One browser can't plausibly view more than this many pages a minute.
const perVisitor = createLimiter({ max: 30, windowMs: 60_000 });

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => null);
    const raw = typeof body?.path === 'string' ? body.path : '/';
    // Only site paths, trimmed of query strings and capped in length.
    const visitPath = raw.startsWith('/') ? raw.split(/[?#]/)[0].slice(0, 200) : '/';

    // Count people, not bots, floods, or the site owner's own browsing.
    const ip = clientAddress(request);
    if (BOT.test(request.headers.get('user-agent') || '') || perVisitor.retryAfter(ip) || await isAdminAuthenticated()) {
      return NextResponse.json({ success: true, counted: false });
    }
    perVisitor.hit(ip);

    await updateJson<Visit[]>(analyticsFile, [], (visits) => {
      visits.push({ timestamp: new Date().toISOString(), path: visitPath });
      if (visits.length > MAX_VISITS) visits.splice(0, visits.length - MAX_VISITS);
    });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Analytics POST Error:", error);
    return NextResponse.json({ success: false }, { status: 500 });
  }
}
