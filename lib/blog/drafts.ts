import path from 'path';
import { readJson, updateJson } from '@/lib/json-store';

// Post drafts kept on the server (in .data, so they're private and backed up),
// so several posts can be on the go at once and picked up on any device.

export type PostDraft = {
  id: string;
  /** The published post this draft changes; empty for a new post. */
  slug: string;
  title: string;
  description: string;
  category: string;
  markdown: string;
  /** A cover picked but not yet published (an uploaded /api/media/uploads/blog/inline/… path). */
  cover: string;
  createdAt: string;
  updatedAt: string;
};

const FILE = () => path.join(process.cwd(), '.data', 'blog-drafts.json');
const ID_RE = /^[a-z0-9-]{6,40}$/;
const INLINE_RE = /^\/api\/media\/uploads\/blog\/inline\/\d+-[A-Za-z0-9.]+$/;

export const isDraftId = (id: unknown): id is string => typeof id === 'string' && ID_RE.test(id);
export const isInlineImageSrc = (src: unknown): src is string => typeof src === 'string' && INLINE_RE.test(src);

const str = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : '');

/** Newest first. */
export async function listDrafts(): Promise<PostDraft[]> {
  const drafts = await readJson<PostDraft[]>(FILE(), []);
  return drafts.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function getDraft(id: string): Promise<PostDraft | null> {
  if (!isDraftId(id)) return null;
  return (await readJson<PostDraft[]>(FILE(), [])).find((d) => d.id === id) || null;
}

/** Create or update a draft (the browser picks the id, so retries can't make duplicates). */
export async function saveDraft(input: Record<string, unknown>): Promise<PostDraft> {
  if (!isDraftId(input.id)) throw new Error('Bad draft id');
  const slug = str(input.slug, 80);
  if (slug && !/^[a-z0-9-]+$/.test(slug)) throw new Error('Bad slug');
  const markdown = str(input.markdown, 300_000);
  const now = new Date().toISOString();
  return updateJson<PostDraft[], PostDraft>(FILE(), [], (drafts) => {
    const existing = drafts.find((d) => d.id === input.id);
    const draft: PostDraft = {
      id: input.id as string,
      slug: existing?.slug ?? slug,
      title: str(input.title, 160),
      description: str(input.description, 400),
      category: str(input.category, 60),
      markdown,
      cover: isInlineImageSrc(input.cover) ? input.cover : '',
      createdAt: existing?.createdAt || now,
      updatedAt: now,
    };
    if (existing) Object.assign(existing, draft); else drafts.push(draft);
    return draft;
  }, true);
}

export async function deleteDraft(id: string): Promise<boolean> {
  if (!isDraftId(id)) return false;
  return updateJson<PostDraft[], boolean>(FILE(), [], (drafts) => {
    const i = drafts.findIndex((d) => d.id === id);
    if (i === -1) return false;
    drafts.splice(i, 1);
    return true;
  }, true);
}
