'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { useSitePopup } from '@/components/SitePopup';
import AdminQuickNav from '@/components/admin/AdminQuickNav';
import type { PostDraft } from '@/lib/blog/drafts';
import type { PostMeta } from '@/lib/site-content';

function formatWhen(iso?: string) {
  if (!iso) return 'Unknown date';
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? iso : new Date(ms).toLocaleString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

export default function PostsManager({
  initialPosts,
  initialDrafts,
}: {
  initialPosts: PostMeta[];
  initialDrafts: PostDraft[];
}) {
  const { confirm, showAlert, popup } = useSitePopup();
  const [posts, setPosts] = useState(initialPosts);
  const [drafts, setDrafts] = useState(initialDrafts);
  const [query, setQuery] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);

  const postTitleMap = useMemo(
    () => new Map(posts.map((p) => [p.slug, p.title])),
    [posts],
  );
  const draftSlugs = useMemo(
    () => new Set(drafts.map((d) => d.slug).filter(Boolean)),
    [drafts],
  );

  const sortedPosts = useMemo(
    () => [...posts].sort((a, b) => (b.date || '').localeCompare(a.date || '')),
    [posts],
  );

  const q = query.trim().toLowerCase();
  const filteredPosts = useMemo(
    () => sortedPosts.filter((p) =>
      !q ||
      p.title.toLowerCase().includes(q) ||
      p.slug.toLowerCase().includes(q) ||
      (p.category || '').toLowerCase().includes(q) ||
      (p.description || '').toLowerCase().includes(q)),
    [sortedPosts, q],
  );
  const filteredDrafts = useMemo(
    () => drafts.filter((d) =>
      !q ||
      (d.title || '').toLowerCase().includes(q) ||
      (d.slug || '').toLowerCase().includes(q) ||
      (d.category || '').toLowerCase().includes(q)),
    [drafts, q],
  );

  const deleteDraftItem = async (d: PostDraft) => {
    const label = d.title || 'Untitled draft';
    if (!(await confirm({ title: 'Delete draft', message: `Delete “${label}”? This cannot be undone.`, confirmLabel: 'Delete', danger: true }))) return;
    setBusyId(d.id);
    try {
      const res = await fetch(`/api/blog/drafts?id=${encodeURIComponent(d.id)}`, { method: 'DELETE' });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.success) throw new Error(data?.message || 'Could not delete draft.');
      setDrafts((prev) => prev.filter((x) => x.id !== d.id));
    } catch (err) {
      showAlert({ title: 'Delete failed', message: err instanceof Error ? err.message : 'Could not delete draft.' });
    } finally {
      setBusyId(null);
    }
  };

  const deletePostItem = async (p: PostMeta) => {
    if (!(await confirm({ title: 'Delete post', message: `Delete “${p.title}” from the blog? This cannot be undone.`, confirmLabel: 'Delete', danger: true }))) return;
    setBusyId(p.slug);
    try {
      const res = await fetch('/api/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'blog', id: p.slug }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.success) throw new Error(data?.message || 'Could not delete post.');
      setPosts((prev) => prev.filter((x) => x.slug !== p.slug));
    } catch (err) {
      showAlert({ title: 'Delete failed', message: err instanceof Error ? err.message : 'Could not delete post.' });
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="adm animate-fade-in">
      {popup}
      <div className="adm-top">
        <div>
          <Link href="/admin" className="adm-back-link">← Admin</Link>
          <h1>Posts &amp; Drafts</h1>
        </div>
        <div className="adm-actions">
          <Link href="/blog" className="btn btn-secondary">View Blog</Link>
          <Link href="/admin/posts/new" className="btn btn-primary">+ New Post</Link>
        </div>
      </div>

      <AdminQuickNav current="/admin/posts" />

      <div style={{ marginBottom: '1.25rem' }}>
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Filter posts and drafts by title, slug, or category…"
          aria-label="Filter posts and drafts"
        />
      </div>

      <section className="adm-card" aria-labelledby="drafts-heading">
        <div className="adm-card-head">
          <div>
            <h2 id="drafts-heading">Saved Drafts ({filteredDrafts.length})</h2>
            <p>Work in progress saved on the server (.data/blog-drafts.json).</p>
          </div>
        </div>
        {filteredDrafts.length === 0 ? (
          <p className="adm-muted" style={{ margin: 0 }}>
            {drafts.length === 0 ? 'No saved drafts right now.' : 'No drafts match that filter.'}
          </p>
        ) : (
          <div className="adm-list">
            {filteredDrafts.map((d) => (
              <div key={d.id} className="adm-row">
                <div className="adm-row-main">
                  <strong>{d.title || 'Untitled draft'}</strong>
                  <div className="adm-row-sub">
                    {d.slug ? `Changes to “${postTitleMap.get(d.slug) || d.slug}”` : 'New post'}
                    {d.category ? ` · ${d.category}` : ''}
                    {` · Updated ${formatWhen(d.updatedAt)}`}
                  </div>
                </div>
                <div className="adm-actions">
                  <Link
                    href={`/admin/posts/${d.slug || 'new'}?draft=${encodeURIComponent(d.id)}`}
                    className="btn btn-primary adm-small-btn"
                  >
                    Edit
                  </Link>
                  <button
                    type="button"
                    className="adm-icon-btn is-danger"
                    disabled={busyId === d.id}
                    onClick={() => void deleteDraftItem(d)}
                    aria-label={`Delete draft ${d.title || 'Untitled'}`}
                    title="Delete draft"
                  >
                    ✕
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="adm-card" aria-labelledby="published-heading">
        <div className="adm-card-head">
          <div>
            <h2 id="published-heading">Published Posts ({filteredPosts.length})</h2>
            <p>Live posts shown on the blog and RSS feed.</p>
          </div>
        </div>
        {filteredPosts.length === 0 ? (
          <p className="adm-muted" style={{ margin: 0 }}>
            {posts.length === 0 ? 'No published posts yet.' : 'No posts match that filter.'}
          </p>
        ) : (
          <div className="adm-list">
            {filteredPosts.map((p) => (
              <div key={p.slug} className="adm-row">
                <div className="adm-row-main">
                  <strong>
                    {p.title}
                    {draftSlugs.has(p.slug) && <span className="adm-badge is-new" style={{ marginLeft: '0.5rem' }}>Draft</span>}
                  </strong>
                  <div className="adm-row-sub">
                    {p.category || 'Uncategorized'} · {formatWhen(p.date)} · <code>/blog/{p.slug}</code>
                  </div>
                </div>
                <div className="adm-actions">
                  <Link href={`/admin/posts/${p.slug}`} className="btn btn-primary adm-small-btn">Edit</Link>
                  <Link href={`/blog/${p.slug}`} className="btn btn-secondary adm-small-btn">View</Link>
                  <button
                    type="button"
                    className="adm-icon-btn is-danger"
                    disabled={busyId === p.slug}
                    onClick={() => void deletePostItem(p)}
                    aria-label={`Delete post ${p.title}`}
                    title="Delete post"
                  >
                    ✕
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
