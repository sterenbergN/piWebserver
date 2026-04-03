import { NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';

export async function GET(request: Request, context: { params: Promise<{ path: string[] }> }) {
  try {
    const { path: pathArray } = await context.params;
    const safePath = pathArray.join('/');
    
    // Protect against directory traversal
    if (safePath.includes('..')) return new NextResponse('Forbidden', { status: 403 });
    
    const absolutePath = path.join(process.cwd(), 'public', safePath);
    const fileBuffer = await fs.readFile(absolutePath);
    
    const ext = path.extname(absolutePath).toLowerCase();
    let contentType = 'application/octet-stream';
    if (ext === '.jpg' || ext === '.jpeg') contentType = 'image/jpeg';
    else if (ext === '.png') contentType = 'image/png';
    else if (ext === '.gif') contentType = 'image/gif';
    else if (ext === '.webp') contentType = 'image/webp';
    else if (ext === '.svg') contentType = 'image/svg+xml';
    else if (ext === '.pdf') contentType = 'application/pdf';
    
    return new NextResponse(fileBuffer, {
      headers: { 'Content-Type': contentType, 'Cache-Control': 'public, max-age=86400' }
    });
  } catch (err) {
    return new NextResponse('Not found', { status: 404 });
  }
}
