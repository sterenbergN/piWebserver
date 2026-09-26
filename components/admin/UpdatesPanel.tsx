'use client';

import { useEffect, useState } from 'react';

type Status = {
  current: { id: string; sha?: string; builtAt?: string } | null;
  managed: boolean;
  latest: { tag: string | null; publishedAt?: string; notes?: string };
  log: string;
};

/** Admin panel: running build, newest GitHub build, and a one-tap update. */
export default function UpdatesPanel() {
  const [status, setStatus] = useState<Status | null>(null);
  const [updating, setUpdating] = useState(false);
  const [message, setMessage] = useState('');

  const load = (refresh = false) =>
    fetch(`/api/admin/update${refresh ? '?refresh=1' : ''}`).then((r) => r.json()).then((d) => { if (d.success) setStatus(d); }).catch(() => {});
  useEffect(() => { load(); }, []);

  const update = async () => {
    setUpdating(true);
    setMessage('Downloading and checking the new build…');
    const res = await fetch('/api/admin/update', { method: 'POST' });
    const d = await res.json().catch(() => ({}));
    if (!d.success) { setMessage(d.error || 'Could not start the update'); setUpdating(false); return; }
    // The site restarts during the update; wait for the new build to answer.
    const target = status?.latest.tag;
    const started = Date.now();
    const poll = async () => {
      const health = await fetch('/api/health', { cache: 'no-store' }).then((r) => r.json()).catch(() => null);
      if (health?.build && health.build === target) {
        setMessage(`✅ Updated to ${target}. Reloading…`);
        setTimeout(() => window.location.reload(), 1500);
        return;
      }
      if (Date.now() - started > 4 * 60_000) {
        setMessage('The update is taking a while — check the log below.');
        setUpdating(false);
        load();
        return;
      }
      setTimeout(poll, 3000);
    };
    setTimeout(poll, 5000);
  };

  if (!status) return null;
  const current = status.current?.id || 'dev';
  const upToDate = !!status.latest.tag && status.latest.tag === current;

  return (
    <div style={{ background: 'var(--surface-glass)', borderRadius: '16px', border: '1px solid var(--surface-border)', padding: '2rem', marginBottom: '2rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <h2 style={{ margin: 0 }}>🚀 Updates</h2>
          <p style={{ margin: '0.25rem 0 0', color: 'var(--muted)', fontSize: '0.9rem' }}>
            Running <strong style={{ color: 'var(--foreground)' }}>{current}</strong>
            {status.current?.builtAt && <> · built {new Date(status.current.builtAt).toLocaleString()}</>}
            {' · '}
            {status.latest.tag ? (upToDate ? 'up to date' : <>newest is <strong style={{ color: 'var(--foreground)' }}>{status.latest.tag}</strong></>) : 'could not reach GitHub'}
          </p>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button className="btn btn-secondary" onClick={() => load(true)} disabled={updating}>Check</button>
          {status.managed && status.latest.tag && !upToDate && (
            <button className="btn btn-primary" onClick={update} disabled={updating}>{updating ? 'Updating…' : `Install ${status.latest.tag}`}</button>
          )}
        </div>
      </div>
      {!status.managed && (
        <p style={{ color: 'var(--muted)', fontSize: '0.85rem', marginBottom: 0 }}>
          One-tap updates work once the site runs from a release folder set up by <code>scripts/deploy.sh</code> (see the README).
        </p>
      )}
      {message && <p style={{ marginBottom: 0 }}>{message}</p>}
      {status.latest.notes && !upToDate && <pre style={{ whiteSpace: 'pre-wrap', fontSize: '0.8rem', color: 'var(--muted)', margin: '0.75rem 0 0' }}>{status.latest.notes}</pre>}
      {status.log && (
        <details style={{ marginTop: '0.75rem' }}>
          <summary style={{ cursor: 'pointer', color: 'var(--muted)', fontSize: '0.85rem' }}>Last deploy log</summary>
          <pre style={{ whiteSpace: 'pre-wrap', fontSize: '0.75rem', maxHeight: 240, overflow: 'auto' }}>{status.log}</pre>
        </details>
      )}
    </div>
  );
}
