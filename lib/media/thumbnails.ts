import fs from 'fs/promises';
import path from 'path';
import sharp from 'sharp';

// Resized copies of uploaded photos, cached on disk (.cache/thumbs-v2).
//
// - Visitors' browsers get WebP when they accept it (every current browser
//   does): about a third smaller than JPEG at the same quality.
// - New uploads get their common sizes made straight away in the
//   background, so the first visitor never waits for the Pi to resize.
// - Resizing is the Pi's most expensive job: at most two run at once, and
//   background work only ever takes one of those slots so visitors'
//   requests always go first.

/** Allowed widths; a request is rounded up so there's one file per size, not per pixel. */
export const THUMB_WIDTHS = [128, 256, 400, 640, 960, 1280, 1920];
/** Sizes the site asks for most (grid, cards, full-screen / blog). */
export const PREGENERATE_WIDTHS = [400, 640, 1280];

export type ThumbFormat = 'webp' | 'original';
const RASTER = /\.(jpe?g|png|webp|gif)$/i;
const MAX_SLOTS = 2;

let active = 0;
const urgent: (() => void)[] = [];
const background: (() => void)[] = [];
const inFlight = new Map<string, Promise<Buffer>>();

function nextJob() {
  if (active >= MAX_SLOTS) return;
  const run = urgent.shift() || (active < MAX_SLOTS - 1 ? background.shift() : undefined);
  run?.();
}

async function withSlot<T>(priority: 'urgent' | 'background', job: () => Promise<T>): Promise<T> {
  const mayStart = priority === 'urgent' ? active < MAX_SLOTS : active < MAX_SLOTS - 1 && urgent.length === 0;
  if (!mayStart) await new Promise<void>((resolve) => (priority === 'urgent' ? urgent : background).push(resolve));
  active += 1;
  try {
    return await job();
  } finally {
    active -= 1;
    nextJob();
  }
}

export const cacheDir = () => path.join(process.cwd(), '.cache', 'thumbs-v2');

export function roundWidth(requested: number) {
  return THUMB_WIDTHS.find((size) => size >= requested) ?? THUMB_WIDTHS[THUMB_WIDTHS.length - 1];
}

/** WebP unless the browser can't take it — or the source is a GIF, which may be animated. */
export function chooseFormat(accept: string | null, sourcePath: string): ThumbFormat {
  return /\bimage\/webp\b/.test(accept || '') && !/\.gif$/i.test(sourcePath) ? 'webp' : 'original';
}

export function thumbFile(relPath: string, width: number, format: ThumbFormat) {
  const base = `${relPath.replace(/[/\\:]/g, '_')}_w${width}`;
  return path.join(cacheDir(), format === 'webp' ? `${base}.webp` : `${base}${path.extname(relPath)}`);
}

export function contentTypeFor(file: string): string {
  const ext = path.extname(file).toLowerCase();
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.png') return 'image/png';
  if (ext === '.gif') return 'image/gif';
  if (ext === '.webp') return 'image/webp';
  if (ext === '.svg') return 'image/svg+xml';
  if (ext === '.pdf') return 'application/pdf';
  return 'application/octet-stream';
}

async function render(source: string, width: number, format: ThumbFormat) {
  // rotate() applies the photo's EXIF orientation, which is dropped from the output.
  const img = sharp(source, { failOn: 'none' }).rotate().resize(width, null, { withoutEnlargement: true });
  if (format === 'webp') return img.webp({ quality: 78, effort: 4 }).toBuffer();
  if (/\.jpe?g$/i.test(source)) return img.jpeg({ quality: 82, mozjpeg: true }).toBuffer();
  return img.toBuffer();
}

/** The cached copy, making it first if needed (shared if several requests ask at once). */
export async function getThumbnail(source: string, relPath: string, width: number, format: ThumbFormat, priority: 'urgent' | 'background' = 'urgent') {
  const target = thumbFile(relPath, width, format);
  const cached = await fs.readFile(target).catch(() => null);
  if (cached) return cached;
  let pending = inFlight.get(target);
  if (!pending) {
    pending = withSlot(priority, async () => {
      const again = await fs.readFile(target).catch(() => null); // made while this job waited
      if (again) return again;
      const buffer = await render(source, width, format);
      await fs.mkdir(path.dirname(target), { recursive: true });
      // Write then rename so another request never reads a half-written file.
      const tmp = `${target}.${process.pid}.${Date.now()}.tmp`;
      await fs.writeFile(tmp, buffer);
      await fs.rename(tmp, target);
      return buffer;
    }).finally(() => inFlight.delete(target));
    inFlight.set(target, pending);
  }
  return pending;
}

/**
 * Queue the common sizes of a newly stored image (path relative to public/,
 * e.g. "uploads/gallery/a.jpg"). Returns immediately; the work happens in
 * the background without holding up the upload or other visitors.
 */
export function queueThumbnails(relPath: string) {
  if (!RASTER.test(relPath) || /\.gif$/i.test(relPath)) return;
  const source = path.join(process.cwd(), 'public', relPath);
  for (const width of PREGENERATE_WIDTHS) {
    getThumbnail(source, relPath, width, 'webp', 'background').catch(() => { /* made on demand instead */ });
  }
}

/** Delete every cached copy (all widths and formats) of a file that was removed or replaced. */
export async function removeThumbnails(publicPathLike: string) {
  const rel = publicPathLike.replace(/^\/api\/media/, '').replace(/^\//, '');
  const prefix = `${rel.replace(/[/\\:]/g, '_')}_w`;
  const files = await fs.readdir(cacheDir()).catch(() => [] as string[]);
  await Promise.all(files.filter((f) => f.startsWith(prefix)).map((f) => fs.unlink(path.join(cacheDir(), f)).catch(() => {})));
}

let backfillStarted = false;

/**
 * Once per server start: queue missing WebP copies for photos uploaded
 * before this existed. Runs slowly in the background (one slot at most).
 */
export function backfillOnce() {
  if (backfillStarted) return;
  backfillStarted = true;
  (async () => {
    const roots = ['uploads/gallery', 'uploads/blog'];
    for (const root of roots) {
      const files = await fs.readdir(path.join(process.cwd(), 'public', root)).catch(() => [] as string[]);
      for (const name of files) {
        const rel = `${root}/${name}`;
        if (!RASTER.test(name) || /\.gif$/i.test(name)) continue;
        const missing = await Promise.all(PREGENERATE_WIDTHS.map((w) => fs.access(thumbFile(rel, w, 'webp')).then(() => false, () => true)));
        if (missing.some(Boolean)) queueThumbnails(rel);
      }
    }
  })().catch(() => { backfillStarted = false; });
}

export const isRaster = (file: string) => RASTER.test(file);
