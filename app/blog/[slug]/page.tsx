import { notFound } from 'next/navigation';
import { isAdminAuthenticated } from '@/lib/security/server-auth';
import { getPost, getPosts } from '@/lib/site-content';
import PostClient from './PostClient';

// Rendered on the server: the article is in the HTML (search engines, link
// previews, no "Loading…"), and a missing post is a real 404.
export default async function BlogPostPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const [post, all, isAdmin] = await Promise.all([getPost(slug), getPosts(), isAdminAuthenticated()]);
  if (!post) notFound();

  // Previous/next posts by date for the footer links.
  const byDate = [...all].sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  const i = byDate.findIndex((p) => p.slug === slug);
  const pick = (p?: { slug: string; title: string }) => (p ? { slug: p.slug, title: p.title } : undefined);
  const { content, ...meta } = post;

  return (
    <PostClient
      slug={slug}
      initialMarkdown={content}
      initialPost={meta}
      isAdmin={isAdmin}
      neighbors={{ newer: pick(byDate[i - 1]), older: pick(byDate[i + 1]) }}
    />
  );
}
