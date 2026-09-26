import fs from 'fs/promises';
import path from 'path';

// Read-only access to published content for server-rendered metadata,
// the sitemap and link previews.

export type PostMeta = { slug: string; title: string; description?: string; category?: string; image?: string; date?: string };

export async function getPosts(): Promise<PostMeta[]> {
  try {
    const raw = await fs.readFile(path.join(process.cwd(), 'public', 'uploads', 'blog', 'posts.json'), 'utf-8');
    const posts = JSON.parse(raw);
    return Array.isArray(posts) ? posts.filter((p) => p && typeof p.slug === 'string') : [];
  } catch {
    return [];
  }
}

/** Public URL of a stored image path, served through the media route. */
export function mediaUrl(src: string | undefined) {
  if (!src) return undefined;
  return src.startsWith('/api/media') ? src : `/api/media${src.startsWith('/') ? '' : '/'}${src}`;
}

/** The site's own origin, for absolute URLs in metadata and the sitemap. */
export function siteOrigin(headers?: Headers) {
  // SITE_URL wins; otherwise use the address the request came in on.
  const configured = process.env.SITE_URL?.replace(/\/$/, '');
  if (configured) return configured;
  const host = headers?.get('x-forwarded-host') || headers?.get('host');
  const proto = headers?.get('x-forwarded-proto') || 'http';
  return host ? `${proto}://${host}` : 'https://noahstuf.com';
}
