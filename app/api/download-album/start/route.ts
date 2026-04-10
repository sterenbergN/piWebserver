import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';

const baseDir = path.join(process.cwd(), 'public', 'uploads');
const tempDir = path.join(process.cwd(), 'public', 'temp', 'downloads');

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

async function cleanupOldZips() {
  try {
    const files = await fs.readdir(tempDir);
    const now = Date.now();
    const MAX_AGE = 12 * 60 * 60 * 1000; // 12 hours
    for (const file of files) {
      const fullPath = path.join(tempDir, file);
      const stat = await fs.stat(fullPath);
      if (now - stat.mtimeMs > MAX_AGE) {
        await fs.unlink(fullPath).catch(() => {});
      }
    }
  } catch {
    // If directory doesn't exist, ignore
  }
}

export async function POST(request: Request) {
  try {
    const cookieStore = await cookies();
    if (!cookieStore.has('pi_auth')) {
      return NextResponse.json({ success: false, message: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await request.json();
    if (!id) return NextResponse.json({ success: false }, { status: 400 });

    // Ensure temp directory exists
    await fs.mkdir(tempDir, { recursive: true });
    
    // Cleanup old files
    await cleanupOldZips();

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
    const safeName = target.name.replace(/[^a-zA-Z0-9]/g, '_');
    const jobId = crypto.randomUUID();
    const progressFile = path.join(tempDir, `${jobId}.json`);
    const targetZipName = `album_${safeName}_${jobId.substring(0,6)}.zip`;
    const targetZipPath = path.join(tempDir, targetZipName);

    // Initial state
    const progressData: { status: string, progress: number, total: number, startTime: number, url: string | null, error: string | null } = {
      status: 'processing',
      progress: 0,
      total: srcs.length,
      startTime: Date.now(),
      url: null,
      error: null
    };
    
    await fs.writeFile(progressFile, JSON.stringify(progressData));

    // Dynamic import inside async to prevent module level blocking
    const AdmZip = (await import('adm-zip')).default;

    // Start background processing
    (async () => {
      try {
        const zip = new AdmZip();
        
        for (let i = 0; i < srcs.length; i++) {
          const src = srcs[i];
          const relativePath = src.replace(/^\/api\/media/, '');
          const absolutePath = path.join(process.cwd(), 'public', relativePath);
          
          try {
            await fs.access(absolutePath);
            const ext = path.extname(absolutePath);
            const name = path.basename(absolutePath, ext);
            zip.addLocalFile(absolutePath, '', `${name}_${i}${ext}`);
          } catch {
            // skip if missing
          }

          // Update progress every 10 files or on the last file
          if (i % 10 === 0 || i === srcs.length - 1) {
             progressData.progress = i + 1;
             await fs.writeFile(progressFile, JSON.stringify(progressData));
             // Yield to event loop to prevent complete lockup
             await new Promise(r => setTimeout(r, 10));
          }
        }

        // Write zip to disk. Note: for huge files, toBuffer might use a lot of memory, 
        // writeZip sync handles it but blocks. We write to file system.
        await new Promise<void>((resolve, reject) => {
             try {
                zip.writeZip(targetZipPath);
                resolve();
             } catch(e) { reject(e); }
        });

        // Update progress to completed
        progressData.status = 'completed';
        progressData.progress = srcs.length;
        progressData.url = `/api/download-album/file?name=${targetZipName}`;
        await fs.writeFile(progressFile, JSON.stringify(progressData));

      } catch (error: any) {
        progressData.status = 'error';
        progressData.error = error?.message || 'Unknown error occurred during zipping';
        await fs.writeFile(progressFile, JSON.stringify(progressData)).catch(()=>{});
      }
    })();

    return NextResponse.json({ success: true, jobId });

  } catch (error) {
    console.error('Download Job Error:', error);
    return NextResponse.json({ success: false }, { status: 500 });
  }
}
