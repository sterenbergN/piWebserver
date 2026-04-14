import { NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';
import { isAdminAuthenticated } from '@/lib/security/server-auth';

export async function GET() {
  try {
    const isAdmin = await isAdminAuthenticated();
    const blogDir = path.join(process.cwd(), 'public', 'uploads', 'blog');
    const postsFile = path.join(blogDir, 'posts.json');
    
    // Ensure directory exists
    try {
      await fs.access(blogDir);
    } catch {
      await fs.mkdir(blogDir, { recursive: true });
    }

    // Read posts.json or return empty
    let posts = [];
    try {
      const data = await fs.readFile(postsFile, 'utf-8');
      posts = JSON.parse(data);
    } catch {
      posts = [];
    }
      
    return NextResponse.json({ success: true, posts, isAdmin });
  } catch (error) {
    console.error("Blog Error:", error);
    return NextResponse.json({ success: false, message: "Error reading blog posts" }, { status: 500 });
  }
}
