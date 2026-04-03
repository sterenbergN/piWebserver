import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import fs from 'fs/promises';
import path from 'path';

const galleryDir = path.join(process.cwd(), 'public', 'uploads', 'gallery');
const albumsFile = path.join(galleryDir, 'albums.json');
const legacyFile = path.join(galleryDir, 'gallery.json');

export interface AlbumImage { src: string; caption: string; }
export interface Album {
  id: string;
  name: string;
  images: AlbumImage[];
  albums: Album[]; // sub-albums
}

// ── Recursive helpers ─────────────────────────────────────────────────────────
export function findAlbum(albums: Album[], id: string): Album | null {
  for (const a of albums) {
    if (a.id === id) return a;
    const found = findAlbum(a.albums || [], id);
    if (found) return found;
  }
  return null;
}

function addImageToAlbum(albums: Album[], albumId: string, image: AlbumImage): boolean {
  for (const a of albums) {
    if (a.id === albumId) { a.images.unshift(image); return true; }
    if (addImageToAlbum(a.albums || [], albumId, image)) return true;
  }
  return false;
}

function addSubAlbum(albums: Album[], parentId: string, newAlbum: Album): boolean {
  for (const a of albums) {
    if (a.id === parentId) { a.albums = [...(a.albums || []), newAlbum]; return true; }
    if (addSubAlbum(a.albums || [], parentId, newAlbum)) return true;
  }
  return false;
}

export function collectAllImages(album: Album): string[] {
  const srcs = album.images.map(i => i.src);
  for (const sub of (album.albums || [])) srcs.push(...collectAllImages(sub));
  return srcs;
}

export function removeAlbum(albums: Album[], id: string): Album[] {
  return albums
    .filter(a => a.id !== id)
    .map(a => ({ ...a, albums: removeAlbum(a.albums || [], id) }));
}

// ── Persistence ───────────────────────────────────────────────────────────────
export async function readAlbums(): Promise<Album[]> {
  try {
    const raw = await fs.readFile(albumsFile, 'utf-8');
    const albums = JSON.parse(raw);
    // Ensure every album has an `albums` field
    const normalise = (a: any): Album => ({ ...a, albums: (a.albums || []).map(normalise) });
    return albums.map(normalise);
  } catch {
    await fs.mkdir(galleryDir, { recursive: true });
    let images: AlbumImage[] = [];
    try {
      const files = await fs.readdir(galleryDir);
      let legacyMeta: any[] = [];
      try { legacyMeta = JSON.parse(await fs.readFile(legacyFile, 'utf-8')); } catch { }
      const metaMap = new Map(legacyMeta.map((m: any) => [m.file, m.caption || '']));
      images = files
        .filter(f => f !== '.gitkeep' && f !== 'gallery.json' && f !== 'albums.json')
        .map(file => ({ src: `/api/media/uploads/gallery/${file}`, caption: (metaMap.get(file) as string) || '' }));
    } catch { }
    const initial: Album[] = [{ id: 'general', name: 'General', images, albums: [] }];
    await saveAlbums(initial);
    return initial;
  }
}

export async function saveAlbums(albums: Album[]) {
  await fs.mkdir(galleryDir, { recursive: true });
  await fs.writeFile(albumsFile, JSON.stringify(albums, null, 2));
}

// ── GET: return full album tree ───────────────────────────────────────────────
export async function GET() {
  try {
    const isAdmin = (await cookies()).has('pi_auth');
    const albums = await readAlbums();
    return NextResponse.json({ success: true, albums, isAdmin });
  } catch (error) {
    console.error('Gallery Error:', error);
    return NextResponse.json({ success: false, message: 'Error reading gallery' }, { status: 500 });
  }
}

// ── POST: create a new album (optionally as sub-album) ────────────────────────
export async function POST(request: Request) {
  try {
    const cookieStore = await cookies();
    if (!cookieStore.has('pi_auth')) return NextResponse.json({ success: false }, { status: 401 });

    const { name, parentId } = await request.json();
    if (!name?.trim()) return NextResponse.json({ success: false, message: 'Album name is required' }, { status: 400 });

    const newAlbum: Album = {
      id: `album-${Date.now()}-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
      name: name.trim(),
      images: [],
      albums: []
    };

    const albums = await readAlbums();
    if (parentId) {
      const added = addSubAlbum(albums, parentId, newAlbum);
      if (!added) return NextResponse.json({ success: false, message: 'Parent album not found' }, { status: 404 });
    } else {
      albums.push(newAlbum);
    }

    await saveAlbums(albums);
    return NextResponse.json({ success: true, album: newAlbum });
  } catch (error) {
    console.error('Create Album Error:', error);
    return NextResponse.json({ success: false }, { status: 500 });
  }
}
