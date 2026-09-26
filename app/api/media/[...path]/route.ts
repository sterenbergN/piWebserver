import { NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';
import sharp from 'sharp';
import { resolvePathInside } from '@/lib/security/paths';

// Private or temporary areas under public/ that must not be served here
// (the proxy blocks their direct URLs; this route must not reopen them).
const BLOCKED_PREFIXES = ['uploads/workouts/', 'temp/'];
// Thumbnails are cached on disk, so only a few sizes are allowed; a request
// is rounded up to the next one instead of creating a file per pixel width.
const THUMB_WIDTHS = [128, 256, 400, 640, 960, 1280, 1920];

// Resizing is the Pi's most expensive job. Opening an album can ask for dozens
// of thumbnails at once, so run at most two resizes at a time and let
// requests for a thumbnail that's already being made share that work.
const MAX_RESIZES = 2;
let activeResizes = 0;
const waiting: (() => void)[] = [];
const inFlight = new Map<string, Promise<Buffer>>();

async function withResizeSlot<T>(job: () => Promise<T>): Promise<T> {
  if (activeResizes >= MAX_RESIZES) await new Promise<void>((resolve) => waiting.push(resolve));
  activeResizes += 1;
  try {
    return await job();
  } finally {
    activeResizes -= 1;
    waiting.shift()?.();
  }
}

function makeThumbnail(source: string, target: string, width: number) {
  let pending = inFlight.get(target);
  if (!pending) {
    pending = withResizeSlot(async () => {
      // rotate() applies the photo's EXIF orientation, which is dropped from the output.
      const resized = await sharp(source, { failOn: 'none' }).rotate().resize(width, null, { withoutEnlargement: true }).toBuffer();
      await fs.mkdir(path.dirname(target), { recursive: true });
      // Write then rename so another request never reads a half-written file.
      const tmp = `${target}.${process.pid}.${Date.now()}.tmp`;
      await fs.writeFile(tmp, resized);
      await fs.rename(tmp, target);
      return resized;
    }).finally(() => inFlight.delete(target));
    inFlight.set(target, pending);
  }
  return pending;
}

export async function GET(request: Request, context: { params: Promise<{ path: string[] }> }) {
  try {
    const { path: pathArray } = await context.params;
    const safePath = pathArray.join('/');
    const { searchParams } = new URL(request.url);
    const width = searchParams.get('w');
    const publicRoot = path.join(process.cwd(), 'public');
    const absolutePath = resolvePathInside(publicRoot, safePath);
    if (!absolutePath) return new NextResponse('Forbidden', { status: 403 });
    const relative = path.relative(publicRoot, absolutePath).split(path.sep).join('/');
    if (BLOCKED_PREFIXES.some((prefix) => `${relative}/`.startsWith(prefix))) {
      return new NextResponse('Not found', { status: 404 });
    }

    // Handle thumbnailing (raster images only)
    if (width && !isNaN(Number(width)) && /\.(jpe?g|png|webp|gif)$/i.test(absolutePath)) {
      const requested = parseInt(width);
      if (requested < 64 || requested > 2400) {
        return new NextResponse('Invalid thumbnail size', { status: 400 });
      }
      const w = THUMB_WIDTHS.find((size) => size >= requested) ?? THUMB_WIDTHS[THUMB_WIDTHS.length - 1];
      // thumbs-v2: made with EXIF rotation applied. The old `thumbs` folder has
      // sideways copies of some phone photos and is no longer read.
      const thumbDir = path.join(process.cwd(), '.cache', 'thumbs-v2');
      const thumbName = `${safePath.replace(/[/\\:]/g, '_')}_w${w}${path.extname(safePath)}`;
      const thumbPath = path.join(thumbDir, thumbName);

      try {
        const thumbBuffer = await fs.readFile(thumbPath);
        return new NextResponse(thumbBuffer, {
          headers: { 'Content-Type': getContentType(absolutePath), 'Cache-Control': 'public, max-age=31536000, immutable' }
        });
      } catch {
        // Thumbnail doesn't exist yet: create it (once, even if many requests ask).
        const resizedBuffer = await makeThumbnail(absolutePath, thumbPath, w);
        return new NextResponse(new Uint8Array(resizedBuffer), {
          headers: { 'Content-Type': getContentType(absolutePath), 'Cache-Control': 'public, max-age=31536000, immutable' }
        });
      }
    }

    const fileBuffer = await fs.readFile(absolutePath);
    return new NextResponse(new Uint8Array(fileBuffer), {
      headers: { 'Content-Type': getContentType(absolutePath), 'Cache-Control': 'public, max-age=86400' }
    });
  } catch {
    return new NextResponse('Not found', { status: 404 });
  }
}

function getContentType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.png') return 'image/png';
  if (ext === '.gif') return 'image/gif';
  if (ext === '.webp') return 'image/webp';
  if (ext === '.svg') return 'image/svg+xml';
  if (ext === '.pdf') return 'application/pdf';
  return 'application/octet-stream';
}
