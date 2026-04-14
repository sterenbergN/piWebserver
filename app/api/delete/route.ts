import { NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';
import { resolvePathInside, resolvePublicPath } from '@/lib/security/paths';
import { isAdminAuthenticated } from '@/lib/security/server-auth';

const baseDir = path.join(process.cwd(), 'public', 'uploads');

type AlbumImage = { src: string; caption?: string };
type AlbumNode = { id: string; name?: string; images: AlbumImage[]; albums?: AlbumNode[] };
type BlogPhoto = { src: string; description?: string };
type BlogPost = { slug: string; image?: string; photos?: BlogPhoto[]; [key: string]: unknown };
type LibraryDoc = { url: string; [key: string]: unknown };

function toMediaSrc(src: string): string {
  if (!src) return src;
  if (src.startsWith('/api/media')) return src;
  return `/api/media${src.startsWith('/') ? '' : '/'}${src}`;
}

function toPublicPath(src: string): string {
  const withoutMediaPrefix = src.replace(/^\/api\/media/, '');
  return withoutMediaPrefix.startsWith('/') ? withoutMediaPrefix : `/${withoutMediaPrefix}`;
}

function collectAllImages(album: AlbumNode): string[] {
  const srcs = (album.images || []).map((image) => toMediaSrc(image.src));
  for (const subAlbum of album.albums || []) {
    srcs.push(...collectAllImages(subAlbum));
  }
  return srcs;
}

function findAlbum(albums: AlbumNode[], id: string): AlbumNode | null {
  for (const album of albums) {
    if (album.id === id) return album;
    const found = findAlbum(album.albums || [], id);
    if (found) return found;
  }
  return null;
}

function removeAlbumFromTree(albums: AlbumNode[], id: string): AlbumNode[] {
  return albums
    .filter((album) => album.id !== id)
    .map((album) => ({
      ...album,
      albums: removeAlbumFromTree(album.albums || [], id),
    }));
}

function removePhotoFromTree(albums: AlbumNode[], mediaSrc: string): AlbumNode[] {
  return albums.map((album) => ({
    ...album,
    images: (album.images || []).filter((image) => toMediaSrc(image.src) !== mediaSrc),
    albums: removePhotoFromTree(album.albums || [], mediaSrc),
  }));
}

function removeImagesFromTree(albums: AlbumNode[], mediaSrcs: Set<string>): AlbumNode[] {
  return albums.map((album) => ({
    ...album,
    images: (album.images || []).filter((image) => !mediaSrcs.has(toMediaSrc(image.src))),
    albums: removeImagesFromTree(album.albums || [], mediaSrcs),
  }));
}

async function readJsonFile<T>(filePath: string, fallback: T): Promise<T> {
  try {
    const raw = await fs.readFile(filePath, 'utf-8');
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

async function removeThumbnails(publicPathLike: string) {
  try {
    const thumbDir = path.join(process.cwd(), '.cache', 'thumbs');
    const normalized = publicPathLike.startsWith('/') ? publicPathLike.slice(1) : publicPathLike;
    const thumbPrefix = normalized.replace(/[/\\:]/g, '_');
    const files = await fs.readdir(thumbDir);

    for (const file of files) {
      if (file.startsWith(thumbPrefix)) {
        await fs.unlink(path.join(thumbDir, file));
      }
    }
  } catch {
    // Ignore cache cleanup failures.
  }
}

async function removePhysicalFile(mediaOrPublicPath: string) {
  const publicPath = toPublicPath(mediaOrPublicPath);
  const absolutePath = resolvePublicPath(publicPath);

  if (absolutePath) {
    try {
      await fs.unlink(absolutePath);
    } catch {
      // Ignore missing files.
    }
  }

  await removeThumbnails(publicPath);
}

async function cleanupBlogRefsForMedia(mediaSrcs: Set<string>) {
  if (mediaSrcs.size === 0) return;

  const postsFile = path.join(baseDir, 'blog', 'posts.json');
  const posts = await readJsonFile<BlogPost[]>(postsFile, []);
  if (posts.length === 0) return;

  let changed = false;
  for (const post of posts) {
    if (post.image && mediaSrcs.has(toMediaSrc(post.image))) {
      post.image = '';
      changed = true;
    }

    if (Array.isArray(post.photos)) {
      const nextPhotos = post.photos.filter((photo) => !mediaSrcs.has(toMediaSrc(photo.src)));
      if (nextPhotos.length !== post.photos.length) {
        post.photos = nextPhotos;
        changed = true;
      }
    }
  }

  if (changed) {
    await fs.writeFile(postsFile, JSON.stringify(posts, null, 2));
  }
}

async function cleanupDownloadProgressFiles(tempDir: string, archiveName: string) {
  const siblingJson = archiveName.replace(/\.zip$/i, '.json');
  if (siblingJson !== archiveName) {
    try {
      await fs.unlink(path.join(tempDir, siblingJson));
    } catch {
      // Ignore missing direct sibling JSON file.
    }
  }

  let dirEntries: string[] = [];
  try {
    dirEntries = await fs.readdir(tempDir);
  } catch {
    return;
  }

  for (const file of dirEntries) {
    if (!file.endsWith('.json')) continue;
    const progressPath = path.join(tempDir, file);

    try {
      const data = JSON.parse(await fs.readFile(progressPath, 'utf-8')) as { url?: string | null };
      if (typeof data.url === 'string' && data.url.includes(archiveName)) {
        await fs.unlink(progressPath).catch(() => {});
      }
    } catch {
      // Ignore malformed or unreadable progress files.
    }
  }
}

export async function POST(request: Request) {
  try {
    if (!(await isAdminAuthenticated())) {
      return NextResponse.json({ success: false, message: 'Unauthorized' }, { status: 401 });
    }

    const { type, id } = (await request.json()) as { type?: string; id?: string };
    if (!type || !id) {
      return NextResponse.json({ success: false }, { status: 400 });
    }

    if (type === 'gallery') {
      const mediaSrc = toMediaSrc(id);
      const albumsFile = path.join(baseDir, 'gallery', 'albums.json');

      const albums = await readJsonFile<AlbumNode[]>(albumsFile, []);
      if (albums.length > 0) {
        const nextAlbums = removePhotoFromTree(albums, mediaSrc);
        await fs.writeFile(albumsFile, JSON.stringify(nextAlbums, null, 2));
      }

      await removePhysicalFile(mediaSrc);
      await cleanupBlogRefsForMedia(new Set([mediaSrc]));
      return NextResponse.json({ success: true });
    }

    if (type === 'gallery-album') {
      const albumsFile = path.join(baseDir, 'gallery', 'albums.json');
      const albums = await readJsonFile<AlbumNode[]>(albumsFile, []);
      if (albums.length === 0) return NextResponse.json({ success: true });

      const target = findAlbum(albums, id);
      const mediaSrcs = new Set<string>(target ? collectAllImages(target) : []);

      for (const mediaSrc of mediaSrcs) {
        await removePhysicalFile(mediaSrc);
      }

      let nextAlbums = removeAlbumFromTree(albums, id);
      nextAlbums = removeImagesFromTree(nextAlbums, mediaSrcs);
      await fs.writeFile(albumsFile, JSON.stringify(nextAlbums, null, 2));

      await cleanupBlogRefsForMedia(mediaSrcs);
      return NextResponse.json({ success: true });
    }

    if (type === 'blog') {
      const blogDir = path.join(baseDir, 'blog');
      const postsFile = path.join(blogDir, 'posts.json');
      let posts = await readJsonFile<BlogPost[]>(postsFile, []);
      const target = posts.find((post) => post.slug === id);

      if (target) {
        posts = posts.filter((post) => post.slug !== id);
        await fs.writeFile(postsFile, JSON.stringify(posts, null, 2));

        const mediaSrcs = new Set<string>();
        if (target.image) mediaSrcs.add(toMediaSrc(target.image));
        if (Array.isArray(target.photos)) {
          for (const photo of target.photos) mediaSrcs.add(toMediaSrc(photo.src));
        }

        try {
          await fs.unlink(path.join(blogDir, `${id}.md`));
        } catch {
          // Ignore missing markdown file.
        }

        for (const mediaSrc of mediaSrcs) {
          await removePhysicalFile(mediaSrc);
        }

        const albumsFile = path.join(baseDir, 'gallery', 'albums.json');
        const albums = await readJsonFile<AlbumNode[]>(albumsFile, []);
        if (albums.length > 0) {
          const withoutBlogAlbum = removeAlbumFromTree(albums, id);
          const cleanedAlbums = removeImagesFromTree(withoutBlogAlbum, mediaSrcs);
          await fs.writeFile(albumsFile, JSON.stringify(cleanedAlbums, null, 2));
        }
      }

      return NextResponse.json({ success: true });
    }

    if (type === 'library') {
      const libraryDir = path.join(baseDir, 'library');
      const libraryFile = path.join(libraryDir, 'library.json');
      let docs = await readJsonFile<LibraryDoc[]>(libraryFile, []);
      const target = docs.find((doc) => doc.url === id);

      if (target) {
        docs = docs.filter((doc) => doc.url !== id);
        await fs.writeFile(libraryFile, JSON.stringify(docs, null, 2));
        await removePhysicalFile(target.url);
      }

      return NextResponse.json({ success: true });
    }

    if (type === 'download') {
      const tempDir = path.join(process.cwd(), 'public', 'temp', 'downloads');
      const safeId = path.basename(id);
      const archivePath = resolvePathInside(tempDir, safeId);

      if (archivePath) {
        try {
          await fs.unlink(archivePath);
        } catch {
          // Ignore missing archive file.
        }
      }

      await cleanupDownloadProgressFiles(tempDir, safeId);
      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ success: false, message: 'Invalid target type' }, { status: 400 });
  } catch (error) {
    console.error('Delete Error:', error);
    return NextResponse.json({ success: false }, { status: 500 });
  }
}
