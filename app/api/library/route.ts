import { NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';
import { publicLibraryFile } from '@/lib/reader/items';
import { isAdminAuthenticated } from '@/lib/security/server-auth';

export async function GET() {
  try {
    const isAdmin = await isAdminAuthenticated();
    const libraryDir = path.join(process.cwd(), 'public', 'uploads', 'library');
    
    try {
      await fs.access(libraryDir);
    } catch {
      await fs.mkdir(libraryDir, { recursive: true });
      return NextResponse.json({ success: true, documents: [], isAdmin });
    }

    let documents = [];
    try {
      const raw = await fs.readFile(path.join(libraryDir, 'library.json'), 'utf-8');
      documents = JSON.parse(raw);
    } catch { /* None exist yet */ }
    // How big each is, for the Reader's shelf.
    if (Array.isArray(documents)) {
      documents = await Promise.all(documents.map(async (doc: { url?: unknown }) => {
        const name = publicLibraryFile(doc?.url);
        const size = name ? (await fs.stat(path.join(libraryDir, name)).catch(() => null))?.size : undefined;
        return size ? { ...doc, size } : doc;
      }));
    }
    
    return NextResponse.json({ success: true, documents, isAdmin });
  } catch (error) {
    console.error("Library Read Error:", error);
    return NextResponse.json({ success: false, message: "Failed to parse system library registry." }, { status: 500 });
  }
}
