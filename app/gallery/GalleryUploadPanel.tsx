'use client';

import { useState } from 'react';
import ProgressBar from '@/components/ProgressBar';
import { uploadWithProgress } from '@/lib/upload-client';

type Notice = { text: string; type: 'success' | 'error' } | null;

type GalleryUploadPanelProps = {
  /** The album being viewed; photos go here. Null at the top level, where an album is picked. */
  album: { id: string; name: string } | null;
  /** Every album as "Parent › Child", for the picker at the top level. */
  albums: { id: string; path: string }[];
  onUploaded: () => Promise<void> | void;
  onClose: () => void;
};

/** Admin: add photos to the album you're looking at (one request per photo). */
export default function GalleryUploadPanel({ album, albums, onUploaded, onClose }: GalleryUploadPanelProps) {
  const [albumId, setAlbumId] = useState(albums[0]?.id || 'general');
  const [files, setFiles] = useState<File[]>([]);
  const [caption, setCaption] = useState('');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [batch, setBatch] = useState({ index: 0, total: 0 });
  const [notice, setNotice] = useState<Notice>(null);
  const [inputKey, setInputKey] = useState(0);

  const target = album?.id || albumId;

  const upload = async () => {
    if (files.length === 0) return;
    setBusy(true);
    setNotice(null);
    let saved = 0;
    const failed: string[] = [];
    // One at a time, so one bad file doesn't sink the batch (and the Pi isn't swamped).
    for (const [i, file] of files.entries()) {
      setBatch({ index: i + 1, total: files.length });
      setProgress(0);
      const form = new FormData();
      form.append('type', 'gallery');
      form.append('albumId', target);
      form.append('caption', files.length === 1 ? caption.trim() : '');
      form.append('image', file);
      try {
        if ((await uploadWithProgress(form, setProgress)).success) saved++;
        else failed.push(file.name);
      } catch {
        failed.push(file.name);
      }
    }
    await onUploaded();
    setNotice(failed.length === 0
      ? { text: `Added ${saved} photo${saved === 1 ? '' : 's'}.`, type: 'success' }
      : { text: `Added ${saved} of ${files.length}. Didn't upload: ${failed.join(', ')}`, type: 'error' });
    setFiles([]);
    setCaption('');
    setInputKey((k) => k + 1);
    setBusy(false);
    setBatch({ index: 0, total: 0 });
  };

  return (
    <div className="glass-panel animate-fade-in gal-upload">
      <div className="gal-upload-head">
        <strong>{album ? `Add photos to “${album.name}”` : 'Add photos'}</strong>
        <button type="button" className="gal-close" onClick={onClose} disabled={busy} aria-label="Close">✕</button>
      </div>

      {notice && <div className={`gal-notice ${notice.type === 'success' ? 'is-success' : 'is-error'}`} role="status">{notice.text}</div>}

      <div className="gal-upload-fields">
        {!album && (
          <label>
            <span className="gal-label">Album</span>
            <select className="gal-select" value={albumId} onChange={(e) => setAlbumId(e.target.value)} disabled={busy}>
              {albums.map((a) => <option key={a.id} value={a.id}>{a.path}</option>)}
              {albums.length === 0 && <option value="general">General</option>}
            </select>
          </label>
        )}
        <label className="gal-file">
          <span className="gal-label">Photos (max 25 MB each)</span>
          <input key={inputKey} type="file" accept="image/*" multiple disabled={busy} onChange={(e) => setFiles([...(e.target.files || [])])} />
        </label>
        {files.length === 1 && (
          <label>
            <span className="gal-label">Caption (optional)</span>
            <input value={caption} onChange={(e) => setCaption(e.target.value)} placeholder="A beautiful sunset…" disabled={busy} />
          </label>
        )}
      </div>

      {busy && (
        <ProgressBar
          value={progress}
          label={batch.total > 1 ? `Uploading photo ${batch.index} of ${batch.total}…` : progress >= 100 ? 'Processing on the Pi…' : 'Uploading…'}
          detail={`${progress}%`}
        />
      )}

      <div>
        <button type="button" className="btn btn-primary" onClick={upload} disabled={busy || files.length === 0}>
          {busy ? 'Uploading…' : files.length > 1 ? `Upload ${files.length} photos` : 'Upload'}
        </button>
      </div>
    </div>
  );
}
