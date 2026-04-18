import { NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';
import { isAdminAuthenticated } from '@/lib/security/server-auth';

const getWatchedPath = () => path.join(process.cwd(), '.data', 'movies-watched.json');

export async function GET() {
  const isAdmin = await isAdminAuthenticated();
  if (!isAdmin) {
    return NextResponse.json({ success: false, message: 'Unauthorized' }, { status: 401 });
  }

  try {
    const data = await fs.readFile(getWatchedPath(), 'utf-8');
    return NextResponse.json({ success: true, watched: JSON.parse(data) });
  } catch (e) {
    return NextResponse.json({ success: true, watched: [] }); // default empty array
  }
}

export async function POST(request: Request) {
  const isAdmin = await isAdminAuthenticated();
  if (!isAdmin) {
    return NextResponse.json({ success: false, message: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await request.json();
    if (!Array.isArray(body.watched)) {
      return NextResponse.json({ success: false, message: 'Invalid payload' }, { status: 400 });
    }

    const dataDir = path.join(process.cwd(), '.data');
    await fs.mkdir(dataDir, { recursive: true }).catch(() => {});
    await fs.writeFile(getWatchedPath(), JSON.stringify(body.watched));

    return NextResponse.json({ success: true });
  } catch (e) {
    return NextResponse.json({ success: false, message: 'Failed to write' }, { status: 500 });
  }
}
