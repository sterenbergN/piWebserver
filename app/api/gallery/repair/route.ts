import { NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';
import { isAdminAuthenticated } from '@/lib/security/server-auth';

const baseDir = path.join(process.cwd(), 'public', 'uploads', 'gallery');

export async function POST(request: Request) {
  try {
    if (!(await isAdminAuthenticated())) {
      return NextResponse.json({ success: false, message: 'Unauthorized' }, { status: 401 });
    }

    // 1. Load existing albums.json
    const albumsFile = path.join(baseDir, 'albums.json');
    let albums: any[] = [];
    try {
      albums = JSON.parse(await fs.readFile(albumsFile, 'utf-8'));
    } catch {
      albums = [{ id: 'general', name: 'General', images: [], albums: [] }];
    }

    // 2. Scan physical files
    const files = await fs.readdir(baseDir);
    const imageFiles = files.filter(f => 
      !f.endsWith('.json') && 
      !f.includes('_thumb') && 
      /\.(jpg|jpeg|png|webp|gif|svg)$/i.test(f)
    );

    // 3. Collect all current image SRCS in JSON
    const collectExistingSrcs = (albumList: any[]): Set<string> => {
      const srcs = new Set<string>();
      for (const a of albumList) {
        a.images?.forEach((i: any) => srcs.add(i.src));
        const sub = collectExistingSrcs(a.albums || []);
        sub.forEach(s => srcs.add(s));
      }
      return srcs;
    };
    const existingSrcs = collectExistingSrcs(albums);

    // 4. Find orphaned files and add to General album
    let addedCount = 0;
    const generalAlbum = albums.find(a => a.id === 'general') || albums[0];
    
    for (const filename of imageFiles) {
      const src = `/api/media/uploads/gallery/${filename}`;
      if (!existingSrcs.has(src)) {
        generalAlbum.images.push({ src, caption: '' });
        addedCount++;
      }
    }

    // 5. Save back
    if (addedCount > 0) {
      await fs.writeFile(albumsFile, JSON.stringify(albums, null, 2));
    }

    return NextResponse.json({ success: true, added: addedCount });
  } catch (err: any) {
    console.error('Repair failed:', err);
    return NextResponse.json({ success: false, message: err.message }, { status: 500 });
  }
}
