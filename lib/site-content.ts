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

export type PostPhoto = { src: string; description?: string };
export type FullPost = PostMeta & { photos: PostPhoto[]; content: string };

/** One post with its markdown, or null if it doesn't exist. Photos whose files are gone are left out. */
export async function getPost(slug: string): Promise<FullPost | null> {
  if (!/^[a-z0-9-]+$/.test(slug)) return null; // the slug becomes a file name
  const blogDir = path.join(process.cwd(), 'public', 'uploads', 'blog');
  const meta = (await getPosts()).find((p) => p.slug === slug) as (PostMeta & { photos?: PostPhoto[] }) | undefined;
  const content = await fs.readFile(path.join(blogDir, `${slug}.md`), 'utf-8').catch(() => null);
  if (!meta || content === null) return null;
  const photos: PostPhoto[] = [];
  for (const photo of Array.isArray(meta.photos) ? meta.photos : []) {
    const rel = String(photo.src || '').replace(/^\/api\/media\//, '').replace(/^\//, '');
    if (!rel || rel.includes('..')) continue;
    if (await fs.access(path.join(process.cwd(), 'public', rel)).then(() => true, () => false)) photos.push(photo);
  }
  return { ...meta, photos, content };
}

export type GalleryImage = { src: string; caption: string };
export type GalleryAlbum = { id: string; name: string; images: GalleryImage[]; albums: GalleryAlbum[] };

/** The photo album tree (read-only; the gallery API creates it on first use). */
export async function getGalleryAlbums(): Promise<GalleryAlbum[]> {
  try {
    const raw = JSON.parse(await fs.readFile(path.join(process.cwd(), 'public', 'uploads', 'gallery', 'albums.json'), 'utf-8'));
    const normalise = (a: GalleryAlbum): GalleryAlbum => ({ ...a, images: a.images || [], albums: (a.albums || []).map(normalise) });
    return Array.isArray(raw) ? raw.map(normalise) : [];
  } catch {
    return [];
  }
}

export type LibraryDocument = { url: string; name: string; category?: string; note?: string; date?: string };

export async function getLibraryDocuments(): Promise<LibraryDocument[]> {
  try {
    const raw = JSON.parse(await fs.readFile(path.join(process.cwd(), 'public', 'uploads', 'library', 'library.json'), 'utf-8'));
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
}

export type CadProject = { id: string; name: string; description: string; link: string };

export async function getCadProjects(): Promise<CadProject[]> {
  try {
    const raw = JSON.parse(await fs.readFile(path.join(process.cwd(), 'public', 'content', 'cad.json'), 'utf-8'));
    return Array.isArray(raw) ? raw : [];
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
