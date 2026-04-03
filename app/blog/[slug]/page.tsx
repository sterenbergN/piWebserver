'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import ReactMarkdown from 'react-markdown';

export default function BlogPost() {
  const params = useParams();
  const router = useRouter();
  const slug = params.slug as string;

  const [markdown, setMarkdown] = useState('');
  const [post, setPost] = useState<any>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);

  // Photo gallery state
  const [photoIndex, setPhotoIndex] = useState(0);
  const [editingPhoto, setEditingPhoto] = useState<{ src: string; description: string } | null>(null);
  const [savingPhoto, setSavingPhoto] = useState(false);

  useEffect(() => {
    fetch(`/api/blog/${slug}`)
      .then(res => res.json())
      .then(data => {
        if (data.success) {
          setMarkdown(data.content);
          if (data.post) setPost(data.post);
          setIsAdmin(data.isAdmin || false);
        } else {
          setMarkdown('# Post Not Found\n\nThe post could not be found.');
        }
        setLoading(false);
      })
      .catch(() => { setMarkdown('# Error\n\nFailed to load.'); setLoading(false); });
  }, [slug]);

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

  if (loading) return <div style={{ padding: '4rem', textAlign: 'center' }}>Loading...</div>;

  const imageSrc = post?.image
    ? (post.image.startsWith('/api/media') ? post.image : '/api/media' + post.image)
    : null;
  const photos: any[] = post?.photos || [];
  const currentPhoto = photos[photoIndex];

  return (
    <div className="animate-fade-in" style={{ padding: '2rem 0' }}>
      <div style={{ maxWidth: '900px', margin: '0 auto', paddingBottom: '4rem' }}>
        <button className="btn btn-secondary" onClick={() => router.back()} style={{ marginBottom: '2rem' }}>
          ← Back to Blog
        </button>

        {post && (
          <div style={{ marginBottom: '3rem', textAlign: 'center' }}>
            <h1 style={{ marginBottom: '1rem' }}>{post.title}</h1>
            <p style={{ fontSize: '1.1rem', color: 'var(--accent-light)', marginBottom: '1.5rem' }}>{post.description}</p>
            <p style={{ fontSize: '0.85rem', opacity: 0.5, marginBottom: '2rem' }}>
              {new Date(post.date).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })}
            </p>
            {imageSrc && (
              <div style={{ width: '100%', maxHeight: '500px', borderRadius: '16px', overflow: 'hidden', marginBottom: '3rem' }}>
                <img src={imageSrc} alt={post.title} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              </div>
            )}
          </div>
        )}

        {/* Markdown Body */}
        <div className="glass-panel markdown-body" style={{ padding: '2.5rem', lineHeight: 1.85 }}>
          <ReactMarkdown>{markdown}</ReactMarkdown>
        </div>

        {/* Photo Gallery Strip */}
        {photos.length > 0 && (
          <div style={{ marginTop: '3rem' }}>
            <h2 style={{ marginBottom: '1.5rem' }}>Post Photos</h2>

            {/* Photo viewer */}
            <div className="glass-panel" style={{ padding: '1.5rem' }}>
              <div style={{ position: 'relative', width: '100%', borderRadius: '12px', overflow: 'hidden', marginBottom: '1.5rem' }}>
                <img
                  src={currentPhoto.src}
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
      </div>
    </div>
  );
}
