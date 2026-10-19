import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getPost, getPosts } from '@/lib/site-content';
import { listDrafts } from '@/lib/blog/drafts';
import PostEditor from '@/components/blog/PostEditor';
import './editor.css';

export const metadata: Metadata = { title: 'Write a post', robots: { index: false, follow: false } };

// /admin/posts/new or /admin/posts/<slug>, optionally ?draft=<id> to carry on with a saved draft.
// The /admin proxy already requires the admin login.
export default async function EditPostPage({ params, searchParams }: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const { slug } = await params;
  const { draft: draftParam } = await searchParams;
  const [posts, drafts] = await Promise.all([getPosts(), listDrafts()]);
  const categories = [...new Set(posts.map((p) => p.category).filter((c): c is string => !!c))].sort();
  const titles = Object.fromEntries(posts.map((p) => [p.slug, p.title]));
  const draft = drafts.find((d) => d.id === draftParam && d.slug === (slug === 'new' ? '' : slug)) || null;

  if (slug === 'new') return <PostEditor key={draft?.id || 'new'} categories={categories} drafts={drafts} postTitles={titles} draft={draft} />;

  const post = await getPost(slug);
  if (!post) notFound();
  return (
    <PostEditor
      key={draft?.id || slug}
      categories={categories}
      drafts={drafts}
      postTitles={titles}
      draft={draft}
      initial={{ slug: post.slug, title: post.title, description: post.description || '', category: post.category || '', markdown: post.content, cover: post.image || null }}
    />
  );
}
