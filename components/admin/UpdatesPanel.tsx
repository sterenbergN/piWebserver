'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import ProgressBar from './ProgressBar';

type Status = {
  current: { id: string; sha?: string; builtAt?: string } | null;
  managed: boolean;
  latest: { tag: string | null; publishedAt?: string; notes?: string };
  log: string;
};

/** Where an install is: the site goes down while pm2 restarts, then answers with the new build. */
type Phase = 'idle' | 'starting' | 'installing' | 'restarting' | 'done' | 'slow' | 'failed';
const STEPS: { phase: Phase; label: string }[] = [
  { phase: 'starting', label: 'Start' },
  { phase: 'installing', label: 'Download & check' },
  { phase: 'restarting', label: 'Restart' },
  { phase: 'done', label: 'Live' },
];
const TIMEOUT_MS = 4 * 60_000;

const ago = (date: Date) => {
  const s = Math.round((Date.now() - date.getTime()) / 1000);
  return s < 10 ? 'just now' : s < 60 ? `${s}s ago` : s < 3600 ? `${Math.round(s / 60)} min ago` : date.toLocaleTimeString();
};

/** Admin panel: running build, newest GitHub build, and a one-tap update with progress. */
export default function UpdatesPanel({ onStatus }: { onStatus?: (updateAvailable: boolean) => void }) {
  const [status, setStatus] = useState<Status | null>(null);
  const [checking, setChecking] = useState(true);
  const [checkError, setCheckError] = useState('');
  const [checkedAt, setCheckedAt] = useState<Date | null>(null);
  const [phase, setPhase] = useState<Phase>('idle');
  const [message, setMessage] = useState('');
  const [elapsed, setElapsed] = useState(0);
  const [, tick] = useState(0);
  const cancelled = useRef(false);

  const load = useCallback(async (refresh = false) => {
    setChecking(true);
    setCheckError('');
    try {
      const d = await fetch(`/api/admin/update${refresh ? '?refresh=1' : ''}`, { cache: 'no-store' }).then((r) => r.json());
      if (!d.success) throw new Error('Not signed in');
      setStatus(d);
      setCheckedAt(new Date());
      onStatus?.(!!d.current?.id && !!d.latest.tag && d.latest.tag !== d.current.id);
    } catch (err) {
      setCheckError(err instanceof Error && err.message === 'Not signed in' ? 'Your admin session has expired — sign in again.' : 'Could not check for updates. Is the site online?');
    } finally {
      setChecking(false);
    }
  }, [onStatus]);

  useEffect(() => {
    cancelled.current = false;
    load();
    return () => { cancelled.current = true; };
  }, [load]);
  // Keep "checked 2 min ago" fresh.
  useEffect(() => { const t = setInterval(() => tick((n) => n + 1), 15_000); return () => clearInterval(t); }, []);

  const update = async () => {
    const target = status?.latest.tag;
    if (!target) return;
    setPhase('starting');
    setMessage('');
    setElapsed(0);
    const res = await fetch('/api/admin/update', { method: 'POST' }).catch(() => null);
    const d = await res?.json().catch(() => ({})) ?? {};
    if (!d.success) { setPhase('failed'); setMessage(d.error || 'Could not start the update.'); return; }

    setPhase('installing');
    const started = Date.now();
    let wentDown = false;
    const poll = async () => {
      if (cancelled.current) return;
      setElapsed(Date.now() - started);
      const health = await fetch('/api/health', { cache: 'no-store' }).then((r) => r.json()).catch(() => null);
      if (health?.build === target) {
        setPhase('done');
        setMessage(`Updated to ${target}. Reloading…`);
        setTimeout(() => window.location.reload(), 1500);
        return;
      }
      // No answer means pm2 is restarting the site onto the new build.
      if (!health && !wentDown) { wentDown = true; setPhase('restarting'); }
      if (Date.now() - started > TIMEOUT_MS) {
        setPhase('slow');
        setMessage(health ? 'The site is still on the old build — the update may have been rolled back. Check the log below.' : 'The site hasn’t come back yet. Check the log below, or run ./deploy.sh --status on the Pi.');
        load();
        return;
      }
      setTimeout(poll, 2500);
    };
    setTimeout(poll, 3000);
  };

  const current = status?.current?.id || 'dev';
  const upToDate = !!status?.latest.tag && status.latest.tag === current;
  const busy = phase === 'starting' || phase === 'installing' || phase === 'restarting' || phase === 'done';
  const stepIndex = STEPS.findIndex((s) => s.phase === phase);
  // A rough guide: most updates take 30–90 s, so ease the bar towards 90 % until the build answers.
  const estimated = phase === 'done' ? 100 : Math.min(90, 8 + (elapsed / 90_000) * 82);

  return (
    <section className="adm-card" aria-labelledby="updates-title">
      <div className="adm-card-head">
        <div>
          <h2 id="updates-title">🚀 Updates</h2>
          <p>New builds are made on GitHub every time code is pushed. Installing takes about a minute; the site restarts once.</p>
        </div>
        <div className="adm-actions">
          <button className="btn btn-secondary" onClick={() => load(true)} disabled={checking || busy}>
            {checking ? 'Checking…' : 'Check for updates'}
          </button>
          {status?.managed && status.latest.tag && !upToDate && (
            <button className="btn btn-primary" onClick={update} disabled={busy || checking}>
              {busy ? 'Updating…' : `Install ${status.latest.tag}`}
            </button>
          )}
        </div>
      </div>

      {checking && (
        <div style={{ marginBottom: '1rem' }}>
          <ProgressBar label="Checking GitHub for the newest build…" />
        </div>
      )}
      {checkError && !checking && <div className="adm-notice is-error">{checkError}</div>}

      {/* Install progress sits at the top so it's on screen right after tapping Install. */}
      {phase !== 'idle' && (
        <div className={`adm-notice ${phase === 'failed' || phase === 'slow' ? 'is-error' : phase === 'done' ? 'is-success' : 'is-info'}`} aria-live="polite">
          {busy && (
            <ProgressBar
              value={estimated}
              label={phase === 'starting' ? 'Starting the update…' : phase === 'installing' ? 'Downloading and checking the new build…' : phase === 'restarting' ? 'Restarting the site on the new build…' : 'Done!'}
              detail={phase === 'done' ? '' : `${Math.round(elapsed / 1000)}s`}
            />
          )}
          {busy && (
            <div className="adm-steps">
              {STEPS.map((s, i) => (
                <div key={s.phase} className={`adm-step${i < stepIndex ? ' is-done' : i === stepIndex ? (phase === 'done' ? ' is-done' : ' is-active') : ''}`}>{s.label}</div>
              ))}
            </div>
          )}
          {message && <div style={{ marginTop: busy ? '0.6rem' : 0 }}>{message}</div>}
        </div>
      )}

      {status && (
        <div className="adm-stats" style={{ marginBottom: '1rem' }}>
          <div className="adm-stat">
            <div className="adm-stat-label">Running</div>
            <div className="adm-stat-value is-small">{current}</div>
            {status.current?.builtAt && <div className="adm-stat-sub">built {new Date(status.current.builtAt).toLocaleString()}</div>}
          </div>
          <div className="adm-stat">
            <div className="adm-stat-label">Newest on GitHub</div>
            <div className="adm-stat-value is-small">{status.latest.tag || '—'}</div>
            <div className="adm-stat-sub">
              {status.latest.publishedAt ? `published ${new Date(status.latest.publishedAt).toLocaleString()}` : 'couldn’t reach GitHub'}
            </div>
          </div>
          <div className="adm-stat">
            <div className="adm-stat-label">Status</div>
            <div style={{ marginTop: '0.35rem' }}>
              {!status.current ? <span className="adm-badge is-warn">Development build</span>
                : !status.latest.tag ? <span className="adm-badge is-warn">Unknown</span>
                : upToDate ? <span className="adm-badge is-good">✓ Up to date</span>
                : <span className="adm-badge is-new">Update available</span>}
            </div>
            {checkedAt && <div className="adm-stat-sub" style={{ marginTop: '0.35rem' }}>checked {ago(checkedAt)}</div>}
          </div>
        </div>
      )}

      {status && !status.managed && (
        <p className="adm-muted" style={{ margin: 0 }}>
          One-tap updates work once the site runs from a release folder set up by <code>scripts/deploy.sh</code> (see the README).
        </p>
      )}
      {status?.latest.notes && !upToDate && (
        <details open style={{ marginTop: '0.75rem' }}>
          <summary style={{ cursor: 'pointer' }} className="adm-muted">What’s new in {status.latest.tag}</summary>
          <pre className="adm-log">{status.latest.notes}</pre>
        </details>
      )}
      {status?.log && (
        <details style={{ marginTop: '0.75rem' }} open={phase === 'slow' || phase === 'failed'}>
          <summary style={{ cursor: 'pointer' }} className="adm-muted">Last deploy log</summary>
          <pre className="adm-log">{status.log}</pre>
        </details>
      )}
    </section>
  );
}
