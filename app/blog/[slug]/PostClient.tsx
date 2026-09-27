'use client';

import { useState } from 'react';
import Markdown from 'react-markdown';
import Link from 'next/link';
import { useSitePopup } from '@/components/SitePopup';
import { mediaSrc, mediaSrcSet } from '@/lib/media-url';

type PostLink = { slug: string; title: string };
type PostClientProps = {
  slug: string;
  initialMarkdown: string;
  initialPost: any;
  isAdmin: boolean;
  neighbors: { newer?: PostLink; older?: PostLink };
};

export default function PostClient({ slug, initialMarkdown, initialPost, isAdmin, neighbors }: PostClientProps) {
  const { popup } = useSitePopup();
  const markdown = initialMarkdown;
  const [linkCopied, setLinkCopied] = useState(false);
  const [post, setPost] = useState<any>(initialPost);

  // Photo gallery state
  const [photoIndex, setPhotoIndex] = useState(0);
  const [editingPhoto, setEditingPhoto] = useState<{ src: string; description: string } | null>(null);
  const [savingPhoto, setSavingPhoto] = useState(false);



  const sharePost = async () => {
    const url = window.location.href;
    const nav = navigator as Navigator & { share?: (d: { title?: string; url: string }) => Promise<void> };
    if (nav.share) { try { await nav.share({ title: post?.title, url }); return; } catch { /* fall back to copy */ } }
    await navigator.clipboard.writeText(url).catch(() => {});
    setLinkCopied(true);
    setTimeout(() => setLinkCopied(false), 2000);
  };
  // ~220 words a minute, ignoring markdown syntax.
  const readingMinutes = Math.max(1, Math.round(markdown.replace(/[#*_`>\[\]()!-]/g, ' ').split(/\s+/).filter(Boolean).length / 220));

  const handleSavePhotoEdit = async () => {
    if (!editingPhoto) return;
    setSavingPhoto(true);
    const res = await fetch('/api/edit', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'blog-photo', slug, src: editingPhoto.src, description: editingPhoto.description })
    });
    const data = await res.json();
    if (data.success) {
      setPost((prev: any) => ({
        ...prev,
        photos: prev.photos.map((p: any) => p.src === editingPhoto.src ? { ...p, description: editingPhoto.description } : p)
      }));
      setEditingPhoto(null);
    }
    setSavingPhoto(false);
  };
  const handleDownloadMarkdown = () => {
    const blob = new Blob([markdown], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${slug}.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const cover = post?.image || null;
  const photos: any[] = post?.photos || [];
  const currentPhoto = photos[photoIndex];


  return (
    <div className="animate-fade-in" style={{ padding: '2rem 0' }}>
      <div style={{ maxWidth: '900px', margin: '0 auto', paddingBottom: '4rem' }}>
        <Link className="btn btn-secondary" href="/blog" style={{ marginBottom: '2rem', display: 'inline-flex' }}>
          ← All posts
        </Link>

        {post && (
          <div style={{ marginBottom: '3rem', textAlign: 'center' }}>
            <h1 style={{ marginBottom: '1rem' }}>{post.title}</h1>
            <p style={{ fontSize: '1.1rem', color: 'var(--accent-light)', marginBottom: '1.5rem' }}>{post.description}</p>
            <p style={{ fontSize: '0.85rem', opacity: 0.5, marginBottom: '2rem' }}>
              {new Date(post.date).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })}
              {' · '}{readingMinutes} min read
              {' · '}
              <button onClick={sharePost} style={{ background: 'none', border: 'none', color: 'inherit', cursor: 'pointer', textDecoration: 'underline', font: 'inherit', padding: 0 }}>
                {linkCopied ? 'Link copied' : 'Share'}
              </button>
            </p>
            {isAdmin && (
              <div style={{ marginBottom: '2rem', display: 'flex', flexWrap: 'wrap', gap: '0.5rem', justifyContent: 'center' }}>
                {/* The editor covers the text, title, summary, category and cover. */}
                <Link className="btn btn-primary" href={`/admin/posts/${slug}`} style={{ fontSize: '0.85rem', padding: '0.45rem 0.9rem' }}>
                  ✏️ Edit post
                </Link>
                <button className="btn btn-secondary" onClick={handleDownloadMarkdown} style={{ fontSize: '0.85rem', padding: '0.45rem 0.9rem' }}>
                  ⬇️ Download .md
                </button>
              </div>
            )}

            {cover && (
              <div style={{ width: '100%', maxHeight: '500px', borderRadius: '16px', overflow: 'hidden', marginBottom: '3rem' }}>
                {/* A screen-sized copy, not the multi-MB original. */}
                <img src={mediaSrc(cover, 1280)} srcSet={mediaSrcSet(cover, [640, 960, 1280, 1920])} sizes="(max-width: 900px) 100vw, 900px"
                  alt={post.title} fetchPriority="high" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
              </div>
            )}
          </div>
        )}

        {/* Markdown Body */}
        <div className="glass-panel markdown-body post-body">
          <Markdown
            components={{
              a: ({ node, ...props}) => (
                <a {...props}
                target="_blank"
                rel="noopener noreferrer"
                style={{ color: 'var(--accent)', textDecoration: 'underline' }} />
              ),
              // Pictures in the text: a screen-sized copy, loaded as they scroll into view.
              img: ({ node: _node, src, alt }) => typeof src === 'string' && src.startsWith('/api/media') ? (
                <img src={mediaSrc(src, 1280)} srcSet={mediaSrcSet(src, [640, 960, 1280, 1920])} sizes="(max-width: 900px) 100vw, 860px" alt={alt || ''} loading="lazy" decoding="async" />
              ) : <img src={typeof src === 'string' ? src : undefined} alt={alt || ''} loading="lazy" />,
            }}
          >{markdown}</Markdown>
        </div>

        {/* Photo Gallery Strip */}
        {photos.length > 0 && (
          <div style={{ marginTop: '3rem' }}>
            <h2 style={{ marginBottom: '1.5rem' }}>Post Photos</h2>

            {/* Photo viewer */}
            <div className="glass-panel" style={{ padding: '1.5rem' }}>
              <div style={{ position: 'relative', width: '100%', borderRadius: '12px', overflow: 'hidden', marginBottom: '1.5rem' }}>
                <img
                  src={mediaSrc(currentPhoto.src, 1280)}
                  srcSet={mediaSrcSet(currentPhoto.src, [640, 960, 1280, 1920])}
                  sizes="(max-width: 900px) 100vw, 900px"
                  loading="lazy"
                  alt={currentPhoto.description || `Photo ${photoIndex + 1}`}
                  style={{ width: '100%', maxHeight: '70vh', objectFit: 'contain', background: 'rgba(0,0,0,0.2)' }}
                />
              </div>

              {/* Counter + Description */}
              <div style={{ textAlign: 'center', marginBottom: '1.5rem' }}>
                <p style={{ fontSize: '0.85rem', opacity: 0.55, marginBottom: '0.5rem' }}>
                  Photo {photoIndex + 1} of {photos.length}
                </p>
                {editingPhoto && editingPhoto.src === currentPhoto.src ? (
                  <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'center', flexWrap: 'wrap' }}>
                    <input value={editingPhoto.description} onChange={e => setEditingPhoto({ ...editingPhoto, description: e.target.value })}
                      placeholder="Photo description" style={{ maxWidth: '420px' }} />
                    <button className="btn btn-primary" onClick={handleSavePhotoEdit} disabled={savingPhoto}>{savingPhoto ? 'Saving...' : 'Save'}</button>
                    <button className="btn btn-secondary" onClick={() => setEditingPhoto(null)}>Cancel</button>
                  </div>
                ) : (
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.75rem' }}>
                    {currentPhoto.description && (
                      <p style={{ margin: 0, fontSize: '1rem' }}>{currentPhoto.description}</p>
                    )}
                    {isAdmin && (
                      <button onClick={() => setEditingPhoto({ src: currentPhoto.src, description: currentPhoto.description || '' })}
                        style={{ background: '#3182ce', color: 'white', border: 'none', borderRadius: '4px', padding: '0.3rem 0.6rem', cursor: 'pointer', fontSize: '0.8rem' }}>
                        ✏️
                      </button>
                    )}
                  </div>
                )}
              </div>

              {/* Navigation */}
              <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '1rem' }}>
                <button className="btn btn-secondary" onClick={() => setPhotoIndex(i => Math.max(0, i - 1))} disabled={photoIndex === 0}>
                  ← Prev
                </button>
                {photos.map((_, i) => (
                  <button key={i} onClick={() => setPhotoIndex(i)}
                    style={{ width: 10, height: 10, borderRadius: '50%', border: 'none', cursor: 'pointer', background: i === photoIndex ? 'var(--accent)' : 'var(--surface-border)', padding: 0 }}
                  />
                ))}
                <button className="btn btn-secondary" onClick={() => setPhotoIndex(i => Math.min(photos.length - 1, i + 1))} disabled={photoIndex === photos.length - 1}>
                  Next →
                </button>
              </div>
            </div>
          </div>
        )}
        {(neighbors.newer || neighbors.older) && (
          <nav aria-label="More posts" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1rem', marginTop: '3rem' }}>
            {neighbors.older ? (
              <Link href={`/blog/${neighbors.older.slug}`} className="glass-panel" style={{ padding: '1rem 1.25rem', textDecoration: 'none', color: 'var(--foreground)' }}>
                <span style={{ fontSize: '0.75rem', color: 'var(--muted)' }}>← Older</span>
                <strong style={{ display: 'block' }}>{neighbors.older.title}</strong>
              </Link>
            ) : <span />}
            {neighbors.newer && (
              <Link href={`/blog/${neighbors.newer.slug}`} className="glass-panel" style={{ padding: '1rem 1.25rem', textDecoration: 'none', color: 'var(--foreground)', textAlign: 'right' }}>
                <span style={{ fontSize: '0.75rem', color: 'var(--muted)' }}>Newer →</span>
                <strong style={{ display: 'block' }}>{neighbors.newer.title}</strong>
              </Link>
            )}
          </nav>
        )}
      </div>
      {popup}
    </div>
  );
}
