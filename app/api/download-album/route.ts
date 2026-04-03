import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import fs from 'fs/promises';
import { createReadStream } from 'fs';
import path from 'path';
import AdmZip from 'adm-zip';

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

export async function GET(request: Request) {
  try {
    const cookieStore = await cookies();
    if (!cookieStore.has('pi_auth')) {
      return NextResponse.json({ success: false, message: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    const photoSrc = searchParams.get('photo');

    if (photoSrc) {
      // Download single photo
      const relativePath = photoSrc.replace(/^\/api\/media/, '');
      const absolutePath = path.join(process.cwd(), 'public', relativePath);
      const filename = path.basename(absolutePath);

      const fileBuffer = await fs.readFile(absolutePath);
      return new NextResponse(fileBuffer, {
        headers: {
          'Content-Disposition': `attachment; filename="${filename}"`,
          'Content-Type': 'application/octet-stream',
        },
      });
    }

    if (!id) return NextResponse.json({ success: false }, { status: 400 });

    const albumsFile = path.join(baseDir, 'gallery', 'albums.json');
    let albums: any[] = [];
    try {
      albums = JSON.parse(await fs.readFile(albumsFile, 'utf-8'));
    } catch {
      return NextResponse.json({ success: false, message: 'No albums found' }, { status: 404 });
    }

    const target = id === 'all' 
      ? { id: 'all', name: 'All_Photos', images: [], albums } // virtual root
      : findAlbum(albums, id);

    if (!target) {
      return NextResponse.json({ success: false, message: 'Album not found' }, { status: 404 });
    }

    const srcs = collectAllImages(target);
    const zip = new AdmZip();

    for (let i = 0; i < srcs.length; i++) {
        const src = srcs[i];
        const relativePath = src.replace(/^\/api\/media/, '');
        const absolutePath = path.join(process.cwd(), 'public', relativePath);
        
        try {
            // Check if file exists before adding
            await fs.access(absolutePath);
            // Ensure unique filenames within zip if there are duplicates
            const ext = path.extname(absolutePath);
            const name = path.basename(absolutePath, ext);
            zip.addLocalFile(absolutePath, '', `${name}_${i}${ext}`);
        } catch {
            // file doesn't exist on disk, skip
        }
    }

    const zipBuffer = zip.toBuffer();
    const safeName = target.name.replace(/[^a-zA-Z0-9]/g, '_');

    return new NextResponse(zipBuffer, {
        headers: {
            'Content-Disposition': `attachment; filename="album_${safeName}.zip"`,
            'Content-Type': 'application/zip',
            'Content-Length': zipBuffer.length.toString()
        }
    });

  } catch (error) {
    console.error('Download Error:', error);
    return NextResponse.json({ success: false }, { status: 500 });
  }
}
