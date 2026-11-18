import { NextResponse } from 'next/server';
import { createReadStream } from 'fs';
import fs from 'fs/promises';
import path from 'path';
import { Readable } from 'stream';
import { resolvePathInside } from '@/lib/security/paths';
import { backfillOnce, chooseFormat, contentTypeFor, getThumbnail, isRaster, roundWidth } from '@/lib/media/thumbnails';

// Private or temporary areas under public/ that must not be served here
// (the proxy blocks their direct URLs; this route must not reopen them).
const BLOCKED_PREFIXES = ['uploads/workouts/', 'temp/'];

const EXTRA_MIME: Record<string, string> = {
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.m4v': 'video/x-m4v',
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.ogg': 'audio/ogg',
  '.wav': 'audio/wav',
};

function mediaContentType(file: string): string {
  const ext = path.extname(file).toLowerCase();
  return EXTRA_MIME[ext] || contentTypeFor(file);
}

/** Parse a single HTTP byte range into inclusive [start, end], null when absent, or 'bad' when unsatisfiable. */
function parseByteRange(header: string | null, size: number): [number, number] | null | 'bad' {
  if (!header) return null;
  const m = /^bytes=(\d*)-(\d*)$/i.exec(header.trim());
  if (!m || (!m[1] && !m[2])) return 'bad';
  if (size <= 0) return 'bad';
  let start: number;
  let end: number;
  if (!m[1]) {
    const suffix = Number(m[2]);
    if (!Number.isSafeInteger(suffix) || suffix <= 0) return 'bad';
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(m[1]);
    end = m[2] ? Math.min(Number(m[2]), size - 1) : size - 1;
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end)) return 'bad';
  }
  return start >= 0 && start <= end && start < size ? [start, end] : 'bad';
}

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

    const stat = await fs.stat(absolutePath);
    if (!stat.isFile()) return new NextResponse('Not found', { status: 404 });

    const ext = path.extname(absolutePath).toLowerCase();
    const baseHeaders: Record<string, string> = {
      'Content-Type': mediaContentType(absolutePath),
      'Cache-Control': 'public, max-age=86400',
      'Accept-Ranges': 'bytes',
    };
    if (ext === '.svg') {
      baseHeaders['Content-Security-Policy'] = "default-src 'none'; style-src 'unsafe-inline'; sandbox";
      baseHeaders['X-Content-Type-Options'] = 'nosniff';
    }

    const range = parseByteRange(request.headers.get('range'), stat.size);
    if (range === 'bad') {
      return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${stat.size}` } });
    }
    const [start, end] = range ?? [0, Math.max(0, stat.size - 1)];
    const length = stat.size ? end - start + 1 : 0;
    const body = stat.size
      ? (Readable.toWeb(createReadStream(absolutePath, { start, end })) as ReadableStream<Uint8Array>)
      : null;

    return new Response(body, {
      status: range ? 206 : 200,
      headers: {
        ...baseHeaders,
        'Content-Length': String(length),
        ...(range ? { 'Content-Range': `bytes ${start}-${end}/${stat.size}` } : {}),
      },
    });
  } catch {
    return new NextResponse('Not found', { status: 404 });
  }
}
