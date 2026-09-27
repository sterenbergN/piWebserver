import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getPost, getPosts } from '@/lib/site-content';
import PostEditor from '@/components/blog/PostEditor';
import './editor.css';

export const metadata: Metadata = { title: 'Write a post', robots: { index: false, follow: false } };

// /admin/posts/new or /admin/posts/<slug> — the /admin proxy already requires the admin login.
export default async function EditPostPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const posts = await getPosts();
  const categories = [...new Set(posts.map((p) => p.category).filter((c): c is string => !!c))].sort();
  if (slug === 'new') return <PostEditor categories={categories} />;

  const post = await getPost(slug);
  if (!post) notFound();
  return (
    <PostEditor
      categories={categories}
      initial={{ slug: post.slug, title: post.title, description: post.description || '', category: post.category || '', markdown: post.content, cover: post.image || null }}
    />
  );
}
