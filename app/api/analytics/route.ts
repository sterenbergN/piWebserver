import { NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';
import { isAdminAuthenticated } from '@/lib/security/server-auth';
import { updateJson } from '@/lib/json-store';

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

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => null);
    const raw = typeof body?.path === 'string' ? body.path : '/';
    // Only site paths, trimmed of query strings and capped in length.
    const visitPath = raw.startsWith('/') ? raw.split(/[?#]/)[0].slice(0, 200) : '/';

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
