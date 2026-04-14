import { NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';
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
    
    return NextResponse.json({ success: true, documents, isAdmin });
  } catch (error) {
    console.error("Library Read Error:", error);
    return NextResponse.json({ success: false, message: "Failed to parse system library registry." }, { status: 500 });
  }
}
