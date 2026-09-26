'use client';

import { useEffect, useState } from 'react';
import { useSitePopup } from '@/components/SitePopup';
import ProgressBar from './ProgressBar';

type Settings = { enabled: boolean; dir: string; keep: number; hour: number; includeMedia: boolean; requireSeparateDrive: boolean; lastAutoBackup?: string };
type Drive = { ok: boolean; message: string; freeBytes?: number; totalBytes?: number };
type Backup = { name: string; size: number; createdAt: string; label: string };

const sizeLabel = (bytes: number) =>
  bytes > 1024 ** 3 ? `${(bytes / 1024 ** 3).toFixed(1)} GB`
    : bytes > 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;

const BUSY_LABELS: Record<string, string> = {
  create: 'Making a backup…',
  settings: 'Saving settings…',
  restore: 'Restoring (a safety backup is made first)…',
  delete: 'Deleting…',
  upload: 'Uploading backup…',
};

/** Admin panel: nightly backup settings, backup list, download, upload and restore. */
export default function BackupsPanel() {
  const { confirm, showAlert, popup } = useSitePopup();
  const [settings, setSettings] = useState<Settings | null>(null);
  const [draft, setDraft] = useState<Settings | null>(null);
  const [backups, setBackups] = useState<Backup[]>([]);
  const [drive, setDrive] = useState<Drive | null>(null);
  const [busy, setBusy] = useState('');
  const [loadError, setLoadError] = useState(false);

  const load = () => fetch('/api/backups').then((r) => r.json()).then((d) => {
    if (d.success) { setSettings(d.settings); setDraft(d.settings); setBackups(d.backups); setDrive(d.drive); setLoadError(false); } else setLoadError(true);
  }).catch(() => setLoadError(true));
  useEffect(() => { load(); }, []);

  const post = async (body: Record<string, unknown>) => {
    const res = await fetch('/api/backups', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.success) throw new Error(data.error || 'Backup action failed');
    return data;
  };
  const run = async (label: string, action: () => Promise<void>) => {
    setBusy(label);
    try { await action(); } catch (err) { showAlert({ title: 'Backup', message: err instanceof Error ? err.message : 'Failed' }); } finally { setBusy(''); }
  };

  const backUpNow = () => run('create', async () => { await post({ action: 'create' }); await load(); });
  const saveSettings = () => run('settings', async () => {
    const d = await post({ action: 'settings', settings: draft });
    setSettings(d.settings); setDraft(d.settings); setBackups(d.backups); setDrive(d.drive);
  });
  const restore = async (b: Backup) => {
    const ok = await confirm({
      title: 'Restore this backup?',
      message: `Everything saved in ${b.name} replaces the current data. A safety backup of the current data is made first, and files added since the backup are kept.`,
      confirmLabel: 'Restore', danger: true,
    });
    if (!ok) return;
    run('restore', async () => {
      const d = await post({ action: 'restore', name: b.name });
      await load();
      showAlert({ title: 'Restored', message: `Restored ${d.restored} files. Safety backup: ${d.safetyBackup}` });
    });
  };
  const remove = async (b: Backup) => {
    if (!(await confirm({ title: 'Delete backup?', message: b.name, confirmLabel: 'Delete', danger: true }))) return;
    run('delete', async () => { await post({ action: 'delete', name: b.name }); await load(); });
  };
  const upload = (file: File | undefined) => file && run('upload', async () => {
    const form = new FormData();
    form.append('file', file);
    const res = await fetch('/api/backups', { method: 'PUT', body: form });
    const d = await res.json().catch(() => ({}));
    if (!d.success) throw new Error(d.error || 'Upload failed');
    await load();
  });

  if (!settings || !draft) {
    return (
      <section className="adm-card">
        <div className="adm-card-head"><h2>💾 Backups</h2></div>
        {loadError ? <div className="adm-notice is-error">Could not load backup settings.</div> : <ProgressBar label="Loading backups…" />}
      </section>
    );
  }
  const dirty = JSON.stringify(settings) !== JSON.stringify(draft);

  return (
    <section className="adm-card" aria-labelledby="backups-title">
      {popup}
      <div className="adm-card-head">
        <div>
          <h2 id="backups-title">💾 Backups</h2>
          <p>
            Workouts, home page, blog, gallery lists and party prompts.{' '}
            {settings.lastAutoBackup ? `Last nightly backup ${new Date(settings.lastAutoBackup).toLocaleString()}.` : 'No nightly backup yet.'}
          </p>
        </div>
        <div className="adm-actions">
          <label className="btn btn-secondary" style={{ cursor: busy ? 'default' : 'pointer', opacity: busy ? 0.5 : 1 }}>
            ⬆ Upload
            <input type="file" accept=".zip" disabled={!!busy} style={{ display: 'none' }} onChange={(e) => { upload(e.target.files?.[0]); e.target.value = ''; }} />
          </label>
          <button className="btn btn-primary" disabled={!!busy} onClick={backUpNow}>{busy === 'create' ? 'Backing up…' : 'Back up now'}</button>
        </div>
      </div>

      {busy && <div style={{ marginBottom: '1rem' }}><ProgressBar label={BUSY_LABELS[busy] || 'Working…'} /></div>}

      {drive && (
        <div role="status" className={`adm-notice ${drive.ok ? 'is-success' : 'is-error'}`}>
          {drive.ok ? '✅' : '⚠️'} {drive.message}
          {drive.freeBytes !== undefined && drive.totalBytes ? ` · ${sizeLabel(drive.freeBytes)} free of ${sizeLabel(drive.totalBytes)}` : ''}
        </div>
      )}

      <details open={dirty || backups.length === 0} style={{ marginBottom: '1.25rem' }}>
        <summary style={{ cursor: 'pointer', fontWeight: 600, marginBottom: '0.75rem' }}>Settings</summary>
        <div className="adm-form">
          <label className="adm-field is-wide">
            Backup folder — on your backup USB, e.g. /mnt/backup/noahstuf
            <input value={draft.dir} onChange={(e) => setDraft({ ...draft, dir: e.target.value })} />
          </label>
          <label className="adm-field">
            Nightly at (hour, 0–23)
            <input type="number" min={0} max={23} value={draft.hour} onChange={(e) => setDraft({ ...draft, hour: Number(e.target.value) })} />
          </label>
          <label className="adm-field">
            Keep this many
            <input type="number" min={1} max={365} value={draft.keep} onChange={(e) => setDraft({ ...draft, keep: Number(e.target.value) })} />
          </label>
          <label className="adm-check">
            <input type="checkbox" checked={draft.enabled} onChange={(e) => setDraft({ ...draft, enabled: e.target.checked })} /> Nightly backups on
          </label>
          <label className="adm-check">
            <input type="checkbox" checked={draft.includeMedia} onChange={(e) => setDraft({ ...draft, includeMedia: e.target.checked })} /> Include photos &amp; PDFs (up to 500 MB)
          </label>
          <label className="adm-check is-wide">
            <input type="checkbox" checked={draft.requireSeparateDrive} onChange={(e) => setDraft({ ...draft, requireSeparateDrive: e.target.checked })} />
            Only back up when this folder is on a different drive than the site (recommended for a backup USB)
          </label>
        </div>
        {dirty && (
          <div className="adm-actions" style={{ marginTop: '0.9rem' }}>
            <button className="btn btn-primary" disabled={!!busy} onClick={saveSettings}>Save settings</button>
            <button className="btn btn-secondary" disabled={!!busy} onClick={() => setDraft(settings)}>Undo</button>
          </div>
        )}
      </details>

      <h3 className="adm-h3">Saved backups ({backups.length})</h3>
      {backups.length === 0 ? <p className="adm-muted">No backups in this folder yet.</p> : (
        <div className="adm-list">
          {backups.map((b) => (
            <div key={b.name} className="adm-row">
              <div className="adm-row-main">
                <strong style={{ fontSize: '0.92rem' }}>{new Date(b.createdAt).toLocaleString()}</strong>
                <div className="adm-row-sub">{b.label} · {sizeLabel(b.size)}</div>
              </div>
              <div className="adm-actions">
                <a className="btn btn-secondary adm-small-btn" href={`/api/backups?download=${encodeURIComponent(b.name)}`}>Download</a>
                <button className="btn btn-secondary adm-small-btn" disabled={!!busy} onClick={() => restore(b)}>Restore</button>
                <button className="adm-icon-btn is-danger" disabled={!!busy} onClick={() => remove(b)} aria-label={`Delete ${b.name}`} title="Delete">✕</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
