// Image URLs served through /api/media, optionally resized (client and server safe).

/** Widths the media route caches; a request is rounded up to one of these. */
export const MEDIA_WIDTHS = [400, 640, 960, 1280, 1920] as const;

/** The /api/media URL for a stored path like "/uploads/gallery/a.jpg". */
export function mediaPath(src: string) {
  if (src.startsWith('/api/media') || /^https?:\/\//.test(src)) return src;
  return `/api/media${src.startsWith('/') ? '' : '/'}${src}`;
}

/**
 * Bump when resized copies change, so browsers (which cache them for a year)
 * fetch new ones. v2: thumbnails follow the photo's EXIF rotation.
 */
const RESIZE_VERSION = 2;

/** A resized copy (`?w=`) of a stored image; external URLs are returned as-is. */
export function mediaSrc(src: string, width?: number) {
  const url = mediaPath(src);
  return width && url.startsWith('/api/media') ? `${url}?w=${width}&v=${RESIZE_VERSION}` : url;
}

/** srcset so the browser picks the smallest copy that looks sharp on this screen. */
export function mediaSrcSet(src: string, widths: readonly number[] = MEDIA_WIDTHS) {
  if (!mediaPath(src).startsWith('/api/media')) return undefined;
  return widths.map((w) => `${mediaSrc(src, w)} ${w}w`).join(', ');
}
