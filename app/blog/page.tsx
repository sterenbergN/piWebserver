import { isAdminAuthenticated } from '@/lib/security/server-auth';
import { getPosts } from '@/lib/site-content';
import BlogClient from './BlogClient';

// Posts are read on the server so the list is in the first paint.
export default async function BlogPage() {
  const [posts, isAdmin] = await Promise.all([getPosts(), isAdminAuthenticated()]);
  return <BlogClient initialPosts={posts as never} initialIsAdmin={isAdmin} />;
}
