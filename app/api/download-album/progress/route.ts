import { NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';
import { resolvePathInside } from '@/lib/security/paths';
import { isAdminAuthenticated } from '@/lib/security/server-auth';

export async function GET(request: Request) {
  try {
    if (!(await isAdminAuthenticated())) {
      return NextResponse.json({ success: false, message: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');

    if (!id) return NextResponse.json({ success: false }, { status: 400 });

    const progressFile = resolvePathInside(path.join(process.cwd(), 'public', 'temp', 'downloads'), `${path.basename(id)}.json`);
    if (!progressFile) {
      return NextResponse.json({ success: false, message: 'Invalid job id' }, { status: 400 });
    }

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
