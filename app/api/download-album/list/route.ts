import { NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';
import { isAdminAuthenticated } from '@/lib/security/server-auth';

export async function GET(request: Request) {
  try {
    if (!(await isAdminAuthenticated())) {
      return NextResponse.json({ success: false, message: 'Unauthorized' }, { status: 401 });
    }

    const tempDir = path.join(process.cwd(), 'public', 'temp', 'downloads');
    
    try {
      await fs.access(tempDir);
    } catch {
      return NextResponse.json({ success: true, downloads: [] });
    }

    const files = await fs.readdir(tempDir);
    const downloads: any[] = [];
    
    for (const file of files) {
      if (file.endsWith('.zip')) {
        const fullPath = path.join(tempDir, file);
        const stat = await fs.stat(fullPath);
        downloads.push({
          name: file.replace(/^album_/, '').replace(/_[a-fA-F0-9-]+\.zip$/, '.zip'), // beautify name
          filename: file,
          url: `/api/download-album/file?name=${file}`,
          sizeBytes: stat.size,
          createdAt: stat.mtimeMs
        });
      }
    }

    // Sort newest first
    downloads.sort((a, b) => b.createdAt - a.createdAt);

    return NextResponse.json({ success: true, downloads });
  } catch (error) {
    return NextResponse.json({ success: false }, { status: 500 });
  }
}
