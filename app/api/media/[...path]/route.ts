import { NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';
import { resolvePathInside } from '@/lib/security/paths';
import { backfillOnce, chooseFormat, contentTypeFor, getThumbnail, isRaster, roundWidth } from '@/lib/media/thumbnails';

// Private or temporary areas under public/ that must not be served here
// (the proxy blocks their direct URLs; this route must not reopen them).
const BLOCKED_PREFIXES = ['uploads/workouts/', 'temp/'];

export async function GET(request: Request, context: { params: Promise<{ path: string[] }> }) {
  try {
    const { path: pathArray } = await context.params;
    const { searchParams } = new URL(request.url);
    const width = searchParams.get('w');
    const publicRoot = path.join(process.cwd(), 'public');
    const absolutePath = resolvePathInside(publicRoot, pathArray.join('/'));
    if (!absolutePath) return new NextResponse('Forbidden', { status: 403 });
    const relative = path.relative(publicRoot, absolutePath).split(path.sep).join('/');
    if (BLOCKED_PREFIXES.some((prefix) => `${relative}/`.startsWith(prefix))) {
      return new NextResponse('Not found', { status: 404 });
    }

    // Resized copy (raster images only).
    if (width && !isNaN(Number(width)) && isRaster(absolutePath)) {
      const requested = parseInt(width);
      if (requested < 64 || requested > 2400) {
        return new NextResponse('Invalid thumbnail size', { status: 400 });
      }
      await fs.access(absolutePath);
      // Photos uploaded before thumbnails were made at upload time get theirs
      // prepared quietly in the background (once per server start).
      backfillOnce();
      const format = chooseFormat(request.headers.get('accept'), absolutePath);
      const buffer = await getThumbnail(absolutePath, relative, roundWidth(requested), format);
      return new NextResponse(new Uint8Array(buffer), {
        headers: {
          'Content-Type': format === 'webp' ? 'image/webp' : contentTypeFor(absolutePath),
          'Cache-Control': 'public, max-age=31536000, immutable',
          // The same URL is WebP or JPEG/PNG depending on what the browser accepts.
          Vary: 'Accept',
        },
      });
    }

    const fileBuffer = await fs.readFile(absolutePath);
    return new NextResponse(new Uint8Array(fileBuffer), {
      headers: { 'Content-Type': contentTypeFor(absolutePath), 'Cache-Control': 'public, max-age=86400' },
    });
  } catch {
    return new NextResponse('Not found', { status: 404 });
  }
}
