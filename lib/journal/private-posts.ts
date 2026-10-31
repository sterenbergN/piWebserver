import crypto from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import sharp from 'sharp';
import { readJson, updateJson } from '@/lib/json-store';

// Private posts: long-form writing in the blog's editor that's never published.
// Each account has its own folder in .data/private-posts (kept by backups)
// with posts.json and the pictures in them, which are only ever served back
// to that same account.

export type PrivatePost = {
  id: string;
  title: string;
  description: string;
  markdown: string;
  /** One of this account's pictures (an IMAGE_PREFIX src), or ''. */
  cover: string;
  createdAt: string;
  updatedAt: string;
};
export type PrivatePostSummary = Omit<PrivatePost, 'markdown'> & { words: number };

export const IMAGE_PREFIX = '/api/journal/posts/images/';
const ID_RE = /^[a-z0-9-]{6,40}$/;
const IMAGE_RE = /^[a-z0-9-]{6,60}\.webp$/;

export const isPostId = (id: unknown): id is string => typeof id === 'string' && ID_RE.test(id);
export const isImageName = (name: unknown): name is string => typeof name === 'string' && IMAGE_RE.test(name);
const isOwnImageSrc = (src: unknown): src is string => typeof src === 'string' && src.startsWith(IMAGE_PREFIX) && isImageName(src.slice(IMAGE_PREFIX.length));

const str = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : '');
const words = (md: string) => md.replace(/[#*_`>\[\]()!-]/g, ' ').split(/\s+/).filter(Boolean).length;

export function folder(userId: string) {
  if (!/^[\w-]{1,64}$/.test(userId)) throw new Error('Invalid account');
  return path.join(process.cwd(), '.data', 'private-posts', userId);
}
const postsFile = (userId: string) => path.join(folder(userId), 'posts.json');
export const imageFile = (userId: string, name: string) => path.join(folder(userId), 'images', name);

/** A post as sent by the editor, cleaned up (pure; the id is checked by the caller). */
export function cleanPost(input: Record<string, unknown>, existing: PrivatePost | undefined, now: string): PrivatePost {
  return {
    id: input.id as string,
    title: str(input.title, 160),
    description: str(input.description, 400),
    markdown: str(input.markdown, 300_000),
    cover: isOwnImageSrc(input.cover) ? input.cover : '',
    createdAt: existing?.createdAt || now,
    updatedAt: now,
  };
}

/** The account's pictures a post shows. */
export function imagesIn(post: Pick<PrivatePost, 'markdown' | 'cover'>) {
  const names = new Set<string>();
  const re = new RegExp(`${IMAGE_PREFIX.replace(/\//g, '\\/')}([a-z0-9-]+\\.webp)`, 'g');
  for (const m of `${post.cover} ${post.markdown}`.matchAll(re)) names.add(m[1]);
  return names;
}

/** Most recently edited first. */
export async function listPosts(userId: string): Promise<PrivatePostSummary[]> {
  const posts = await readJson<PrivatePost[]>(postsFile(userId), []);
  return posts
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .map(({ markdown, ...rest }) => ({ ...rest, words: words(markdown) }));
}

export async function getPost(userId: string, id: string): Promise<PrivatePost | null> {
  if (!isPostId(id)) return null;
  return (await readJson<PrivatePost[]>(postsFile(userId), [])).find((p) => p.id === id) || null;
}

/** Create or update a post (the browser picks the id, so retries can't make duplicates). */
export async function savePost(userId: string, input: Record<string, unknown>): Promise<PrivatePost> {
  if (!isPostId(input.id)) throw new Error('Bad post id');
  const now = new Date().toISOString();
  return updateJson<PrivatePost[], PrivatePost>(postsFile(userId), [], (posts) => {
    const existing = posts.find((p) => p.id === input.id);
    const post = cleanPost(input, existing, now);
    if (existing) Object.assign(existing, post); else posts.push(post);
    return post;
  }, true);
}

/** Delete a post and the pictures only it used. */
export async function deletePost(userId: string, id: string): Promise<boolean> {
  if (!isPostId(id)) return false;
  const gone = await updateJson<PrivatePost[], Set<string> | false>(postsFile(userId), [], (posts) => {
    const i = posts.findIndex((p) => p.id === id);
    if (i === -1) return false;
    const [removed] = posts.splice(i, 1);
    const names = imagesIn(removed);
    for (const other of posts) for (const name of imagesIn(other)) names.delete(name);
    return names;
  }, true);
  if (!gone) return false;
  await Promise.all([...gone].map((name) => fs.unlink(imageFile(userId, name)).catch(() => {})));
  return true;
}

/**
 * Store a picture for the account: turned upright, shrunk to at most 2400 px
 * and saved as WebP (animations kept). Returns the src to put in the Markdown.
 */
export async function saveImage(userId: string, data: Buffer): Promise<string> {
  const pages = (await sharp(data, { failOn: 'none' }).metadata()).pages ?? 1;
  let img = sharp(data, { failOn: 'none', animated: pages > 1 });
  if (pages === 1) img = img.rotate();
  const out = await img.resize(2400, 2400, { fit: 'inside', withoutEnlargement: true }).webp({ quality: 85 }).toBuffer();
  const name = `${Date.now().toString(36)}-${crypto.randomBytes(6).toString('hex')}.webp`;
  const file = imageFile(userId, name);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, out);
  return `${IMAGE_PREFIX}${name}`;
}
