import { NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';
import { isAdminAuthenticated } from '@/lib/security/server-auth';
import { writeJsonAtomic } from '@/lib/json-store';

const getGolfPath = () => path.join(process.cwd(), '.data', 'golf-saved-games.json');

export async function GET() {
  const isAdmin = await isAdminAuthenticated();
  if (!isAdmin) {
    return NextResponse.json({ success: false, message: 'Unauthorized' }, { status: 401 });
  }

  try {
    const data = await fs.readFile(getGolfPath(), 'utf-8');
    return NextResponse.json({ success: true, games: JSON.parse(data) });
  } catch (e) {
    return NextResponse.json({ success: true, games: [] });
  }
}

export async function POST(request: Request) {
  const isAdmin = await isAdminAuthenticated();
  if (!isAdmin) {
    return NextResponse.json({ success: false, message: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await request.json();
    if (!Array.isArray(body.games)) {
      return NextResponse.json({ success: false, message: 'Invalid payload' }, { status: 400 });
    }

    await writeJsonAtomic(getGolfPath(), body.games);

    return NextResponse.json({ success: true });
  } catch (e) {
    return NextResponse.json({ success: false, message: 'Failed to write' }, { status: 500 });
  }
}
