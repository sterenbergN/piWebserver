import { NextResponse } from 'next/server';
import { writeFile, readFile, mkdir, unlink, readdir } from 'fs/promises';
import path from 'path';
import { isSafeBlogSlug, resolvePathInside } from '@/lib/security/paths';
import { isAdminAuthenticated } from '@/lib/security/server-auth';

const base = path.join(process.cwd(), 'public', 'uploads');

const BLOG_MASTER_ID = 'blog-post-images';
const BLOG_MASTER_NAME = 'Blog Post Images';

type AlbumImage = { src: string; caption: string };
type AlbumNode = { id: string; name: string; images: AlbumImage[]; albums: AlbumNode[] };
type BlogPhoto = { src: string; description?: string };
type BlogPost = {
  slug: string;
  title: string;
  description: string;
  category: string;
  image: string;
  date: string;
  photos: BlogPhoto[];
};

function toMediaSrc(src: string): string {
  if (!src) return src;
  if (src.startsWith('/api/media')) return src;
  return `/api/media${src.startsWith('/') ? '' : '/'}${src}`;
}

function toPublicPath(src: string): string {
  const withoutMediaPrefix = src.replace(/^\/api\/media/, '');
  return withoutMediaPrefix.startsWith('/') ? withoutMediaPrefix : `/${withoutMediaPrefix}`;
}

async function removeThumbnails(publicPathLike: string) {
  try {
    const thumbDir = path.join(process.cwd(), '.cache', 'thumbs');
    const normalized = publicPathLike.startsWith('/') ? publicPathLike.slice(1) : publicPathLike;
    const thumbPrefix = normalized.replace(/[/\\:]/g, '_');
    const files = await readdir(thumbDir);
    for (const file of files) {
      if (file.startsWith(thumbPrefix)) {
        await unlink(path.join(thumbDir, file)).catch(() => {});
      }
    }
  } catch {
    // Ignore thumbnail cleanup errors.
  }
}

async function removePhysicalFile(mediaOrPublicPath: string) {
  const publicPath = toPublicPath(mediaOrPublicPath);
  const absolutePath = resolvePathInside(path.join(process.cwd(), 'public'), publicPath);
  if (absolutePath) {
    await unlink(absolutePath).catch(() => {});
  }
  await removeThumbnails(publicPath);
}

function hasAllowedExtension(filename: string, extensions: string[]) {
  return extensions.includes(path.extname(filename).toLowerCase());
}

function isAllowedImageFile(file: File | null | undefined) {
  return !!file && file.size > 0 && file.type.startsWith('image/') && hasAllowedExtension(file.name, ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.svg']);
}

function isAllowedMarkdownFile(file: File | null | undefined) {
  return !!file && file.size > 0 && hasAllowedExtension(file.name, ['.md']);
}

function isAllowedPdfFile(file: File | null | undefined) {
  return !!file && file.size > 0 && (file.type === 'application/pdf' || hasAllowedExtension(file.name, ['.pdf']));
}

function ensureBlogMaster(albums: AlbumNode[]): AlbumNode {
  let master = albums.find((album) => album.id === BLOG_MASTER_ID);
  if (!master) {
    master = { id: BLOG_MASTER_ID, name: BLOG_MASTER_NAME, images: [], albums: [] };
    albums.push(master);
  }
  if (!master.albums) master.albums = [];
  return master;
}

function ensurePostAlbum(albums: AlbumNode[], slug: string, title: string): AlbumNode {
  const master = ensureBlogMaster(albums);
  let postAlbum = master.albums.find((album) => album.id === slug);
  if (!postAlbum) {
    postAlbum = { id: slug, name: title, images: [], albums: [] };
    master.albums.push(postAlbum);
  }
  if (!postAlbum.images) postAlbum.images = [];
  if (!postAlbum.albums) postAlbum.albums = [];
  return postAlbum;
}

function findAndAddImage(albums: AlbumNode[], albumId: string, image: AlbumImage): boolean {
  for (const album of albums) {
    if (album.id === albumId) {
      album.images.unshift(image);
      return true;
    }
    if (findAndAddImage(album.albums || [], albumId, image)) return true;
  }
  return false;
}

function removeImageFromTree(albums: AlbumNode[], mediaSrc: string): AlbumNode[] {
  return albums.map((album) => ({
    ...album,
    images: (album.images || []).filter((image) => toMediaSrc(image.src) !== mediaSrc),
    albums: removeImageFromTree(album.albums || [], mediaSrc),
  }));
}

async function readAlbums(): Promise<AlbumNode[]> {
  try {
    const file = path.join(base, 'gallery', 'albums.json');
    const albums = JSON.parse(await readFile(file, 'utf-8')) as AlbumNode[];
    const normalize = (album: AlbumNode): AlbumNode => ({
      ...album,
      images: album.images || [],
      albums: (album.albums || []).map(normalize),
    });
    return albums.map(normalize);
  } catch {
    return [{ id: 'general', name: 'General', images: [], albums: [] }];
  }
}

async function saveAlbums(albums: AlbumNode[]) {
  const dir = path.join(base, 'gallery');
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, 'albums.json'), JSON.stringify(albums, null, 2));
}

async function readPosts(postsFile: string): Promise<BlogPost[]> {
  try {
    return JSON.parse(await readFile(postsFile, 'utf-8')) as BlogPost[];
  } catch {
    return [];
  }
}

export async function POST(request: Request) {
  try {
    if (!(await isAdminAuthenticated())) {
      return NextResponse.json({ success: false, message: 'Unauthorized' }, { status: 401 });
    }

    const formData = await request.formData();
    const type = formData.get('type') as string;

    if (type === 'gallery') {
      const file = formData.get('image') as File;
      const caption = (formData.get('caption') as string) || '';
      const albumId = (formData.get('albumId') as string) || 'general';

      if (!isAllowedImageFile(file)) return NextResponse.json({ success: false, message: 'Invalid image upload' }, { status: 400 });

      const bytes = await file.arrayBuffer();
      const filename = `${Date.now()}-${file.name.replace(/[^a-zA-Z0-9.]/g, '')}`;
      const saveDir = path.join(base, 'gallery');
      await mkdir(saveDir, { recursive: true });
      await writeFile(path.join(saveDir, filename), Buffer.from(bytes));

      const src = `/api/media/uploads/gallery/${filename}`;
      const albums = await readAlbums();
      const added = findAndAddImage(albums, albumId, { src, caption });
      if (!added) {
        const general = albums.find((album) => album.id === 'general');
        if (general) general.images.unshift({ src, caption });
        else albums.push({ id: 'general', name: 'General', images: [{ src, caption }], albums: [] });
      }
      await saveAlbums(albums);

      return NextResponse.json({ success: true, url: src });
    }

    if (type === 'blog') {
      const title = formData.get('title') as string;
      const description = formData.get('description') as string;
      const category = (formData.get('category') as string) || 'Uncategorized';
      const image = formData.get('image') as File;
      const mdFile = formData.get('markdown') as File;

      if (!title || !description || !isAllowedImageFile(image) || !isAllowedMarkdownFile(mdFile)) {
        return NextResponse.json({ success: false, message: 'Missing blog fields' }, { status: 400 });
      }

      const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-');
      if (!isSafeBlogSlug(slug)) {
        return NextResponse.json({ success: false, message: 'Invalid blog slug' }, { status: 400 });
      }
      const blogDir = path.join(base, 'blog');
      await mkdir(blogDir, { recursive: true });

      const imageExt = path.extname(image.name) || '.jpg';
      const imageFilename = `${slug}-img${imageExt}`;
      await writeFile(path.join(blogDir, imageFilename), Buffer.from(await image.arrayBuffer()));
      await writeFile(path.join(blogDir, `${slug}.md`), Buffer.from(await mdFile.arrayBuffer()));

      const postsFile = path.join(blogDir, 'posts.json');
      let posts = await readPosts(postsFile);
      const existing = posts.find((post) => post.slug === slug);

      if (existing?.image) {
        await removePhysicalFile(toMediaSrc(existing.image));
      }
      if (Array.isArray(existing?.photos)) {
        await Promise.all(
          existing.photos.map((photo) => removePhysicalFile(toMediaSrc(photo.src)))
        );
      }

      const newPost: BlogPost = {
        slug,
        title,
        description,
        category,
        image: `/uploads/blog/${imageFilename}`,
        date: new Date().toISOString(),
        photos: [],
      };

      posts = posts.filter((post) => post.slug !== slug);
      posts.unshift(newPost);
      await writeFile(postsFile, JSON.stringify(posts, null, 2));

      let albums = await readAlbums();
      if (existing) {
        const staleMedia = new Set<string>();
        if (existing.image) staleMedia.add(toMediaSrc(existing.image));
        if (Array.isArray(existing.photos)) {
          for (const photo of existing.photos) staleMedia.add(toMediaSrc(photo.src));
        }
        for (const mediaSrc of staleMedia) {
          albums = removeImageFromTree(albums, mediaSrc);
        }
      }

      const postAlbum = ensurePostAlbum(albums, slug, title);
      const coverSrc = `/api/media/uploads/blog/${imageFilename}`;
      postAlbum.images = postAlbum.images.filter((imageEntry) => toMediaSrc(imageEntry.src) !== coverSrc);
      postAlbum.images.push({ src: coverSrc, caption: 'Cover' });
      await saveAlbums(albums);

      return NextResponse.json({ success: true, post: newPost });
    }

    if (type === 'blog-update-md') {
      const slug = formData.get('slug') as string;
      const mdFile = formData.get('markdown') as File;
      if (!slug || !isSafeBlogSlug(slug) || !isAllowedMarkdownFile(mdFile)) {
        return NextResponse.json({ success: false, message: 'Missing fields' }, { status: 400 });
      }

      const blogDir = path.join(base, 'blog');
      await writeFile(path.join(blogDir, `${slug}.md`), Buffer.from(await mdFile.arrayBuffer()));
      return NextResponse.json({ success: true });
    }

    if (type === 'blog-update-image') {
      const slug = formData.get('slug') as string;
      const image = formData.get('image') as File;
      if (!slug || !isSafeBlogSlug(slug) || !isAllowedImageFile(image)) {
        return NextResponse.json({ success: false, message: 'Missing fields' }, { status: 400 });
      }

      const blogDir = path.join(base, 'blog');
      const imageExt = path.extname(image.name) || '.jpg';
      const imageFilename = `${slug}-img-${Date.now()}${imageExt}`;
      const newImagePath = `/uploads/blog/${imageFilename}`;
      const newImageMediaSrc = toMediaSrc(newImagePath);

      await writeFile(path.join(blogDir, imageFilename), Buffer.from(await image.arrayBuffer()));

      const postsFile = path.join(blogDir, 'posts.json');
      const posts = await readPosts(postsFile);
      const postIdx = posts.findIndex((post) => post.slug === slug);

      if (postIdx > -1) {
        const oldImagePath = posts[postIdx].image;
        const oldImageMediaSrc = oldImagePath ? toMediaSrc(oldImagePath) : null;

        posts[postIdx].image = newImagePath;
        await writeFile(postsFile, JSON.stringify(posts, null, 2));

        if (oldImageMediaSrc && oldImageMediaSrc !== newImageMediaSrc) {
          await removePhysicalFile(oldImageMediaSrc);
        }

        let albums = await readAlbums();
        if (oldImageMediaSrc && oldImageMediaSrc !== newImageMediaSrc) {
          albums = removeImageFromTree(albums, oldImageMediaSrc);
        }

        const postAlbum = ensurePostAlbum(albums, slug, posts[postIdx].title || slug);
        postAlbum.images = postAlbum.images.filter((imageEntry) => toMediaSrc(imageEntry.src) !== newImageMediaSrc);
        postAlbum.images.push({ src: newImageMediaSrc, caption: 'Cover' });
        await saveAlbums(albums);
      }

      return NextResponse.json({ success: true, image: newImagePath });
    }

    if (type === 'blog-photo') {
      const slug = formData.get('slug') as string;
      const description = (formData.get('description') as string) || '';
      const imageFile = formData.get('image') as File;
      if (!slug || !isSafeBlogSlug(slug) || !isAllowedImageFile(imageFile)) {
        return NextResponse.json({ success: false, message: 'Missing fields for blog photo' }, { status: 400 });
      }

      const bytes = await imageFile.arrayBuffer();
      const ext = path.extname(imageFile.name) || '.jpg';
      const filename = `${slug}-photo-${Date.now()}${ext}`;
      const blogDir = path.join(base, 'blog');
      await mkdir(blogDir, { recursive: true });
      await writeFile(path.join(blogDir, filename), Buffer.from(bytes));

      const mediaSrc = `/api/media/uploads/blog/${filename}`;
      const postsFile = path.join(blogDir, 'posts.json');
      const posts = await readPosts(postsFile);
      const post = posts.find((candidate) => candidate.slug === slug);

      if (!post) return NextResponse.json({ success: false, message: 'Post not found' }, { status: 404 });

      if (!post.photos) post.photos = [];
      post.photos.push({ src: mediaSrc, description });
      await writeFile(postsFile, JSON.stringify(posts, null, 2));

      const albums = await readAlbums();
      const postAlbum = ensurePostAlbum(albums, slug, post.title || slug);
      postAlbum.images.push({ src: mediaSrc, caption: description });
      await saveAlbums(albums);

      return NextResponse.json({ success: true, src: mediaSrc });
    }

    if (type === 'library') {
      const file = formData.get('file') as File;
      const docName = formData.get('name') as string;
      const category = (formData.get('category') as string) || 'Uncategorized';

      if (!isAllowedPdfFile(file)) return NextResponse.json({ success: false, message: 'Invalid PDF upload' }, { status: 400 });
      if (!docName) return NextResponse.json({ success: false, message: 'A document name is required' }, { status: 400 });

      const bytes = await file.arrayBuffer();
      const filename = `${Date.now()}-${file.name.replace(/[^a-zA-Z0-9.]/g, '')}`;
      const saveDir = path.join(base, 'library');
      await mkdir(saveDir, { recursive: true });
      await writeFile(path.join(saveDir, filename), Buffer.from(bytes));

      const libraryFile = path.join(saveDir, 'library.json');
      let libraryMeta: Array<{ url: string; name: string; category: string; date: string }> = [];
      try {
        libraryMeta = JSON.parse(await readFile(libraryFile, 'utf-8'));
      } catch {
        libraryMeta = [];
      }

      libraryMeta.unshift({
        url: `/api/media/uploads/library/${filename}`,
        name: docName,
        category,
        date: new Date().toISOString(),
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
