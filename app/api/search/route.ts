import fs from 'fs/promises';
import path from 'path';
import { NextResponse } from 'next/server';
import { SITE_PAGES, searchDocs, type SearchDoc } from '@/lib/search';
import { getCadProjects, getPosts, withoutBlogAlbums } from '@/lib/site-content';
import { getResume } from '@/lib/resume-store';
import { publicLibraryFile } from '@/lib/reader/items';
import { isSafeBlogSlug } from '@/lib/security/paths';
import { DEFAULT_RECIPES, extractIngredients, normalizeRecipesData, resolveRecipes, type RecipesData } from '@/lib/recipes/recipes';

export const dynamic = 'force-dynamic';

type Album = { id: string; name?: string; images?: { src: string; caption?: string }[]; albums?: Album[] };
type LibraryDoc = { id?: string; url: string; name?: string; category?: string; note?: string };

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
  walk(Array.isArray(albums) ? withoutBlogAlbums(albums) : [], []);

  const library = await readJson<LibraryDoc[]>(path.join(uploads(), 'library', 'library.json'), []);
  for (const doc of Array.isArray(library) ? library : []) {
    if (!doc?.url) continue;
    const fileName = publicLibraryFile(doc.url);
    const bookId = doc.id || (fileName ? `lib-${fileName.replace(/[^\w-]+/g, '-').slice(0, 58)}` : '');
    const url = bookId ? `/reader?book=${encodeURIComponent(bookId)}` : '/reader?shelf=library';
    docs.push({ kind: 'document', title: doc.name || path.basename(doc.url), url, subtitle: doc.category, body: doc.note });
  }

  const { projects } = await getResume();
  const recipesRaw = await readJson<RecipesData>(
    path.join(process.cwd(), '.data', 'recipes', 'recipes.json'),
    { version: 1, recipes: DEFAULT_RECIPES },
  );
  for (const recipe of resolveRecipes(normalizeRecipesData(recipesRaw).recipes.filter((r) => !r.private))) {
    const bom = extractIngredients(recipe).map((b) => b.name).join(' ');
    docs.push({
      kind: 'page',
      title: recipe.title,
      url: `/recipes?recipe=${encodeURIComponent(recipe.slug)}`,
      subtitle: `Recipe · ${recipe.category} · ${recipe.summary}`,
      body: `${bom} ${recipe.equipment.join(' ')} ${recipe.tags.join(' ')}`,
    });
  }
  for (const project of projects) {
    const tags = Array.isArray((project as { tags?: string[] }).tags) ? (project as { tags?: string[] }).tags! : [];
    docs.push({
      kind: 'project', title: project.name, url: project.post ? `/blog/${project.post.slug}` : '/#projects',
      subtitle: project.category, body: [project.description, ...tags].filter(Boolean).join(' '),
    });
  }
  for (const model of await getCadProjects()) {
    if (!model?.id || !model?.name) continue;
    docs.push({
      kind: 'project',
      title: model.name,
      url: `/cad#cad-${encodeURIComponent(model.id)}`,
      subtitle: model.model ? 'Interactive 3D model · CAD' : 'CAD model',
      body: [model.description, model.modelName, model.link].filter(Boolean).join(' '),
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
