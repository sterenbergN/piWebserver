import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import fs from 'fs/promises';
import { createReadStream } from 'fs';
import path from 'path';

export async function GET(request: Request) {
  try {
    const cookieStore = await cookies();
    if (!cookieStore.has('pi_auth')) {
      return new NextResponse('Unauthorized', { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const filename = searchParams.get('name');

    if (!filename || !filename.endsWith('.zip')) {
      return new NextResponse('Invalid file request', { status: 400 });
    }

    // Protect against path traversal
    const safeFilename = path.basename(filename);
    const absolutePath = path.join(process.cwd(), 'public', 'temp', 'downloads', safeFilename);

    try {
      await fs.access(absolutePath);
    } catch {
      return new NextResponse('File not found or expired', { status: 404 });
    }

    const stat = await fs.stat(absolutePath);
    
    // Instead of using ReadStream natively which causes issues in Next.js App router edge
    // We can return the buffer or use standard File API response
    const fileBuffer = await fs.readFile(absolutePath);

    return new NextResponse(fileBuffer, {
      headers: {
        'Content-Disposition': `attachment; filename="${safeFilename}"`,
        'Content-Type': 'application/zip',
        'Content-Length': stat.size.toString()
      },
    });

  } catch (error) {
    console.error('File Download Error:', error);
    return new NextResponse('Internal Server Error', { status: 500 });
  }
}
