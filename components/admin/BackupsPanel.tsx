'use client';

import { useEffect, useState } from 'react';
import { useSitePopup } from '@/components/SitePopup';

type Settings = { enabled: boolean; dir: string; keep: number; hour: number; includeMedia: boolean; lastAutoBackup?: string };
type Backup = { name: string; size: number; createdAt: string; label: string };

const sizeLabel = (bytes: number) =>
  bytes > 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;

/** Admin panel: nightly backup settings, backup list, download, upload and restore. */
export default function BackupsPanel() {
  const { confirm, showAlert, popup } = useSitePopup();
  const [settings, setSettings] = useState<Settings | null>(null);
  const [draft, setDraft] = useState<Settings | null>(null);
  const [backups, setBackups] = useState<Backup[]>([]);
  const [busy, setBusy] = useState('');

  const load = () => fetch('/api/backups').then((r) => r.json()).then((d) => {
    if (d.success) { setSettings(d.settings); setDraft(d.settings); setBackups(d.backups); }
  }).catch(() => {});
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
    setSettings(d.settings); setDraft(d.settings); setBackups(d.backups);
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

  if (!settings || !draft) return null;
  const dirty = JSON.stringify(settings) !== JSON.stringify(draft);
  const field: React.CSSProperties = { padding: '0.5rem 0.7rem', borderRadius: 8, border: '1px solid var(--surface-border)', background: 'var(--input-bg)', color: 'var(--foreground)', font: 'inherit' };

  return (
    <div style={{ background: 'var(--surface-glass)', borderRadius: '16px', border: '1px solid var(--surface-border)', padding: '2rem', marginBottom: '2rem' }}>
      {popup}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem', marginBottom: '1rem' }}>
        <div>
          <h2 style={{ margin: 0 }}>💾 Backups</h2>
          <p style={{ margin: '0.25rem 0 0', color: 'var(--muted)', fontSize: '0.9rem' }}>
            Workouts, home page, blog, gallery lists and party prompts.{' '}
            {settings.lastAutoBackup ? `Last nightly backup ${new Date(settings.lastAutoBackup).toLocaleString()}.` : 'No nightly backup yet.'}
          </p>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <label className="btn btn-secondary" style={{ cursor: 'pointer' }}>
            ⬆ Upload
            <input type="file" accept=".zip" style={{ display: 'none' }} onChange={(e) => upload(e.target.files?.[0])} />
          </label>
          <button className="btn btn-primary" disabled={!!busy} onClick={backUpNow}>{busy === 'create' ? 'Backing up…' : 'Back up now'}</button>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '0.75rem', alignItems: 'end', marginBottom: '1rem' }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem', gridColumn: '1 / -1', fontSize: '0.8rem', color: 'var(--muted)' }}>
          Backup folder (use a USB drive path like /media/pi/USB/backups)
          <input style={field} value={draft.dir} onChange={(e) => setDraft({ ...draft, dir: e.target.value })} />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem', fontSize: '0.8rem', color: 'var(--muted)' }}>
          Nightly at (hour, 0–23)
          <input style={field} type="number" min={0} max={23} value={draft.hour} onChange={(e) => setDraft({ ...draft, hour: Number(e.target.value) })} />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem', fontSize: '0.8rem', color: 'var(--muted)' }}>
          Keep this many
          <input style={field} type="number" min={1} max={365} value={draft.keep} onChange={(e) => setDraft({ ...draft, keep: Number(e.target.value) })} />
        </label>
        <label style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', fontSize: '0.9rem' }}>
          <input type="checkbox" checked={draft.enabled} onChange={(e) => setDraft({ ...draft, enabled: e.target.checked })} /> Nightly backups on
        </label>
        <label style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', fontSize: '0.9rem' }}>
          <input type="checkbox" checked={draft.includeMedia} onChange={(e) => setDraft({ ...draft, includeMedia: e.target.checked })} /> Include photos &amp; PDFs (large)
        </label>
      </div>
      {dirty && <button className="btn btn-primary" disabled={!!busy} onClick={saveSettings} style={{ marginBottom: '1rem' }}>Save backup settings</button>}

      {backups.length === 0 ? <p style={{ color: 'var(--muted)' }}>No backups in this folder yet.</p> : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
          {backups.map((b) => (
            <div key={b.name} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap', padding: '0.6rem 0.9rem', borderRadius: 10, border: '1px solid var(--surface-border)' }}>
              <div>
                <strong style={{ fontSize: '0.9rem' }}>{new Date(b.createdAt).toLocaleString()}</strong>
                <span style={{ color: 'var(--muted)', fontSize: '0.8rem' }}> · {b.label} · {sizeLabel(b.size)}</span>
              </div>
              <div style={{ display: 'flex', gap: '0.4rem' }}>
                <a className="btn btn-secondary" style={{ padding: '0.3rem 0.7rem', fontSize: '0.8rem' }} href={`/api/backups?download=${encodeURIComponent(b.name)}`}>Download</a>
                <button className="btn btn-secondary" style={{ padding: '0.3rem 0.7rem', fontSize: '0.8rem' }} disabled={!!busy} onClick={() => restore(b)}>Restore</button>
                <button className="btn btn-secondary" style={{ padding: '0.3rem 0.7rem', fontSize: '0.8rem', color: 'var(--danger)' }} disabled={!!busy} onClick={() => remove(b)} aria-label={`Delete ${b.name}`}>✕</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
