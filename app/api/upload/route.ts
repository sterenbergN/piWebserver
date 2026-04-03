import { NextResponse } from 'next/server';
import { writeFile, readFile, mkdir } from 'fs/promises';
import path from 'path';

const base = path.join(process.cwd(), 'public', 'uploads');

const BLOG_MASTER_ID = 'blog-post-images';
const BLOG_MASTER_NAME = 'Blog Post Images';

/** Ensures the master "Blog Post Images" album exists at root and returns reference to it */
function ensureBlogMaster(albums: any[]): any {
  let master = albums.find(a => a.id === BLOG_MASTER_ID);
  if (!master) {
    master = { id: BLOG_MASTER_ID, name: BLOG_MASTER_NAME, images: [], albums: [] };
    albums.push(master);
  }
  if (!master.albums) master.albums = [];
  return master;
}

/** Finds or creates a per-post sub-album inside the master, returns it */
function ensurePostAlbum(albums: any[], slug: string, title: string): any {
  const master = ensureBlogMaster(albums);
  let postAlbum = master.albums.find((a: any) => a.id === slug);
  if (!postAlbum) {
    postAlbum = { id: slug, name: title, images: [], albums: [] };
    master.albums.push(postAlbum);
  }
  return postAlbum;
}

function findAndAddImage(albums: any[], albumId: string, image: any): boolean {
  for (const a of albums) {
    if (a.id === albumId) { a.images.unshift(image); return true; }
    if (findAndAddImage(a.albums || [], albumId, image)) return true;
  }
  return false;
}

async function readAlbums(): Promise<any[]> {
  try {
    const f = path.join(base, 'gallery', 'albums.json');
    const albums = JSON.parse(await readFile(f, 'utf-8'));
    const normalise = (a: any): any => ({ ...a, albums: (a.albums || []).map(normalise) });
    return albums.map(normalise);
  } catch { return [{ id: 'general', name: 'General', images: [], albums: [] }]; }
}

async function saveAlbums(albums: any[]) {
  const dir = path.join(base, 'gallery');
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, 'albums.json'), JSON.stringify(albums, null, 2));
}

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const type = formData.get('type') as string;

    // ── Gallery image upload ──────────────────────────────────────
    if (type === 'gallery') {
      const file = formData.get('image') as File;
      const caption = (formData.get('caption') as string) || '';
      const albumId = (formData.get('albumId') as string) || 'general';
      if (!file) return NextResponse.json({ success: false, message: 'No file uploaded' }, { status: 400 });

      const bytes = await file.arrayBuffer();
      const filename = `${Date.now()}-${file.name.replace(/[^a-zA-Z0-9.]/g, '')}`;
      const saveDir = path.join(base, 'gallery');
      await mkdir(saveDir, { recursive: true });
      await writeFile(path.join(saveDir, filename), Buffer.from(bytes));

      const src = `/api/media/uploads/gallery/${filename}`;
      const albums = await readAlbums();
      const added = findAndAddImage(albums, albumId, { src, caption });
      if (!added) {
        // Album not found — add to General
        const general = albums.find(a => a.id === 'general');
        if (general) general.images.unshift({ src, caption });
        else albums.push({ id: 'general', name: 'General', images: [{ src, caption }], albums: [] });
      }
      await saveAlbums(albums);

      return NextResponse.json({ success: true, url: src });
    }

    // ── Blog post upload ──────────────────────────────────────────
    if (type === 'blog') {
      const title = formData.get('title') as string;
      const description = formData.get('description') as string;
      const image = formData.get('image') as File;
      const mdFile = formData.get('markdown') as File;

      if (!title || !description || !image || !mdFile) {
        return NextResponse.json({ success: false, message: 'Missing blog fields' }, { status: 400 });
      }

      const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-');
      const blogDir = path.join(base, 'blog');
      await mkdir(blogDir, { recursive: true });

      const imageExt = path.extname(image.name) || '.jpg';
      const imageFilename = `${slug}-img${imageExt}`;
      await writeFile(path.join(blogDir, imageFilename), Buffer.from(await image.arrayBuffer()));
      await writeFile(path.join(blogDir, `${slug}.md`), Buffer.from(await mdFile.arrayBuffer()));

      const postsFile = path.join(blogDir, 'posts.json');
      let posts: any[] = [];
      try { posts = JSON.parse(await readFile(postsFile, 'utf-8')); } catch { }

      const newPost = {
        slug, title, description,
        image: `/uploads/blog/${imageFilename}`,
        date: new Date().toISOString(),
        photos: []
      };
      posts = posts.filter((p: any) => p.slug !== slug);
      posts.unshift(newPost);
      await writeFile(postsFile, JSON.stringify(posts, null, 2));

      // Create per-post album nested inside the master "Blog Post Images" album
      const albums = await readAlbums();
      ensurePostAlbum(albums, slug, title);
      await saveAlbums(albums);

      return NextResponse.json({ success: true, post: newPost });
    }

    // ── Blog extra photos ─────────────────────────────────────────
    if (type === 'blog-photo') {
      const slug = formData.get('slug') as string;
      const description = (formData.get('description') as string) || '';
      const imageFile = formData.get('image') as File;
      if (!slug || !imageFile) {
        return NextResponse.json({ success: false, message: 'Missing fields for blog photo' }, { status: 400 });
      }

      const bytes = await imageFile.arrayBuffer();
      const ext = path.extname(imageFile.name) || '.jpg';
      const filename = `${slug}-photo-${Date.now()}${ext}`;
      const blogDir = path.join(base, 'blog');
      await mkdir(blogDir, { recursive: true });
      await writeFile(path.join(blogDir, filename), Buffer.from(bytes));

      const mediaSrc = `/api/media/uploads/blog/${filename}`;

      // Append to post.photos
      const postsFile = path.join(blogDir, 'posts.json');
      let posts: any[] = [];
      try { posts = JSON.parse(await readFile(postsFile, 'utf-8')); } catch { }
      const post = posts.find((p: any) => p.slug === slug);
      if (!post) return NextResponse.json({ success: false, message: 'Post not found' }, { status: 404 });
      if (!post.photos) post.photos = [];
      post.photos.push({ src: mediaSrc, description });
      await writeFile(postsFile, JSON.stringify(posts, null, 2));

      // Sync to gallery album (nested inside Blog Post Images master album)
      const albums = await readAlbums();
      const postAlbum = ensurePostAlbum(albums, slug, post.title || slug);
      postAlbum.images.push({ src: mediaSrc, caption: description });
      await saveAlbums(albums);

      return NextResponse.json({ success: true, src: mediaSrc });
    }

    // ── Library PDF upload ────────────────────────────────────────
    if (type === 'library') {
      const file = formData.get('file') as File;
      const docName = formData.get('name') as string;
      const category = (formData.get('category') as string) || 'Uncategorized';

      if (!file) return NextResponse.json({ success: false, message: 'No file uploaded' }, { status: 400 });
      if (!docName) return NextResponse.json({ success: false, message: 'A document name is required' }, { status: 400 });

      const bytes = await file.arrayBuffer();
      const filename = `${Date.now()}-${file.name.replace(/[^a-zA-Z0-9.]/g, '')}`;
      const saveDir = path.join(base, 'library');
      await mkdir(saveDir, { recursive: true });
      await writeFile(path.join(saveDir, filename), Buffer.from(bytes));

      const libraryFile = path.join(saveDir, 'library.json');
      let libraryMeta: any[] = [];
      try { libraryMeta = JSON.parse(await readFile(libraryFile, 'utf-8')); } catch { }

      libraryMeta.unshift({
        url: `/api/media/uploads/library/${filename}`,
        name: docName, category,
        date: new Date().toISOString()
      });
      await writeFile(libraryFile, JSON.stringify(libraryMeta, null, 2));

      return NextResponse.json({ success: true, url: `/api/media/uploads/library/${filename}` });
    }

    return NextResponse.json({ success: false, message: 'Invalid type specified' }, { status: 400 });
  } catch (error) {
    console.error('Upload Error:', error);
    return NextResponse.json({ success: false, message: 'Upload failed processing.' }, { status: 500 });
  }
}
