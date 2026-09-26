import fs from 'fs/promises';
import path from 'path';
import { NextResponse } from 'next/server';
import { SITE_PAGES, searchDocs, type SearchDoc } from '@/lib/search';
import { getPosts } from '@/lib/site-content';
import { getResume } from '@/lib/resume-store';
import { isSafeBlogSlug } from '@/lib/security/paths';

export const dynamic = 'force-dynamic';

type Album = { id: string; name?: string; images?: { src: string; caption?: string }[]; albums?: Album[] };
type LibraryDoc = { url: string; name?: string; category?: string; note?: string };

const uploads = () => path.join(process.cwd(), 'public', 'uploads');
const readJson = async <T,>(file: string, fallback: T): Promise<T> =>
  fs.readFile(file, 'utf-8').then((t) => JSON.parse(t) as T).catch(() => fallback);

async function buildIndex(): Promise<SearchDoc[]> {
  const docs: SearchDoc[] = [...SITE_PAGES];

  for (const post of await getPosts()) {
    const body = isSafeBlogSlug(post.slug)
      ? await fs.readFile(path.join(uploads(), 'blog', `${post.slug}.md`), 'utf-8').then((t) => t.slice(0, 20000)).catch(() => '')
      : '';
    docs.push({ kind: 'post', title: post.title, url: `/blog/${post.slug}`, subtitle: [post.category, post.description].filter(Boolean).join(' · '), body });
  }

  const walk = (albums: Album[], trail: string[]) => {
    for (const album of albums) {
      const name = album.name || album.id;
      const url = `/gallery?album=${encodeURIComponent(album.id)}`;
      const captions = (album.images || []).map((i) => i.caption).filter(Boolean) as string[];
      docs.push({ kind: 'album', title: name, url, subtitle: `${[...trail, name].join(' › ')} · ${(album.images || []).length} photos`, body: captions.join(' ') });
      walk(album.albums || [], [...trail, name]);
    }
  };
  const albums = await readJson<Album[]>(path.join(uploads(), 'gallery', 'albums.json'), []);
  walk(Array.isArray(albums) ? albums : [], []);

  const library = await readJson<LibraryDoc[]>(path.join(uploads(), 'library', 'library.json'), []);
  for (const doc of Array.isArray(library) ? library : []) {
    if (!doc?.url) continue;
    docs.push({ kind: 'document', title: doc.name || path.basename(doc.url), url: '/library', subtitle: doc.category, body: doc.note });
  }

  const { projects, skills } = await getResume();
  for (const project of projects) {
    docs.push({
      kind: 'project', title: project.name, url: project.post ? `/blog/${project.post.slug}` : '/#projects',
      subtitle: project.category, body: `${project.description} ${skills.map((s) => s.name).join(' ')}`,
    });
  }
  return docs;
}

// Rebuilding reads every post, so keep the index for a minute.
let cache: { at: number; docs: SearchDoc[] } | null = null;

export async function GET(request: Request) {
  const q = (new URL(request.url).searchParams.get('q') || '').slice(0, 100);
  if (!cache || Date.now() - cache.at > 60_000) cache = { at: Date.now(), docs: await buildIndex() };
  const results = searchDocs(cache.docs, q, 20).map(({ body: _body, ...hit }) => hit);
  return NextResponse.json({ success: true, results });
}
