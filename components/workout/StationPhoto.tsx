'use client';

import { useRef, useState } from 'react';

export const photoUrl = (id: string) => `/api/workout/photos/${encodeURIComponent(id)}`;

/** Equipment avatar: its photo if it has one, else the equipment-type icon. */
export function StationThumb({ photo, icon, label, small = true, eager = false }: { photo?: string; icon?: string; label?: string; small?: boolean; eager?: boolean }) {
  if (photo) {
    return <img className={`workout-avatar workout-photo${small ? ' is-small' : ''}`} src={photoUrl(photo)} alt={label ? `${label} photo` : ''} loading={eager ? 'eager' : 'lazy'} />;
  }
  return <span className={`workout-avatar${small ? ' is-small' : ''}`} aria-hidden title={label}>{icon}</span>;
}

/** Take or pick a photo of a machine; uploads it and reports the new photo id. */
export function PhotoPicker({ photo, onChange }: { photo?: string; onChange: (photo: string | undefined) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const upload = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    setError('');
    try {
      const form = new FormData();
      form.append('photo', file);
      const res = await fetch('/api/workout/photos', { method: 'POST', body: form });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) throw new Error(data.message || 'Upload failed');
      onChange(data.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  };

  return (
    <div className="workout-field">
      <span className="workout-label">Photo (optional)</span>
      <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'center' }}>
        {photo && <StationThumb photo={photo} small={false} label="Equipment" eager />}
        <button type="button" className="workout-button" disabled={busy} onClick={() => input.current?.click()}>
          {busy ? 'Uploading…' : photo ? '📷 Retake' : '📷 Add a photo'}
        </button>
        {photo && !busy && <button type="button" className="workout-text-btn" onClick={() => onChange(undefined)}>Remove</button>}
      </div>
      <span className="workout-hint" style={{ display: 'block', marginTop: '0.3rem' }}>Helps you spot the right machine when a gym has several that look alike.</span>
      {error && <p className="workout-error" style={{ margin: '0.3rem 0 0' }}>{error}</p>}
      <input ref={input} type="file" accept="image/*" capture="environment" hidden onChange={(e) => upload(e.target.files?.[0])} />
    </div>
  );
}
