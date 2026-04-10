import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import fs from 'fs/promises';
import path from 'path';

export async function GET(request: Request) {
  try {
    const cookieStore = await cookies();
    if (!cookieStore.has('pi_auth')) {
      return NextResponse.json({ success: false, message: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');

    if (!id) return NextResponse.json({ success: false }, { status: 400 });

    const progressFile = path.join(process.cwd(), 'public', 'temp', 'downloads', `${id}.json`);

    try {
      const data = JSON.parse(await fs.readFile(progressFile, 'utf-8'));
      return NextResponse.json({ success: true, data });
    } catch {
      return NextResponse.json({ success: false, message: 'Job not found' }, { status: 404 });
    }
  } catch (error) {
    return NextResponse.json({ success: false }, { status: 500 });
  }
}
