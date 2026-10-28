'use client';

import Link from 'next/link';
import { PostMarkdown, markdownWords } from '@/components/blog/MarkdownWriter';
import type { PrivatePost } from '@/lib/journal/private-posts';
import type { CadProject } from '@/lib/site-content';

/** A private post laid out like a blog post, for its owner only. */
export default function PrivatePostView({ post, cadProjects }: { post: PrivatePost; cadProjects: CadProject[] }) {
  const minutes = Math.max(1, Math.round(markdownWords(post.markdown) / 220));
  const fmt = (iso: string) => new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
  return (
    <article className="jr-post animate-fade-in">
      <div className="jr-post-bar">
        <Link className="btn btn-secondary" href="/journal/posts">← Private posts</Link>
        <Link className="btn btn-primary" href={`/journal/posts/${post.id}/edit`}>✏️ Edit</Link>
      </div>
      <header className="jr-post-head">
        <h1>{post.title || 'Untitled'}</h1>
        {post.description && <p className="jr-post-desc">{post.description}</p>}
        <p className="jr-post-meta" suppressHydrationWarning>
          <span aria-hidden>🔒</span> Private · {fmt(post.createdAt)}{fmt(post.updatedAt) !== fmt(post.createdAt) && ` · edited ${fmt(post.updatedAt)}`} · {minutes} min read
        </p>
        {post.cover && <img className="jr-post-cover" src={post.cover} alt="" />}
      </header>
      <div className="glass-panel markdown-body post-body">
        {post.markdown.trim() ? <PostMarkdown markdown={post.markdown} cadProjects={cadProjects} /> : <p className="pe-muted">Nothing written yet.</p>}
      </div>
    </article>
  );
}
