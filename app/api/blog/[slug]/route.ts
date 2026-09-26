import { NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';
import { isSafeBlogSlug, resolvePublicPath } from '@/lib/security/paths';
import { writeJsonAtomic } from '@/lib/json-store';
import { isAdminAuthenticated } from '@/lib/security/server-auth';

export async function GET(request: Request, context: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await context.params;
    // The slug becomes a file name; anything else (e.g. ../) must not reach the filesystem.
    if (!isSafeBlogSlug(slug)) {
      return NextResponse.json({ success: false, message: 'Post not found' }, { status: 404 });
    }
    const isAdmin = await isAdminAuthenticated();
    const blogDir = path.join(process.cwd(), 'public', 'uploads', 'blog');
    const filePath = path.join(blogDir, `${slug}.md`);

    const content = await fs.readFile(filePath, 'utf-8');

    let postMeta: any = null;
    try {
      const postsFile = path.join(blogDir, 'posts.json');
      const posts: any[] = JSON.parse(await fs.readFile(postsFile, 'utf-8'));
      postMeta = posts.find((p: any) => p.slug === slug) || null;

      // Self-heal: validate that each photo src actually exists on disk.
      // Photos from gallery/blog can become stale if deleted before the
      // blog-sync was wired up in the delete API.
      if (postMeta && Array.isArray(postMeta.photos) && postMeta.photos.length > 0) {
        const validPhotos: any[] = [];
        for (const photo of postMeta.photos) {
          // src: /api/media/uploads/blog/... → file: public/uploads/blog/...
          const absolutePath = resolvePublicPath(photo.src);
          if (!absolutePath) continue;
          try {
            await fs.access(absolutePath);
            validPhotos.push(photo);
          } catch {
            // File doesn't exist — skip (stale entry)
          }
        }

        // If we pruned any stale entries, write back to posts.json so it
        // self-heals on the next read too (O(1) subsequent loads).
        if (validPhotos.length !== postMeta.photos.length) {
          postMeta = { ...postMeta, photos: validPhotos };
          const updatedPosts = posts.map((p: any) =>
            p.slug === slug ? { ...p, photos: validPhotos } : p
          );
          await writeJsonAtomic(postsFile, updatedPosts, true);
        }
      }
    } catch { /* ignore — no posts.json yet */ }

    return NextResponse.json({ success: true, content, post: postMeta, isAdmin });
  } catch (error) {
    console.error('Markdown Fetch Error:', error);
    return NextResponse.json({ success: false, message: 'Post not found' }, { status: 404 });
  }
}
