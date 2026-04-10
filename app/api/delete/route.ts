import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import fs from 'fs/promises';
import path from 'path';

const baseDir = path.join(process.cwd(), 'public', 'uploads');

function collectAllImages(album: any): string[] {
  const srcs: string[] = album.images?.map((i: any) => i.src) || [];
  for (const sub of (album.albums || [])) srcs.push(...collectAllImages(sub));
  return srcs;
}

function findAlbum(albums: any[], id: string): any | null {
  for (const a of albums) {
    if (a.id === id) return a;
    const found = findAlbum(a.albums || [], id);
    if (found) return found;
  }
  return null;
}

function removeAlbumFromTree(albums: any[], id: string): any[] {
  return albums
    .filter(a => a.id !== id)
    .map(a => ({ ...a, albums: removeAlbumFromTree(a.albums || [], id) }));
}

async function removeThumbnails(cleanPath: string) {
  try {
    const thumbDir = path.join(process.cwd(), '.cache', 'thumbs');
    // Map the relative path to our thumb filename convention: replacement of separators with underscores
    const thumbPrefix = cleanPath.startsWith('/') ? cleanPath.slice(1).replace(/[/\\:]/g, '_') : cleanPath.replace(/[/\\:]/g, '_');
    const files = await fs.readdir(thumbDir);
    for (const f of files) {
      if (f.startsWith(thumbPrefix)) {
        await fs.unlink(path.join(thumbDir, f));
      }
    }
  } catch { /* Cache dir might not exist or be empty */ }
}

function removePhotoFromTree(albums: any[], src: string): any[] {
  return albums.map(a => ({
    ...a,
    images: a.images.filter((i: any) => i.src !== src),
    albums: removePhotoFromTree(a.albums || [], src)
  }));
}

export async function POST(request: Request) {
  try {
    const cookieStore = await cookies();
    if (!cookieStore.has('pi_auth')) {
      return NextResponse.json({ success: false, message: 'Unauthorized' }, { status: 401 });
    }

    const { type, id } = await request.json();
    if (!type || !id) return NextResponse.json({ success: false }, { status: 400 });

    // ── Gallery photo ─────────────────────────────────────────────
    if (type === 'gallery') {
      const albumsFile = path.join(baseDir, 'gallery', 'albums.json');
      try {
        let albums = JSON.parse(await fs.readFile(albumsFile, 'utf-8'));
        albums = removePhotoFromTree(albums, id);
        await fs.writeFile(albumsFile, JSON.stringify(albums, null, 2));
      } catch { /* albums.json may not exist yet */ }

      // id here is the full `src` string; map it properly to the public folder
      try {
        const cleanId = id.replace('/api/media', '');
        const physicalPath = path.join(process.cwd(), 'public', cleanId);
        await fs.unlink(physicalPath);
        await removeThumbnails(cleanId);
      } catch (err) {
        console.error('Failed to unlink file:', id, err);
      }

      // Also remove from any blog post's photos[] array
      try {
        const postsFile = path.join(baseDir, 'blog', 'posts.json');
        const posts: any[] = JSON.parse(await fs.readFile(postsFile, 'utf-8'));
        let changed = false;
        for (const post of posts) {
          if (Array.isArray(post.photos)) {
            const before = post.photos.length;
            post.photos = post.photos.filter((ph: any) => ph.src !== id);
            if (post.photos.length !== before) changed = true;
          }
        }
        if (changed) await fs.writeFile(postsFile, JSON.stringify(posts, null, 2));
      } catch { /* posts.json may not exist */ }

      return NextResponse.json({ success: true });
    }

    // ── Gallery album (entire album + sub-albums + their images) ──
    if (type === 'gallery-album') {
      const albumsFile = path.join(baseDir, 'gallery', 'albums.json');
      let albums = JSON.parse(await fs.readFile(albumsFile, 'utf-8'));
      const target = findAlbum(albums, id);
      if (target) {
        const srcs = collectAllImages(target);
        for (const src of srcs) {
          try {
            const cleanSrc = src.replace('/api/media', '');
            const physicalPath = path.join(process.cwd(), 'public', cleanSrc);
            await fs.unlink(physicalPath);
            await removeThumbnails(cleanSrc);
          } catch (err) {
            console.error('Failed to unlink file during album delete:', src, err);
          }
        }
      }
      albums = removeAlbumFromTree(albums, id);
      await fs.writeFile(albumsFile, JSON.stringify(albums, null, 2));
      return NextResponse.json({ success: true });
    }

    // ── Blog post ─────────────────────────────────────────────────
    if (type === 'blog') {
      const bDir = path.join(baseDir, 'blog');
      const bFile = path.join(bDir, 'posts.json');
      let posts: any[] = JSON.parse(await fs.readFile(bFile, 'utf-8'));
      const target = posts.find(p => p.slug === id);
      if (target) {
        posts = posts.filter(p => p.slug !== id);
        await fs.writeFile(bFile, JSON.stringify(posts, null, 2));
        
        // Unlink markdown and cover
        try { await fs.unlink(path.join(bDir, `${id}.md`)); } catch { }
        try { await fs.unlink(path.join(process.cwd(), 'public', target.image)); } catch { }
        
        // Unlink all inline photos
        if (target.photos && Array.isArray(target.photos)) {
          for (const ph of target.photos) {
            try { 
              const cleanSrc = ph.src.replace('/api/media', '');
              await fs.unlink(path.join(process.cwd(), 'public', cleanSrc)); 
            } catch { }
          }
        }

        // Remove the synchronized album from albums.json
        try {
          const albumsFile = path.join(baseDir, 'gallery', 'albums.json');
          let albums = JSON.parse(await fs.readFile(albumsFile, 'utf-8'));
          albums = removeAlbumFromTree(albums, id); // id is slug
          await fs.writeFile(albumsFile, JSON.stringify(albums, null, 2));
        } catch { }

      }
      return NextResponse.json({ success: true });
    }

    // ── Library PDF ───────────────────────────────────────────────
    if (type === 'library') {
      const lDir = path.join(baseDir, 'library');
      const lFile = path.join(lDir, 'library.json');
      let docs: any[] = JSON.parse(await fs.readFile(lFile, 'utf-8'));
      const target = docs.find(d => d.url === id);
      if (target) {
        docs = docs.filter(d => d.url !== id);
        await fs.writeFile(lFile, JSON.stringify(docs, null, 2));
        try { await fs.unlink(path.join(lDir, target.url.split('/').pop() || '')); } catch { }
      }
      return NextResponse.json({ success: true });
    }

    // ── Download ZIP ───────────────────────────────────────────────
    if (type === 'download') {
      const tempDir = path.join(process.cwd(), 'public', 'temp', 'downloads');
      const safeId = path.basename(id);
      try {
        await fs.unlink(path.join(tempDir, safeId));
      } catch { }
      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ success: false, message: 'Invalid target type' }, { status: 400 });
  } catch (error) {
    console.error('Delete Error:', error);
    return NextResponse.json({ success: false }, { status: 500 });
  }
}
