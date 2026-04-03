import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import fs from 'fs/promises';
import path from 'path';

const base = path.join(process.cwd(), 'public', 'uploads');

function findAlbum(albums: any[], id: string): any | null {
  for (const a of albums) {
    if (a.id === id) return a;
    const found = findAlbum(a.albums || [], id);
    if (found) return found;
  }
  return null;
}

export async function PATCH(request: Request) {
  try {
    const cookieStore = await cookies();
    if (!cookieStore.has('pi_auth')) {
      return NextResponse.json({ success: false, message: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { type } = body;

    // ── Gallery photo edit (caption + album move) ─────────────────
    if (type === 'gallery-photo') {
      const { albumId, src, caption, newAlbumId } = body;
      const albumsFile = path.join(base, 'gallery', 'albums.json');
      const albums: any[] = JSON.parse(await fs.readFile(albumsFile, 'utf-8'));
      
      const sourceAlbum = findAlbum(albums, albumId);
      if (!sourceAlbum) return NextResponse.json({ success: false, message: 'Source album not found' }, { status: 404 });
      
      const imgIndex = sourceAlbum.images.findIndex((i: any) => i.src === src);
      if (imgIndex === -1) return NextResponse.json({ success: false, message: 'Image not found in source' }, { status: 404 });
      
      const img = sourceAlbum.images[imgIndex];
      img.caption = caption;
      
      // Handle move
      if (newAlbumId && newAlbumId !== albumId) {
        const destAlbum = findAlbum(albums, newAlbumId);
        if (!destAlbum) return NextResponse.json({ success: false, message: 'Destination album not found' }, { status: 404 });
        
        // Remove from source
        sourceAlbum.images.splice(imgIndex, 1);
        // Add to destination
        destAlbum.images.push(img);
      }
      
      await fs.writeFile(albumsFile, JSON.stringify(albums, null, 2));
      return NextResponse.json({ success: true });
    }

    // ── Gallery album rename ──────────────────────────────────────
    if (type === 'gallery-album') {
      const { albumId, name } = body;
      const albumsFile = path.join(base, 'gallery', 'albums.json');
      const albums: any[] = JSON.parse(await fs.readFile(albumsFile, 'utf-8'));
      const album = findAlbum(albums, albumId);
      if (!album) return NextResponse.json({ success: false, message: 'Album not found' }, { status: 404 });
      album.name = name;
      await fs.writeFile(albumsFile, JSON.stringify(albums, null, 2));
      return NextResponse.json({ success: true });
    }

    // ── Blog post metadata ────────────────────────────────────────
    if (type === 'blog') {
      const { slug, title, description, category } = body;
      const postsFile = path.join(base, 'blog', 'posts.json');
      const posts: any[] = JSON.parse(await fs.readFile(postsFile, 'utf-8'));
      const post = posts.find(p => p.slug === slug);
      if (!post) return NextResponse.json({ success: false, message: 'Post not found' }, { status: 404 });
      if (title !== undefined) post.title = title;
      if (description !== undefined) post.description = description;
      if (category !== undefined) post.category = category;
      await fs.writeFile(postsFile, JSON.stringify(posts, null, 2));
      return NextResponse.json({ success: true });
    }

    // ── Blog photo description ────────────────────────────────────
    if (type === 'blog-photo') {
      const { slug, src, description } = body;
      const postsFile = path.join(base, 'blog', 'posts.json');
      const posts: any[] = JSON.parse(await fs.readFile(postsFile, 'utf-8'));
      const post = posts.find(p => p.slug === slug);
      if (!post || !post.photos) return NextResponse.json({ success: false, message: 'Not found' }, { status: 404 });
      const photo = post.photos.find((ph: any) => ph.src === src);
      if (photo) photo.description = description;
      await fs.writeFile(postsFile, JSON.stringify(posts, null, 2));

      // Also sync caption to nested gallery album (inside Blog Post Images master)
      try {
        const albumsFile = path.join(base, 'gallery', 'albums.json');
        const albums: any[] = JSON.parse(await fs.readFile(albumsFile, 'utf-8'));
        const album = findAlbum(albums, slug); // recursive — finds nested album
        if (album) {
          const img = album.images.find((i: any) => i.src === src);
          if (img) img.caption = description;
          await fs.writeFile(albumsFile, JSON.stringify(albums, null, 2));
        }
      } catch { /* gallery sync optional */ }

      return NextResponse.json({ success: true });
    }

    // ── Library document ──────────────────────────────────────────
    if (type === 'library') {
      const { url, name, category } = body;
      const libraryFile = path.join(base, 'library', 'library.json');
      const docs: any[] = JSON.parse(await fs.readFile(libraryFile, 'utf-8'));
      const doc = docs.find(d => d.url === url);
      if (!doc) return NextResponse.json({ success: false, message: 'Document not found' }, { status: 404 });
      if (name !== undefined) doc.name = name;
      if (category !== undefined) doc.category = category;
      await fs.writeFile(libraryFile, JSON.stringify(docs, null, 2));
      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ success: false, message: 'Invalid edit type' }, { status: 400 });
  } catch (error) {
    console.error('Edit Error:', error);
    return NextResponse.json({ success: false, message: 'Edit failed' }, { status: 500 });
  }
}
