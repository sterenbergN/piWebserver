import type { Metadata } from 'next';
import { getPosts } from '@/lib/site-content';
import { listDrafts } from '@/lib/blog/drafts';
import PostsManager from '@/components/admin/PostsManager';
import '../admin.css';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = {
  title: 'Posts & Drafts',
  robots: { index: false, follow: false },
};

export default async function AdminPostsPage() {
  const [posts, drafts] = await Promise.all([getPosts(), listDrafts()]);
  return <PostsManager initialPosts={posts} initialDrafts={drafts} />;
}
