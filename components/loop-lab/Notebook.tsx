'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { describeController } from '@/lib/loop-lab/controllers';
import { getProcess } from '@/lib/loop-lab/processes';
import { NOTEBOOK_LIMIT, cleanNotebook, serializeEntry, type Experiment, type NotebookEntry } from '@/lib/loop-lab/setup';
import { fmt } from './Chart';
import { dur } from './Results';

/** `account`: saved to the signed-in account. `device`: signed out, kept in this browser. */
export type NotebookMode = 'loading' | 'account' | 'device' | 'error';

const DEVICE_KEY = 'loop-lab:notebook';

function readDevice() {
  try { return cleanNotebook(JSON.parse(localStorage.getItem(DEVICE_KEY) || '[]')); } catch { return []; }
}
function writeDevice(list: NotebookEntry[]) {
  try { localStorage.setItem(DEVICE_KEY, JSON.stringify(list.map(serializeEntry))); } catch { /* storage full or blocked */ }
}

export function newEntryId() {
  try { return crypto.randomUUID().slice(0, 13); } catch { return Math.random().toString(36).slice(2, 12); }
}

export function useNotebook() {
  const [mode, setMode] = useState<NotebookMode>('loading');
  const [entries, setEntries] = useState<NotebookEntry[]>([]);
  const [error, setError] = useState('');
  const modeRef = useRef<NotebookMode>('loading');

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch('/api/loop-lab/notebook', { cache: 'no-store' });
        if (!alive) return;
        if (res.status === 401) {
          modeRef.current = 'device';
          setMode('device');
          setEntries(readDevice());
          return;
        }
        const body = await res.json();
        if (!body.success) throw new Error(body.message);
        modeRef.current = 'account';
        setMode('account');
        setEntries(cleanNotebook(body.entries));
      } catch {
        if (alive) { setMode('error'); setEntries(readDevice()); }
      }
    })();
    return () => { alive = false; };
  }, []);

  const change = useCallback(async (action: Record<string, unknown>, local: (list: NotebookEntry[]) => NotebookEntry[]) => {
    setError('');
    if (modeRef.current !== 'account') {
      setEntries((list) => {
        const next = local(list).slice(0, NOTEBOOK_LIMIT);
        writeDevice(next);
        return next;
      });
      return;
    }
    setEntries(local);
    try {
      const res = await fetch('/api/loop-lab/notebook', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(action) });
      const body = await res.json();
      if (!body.success) throw new Error(body.message || 'Save failed');
      setEntries(cleanNotebook(body.entries));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed');
    }
  }, []);

  return {
    mode, entries, error,
    add: (entry: NotebookEntry) => change({ action: 'add', entry: serializeEntry(entry) }, (l) => [entry, ...l.filter((e) => e.id !== entry.id)]),
    update: (id: string, patch: { name?: string; note?: string }) => change({ action: 'update', id, ...patch }, (l) => l.map((e) => (e.id === id ? { ...e, ...patch } : e))),
    remove: (id: string) => change({ action: 'delete', id }, (l) => l.filter((e) => e.id !== id)),
  };
}

export function NotebookPanel({ notebook, onLoad, onCompare }: {
  notebook: ReturnType<typeof useNotebook>;
  onLoad: (e: Experiment) => void;
  onCompare: (entry: NotebookEntry) => void;
}) {
  const { mode, entries, error } = notebook;
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState({ name: '', note: '' });
  return (
    <div>
      <p className="ll-small" style={{ marginTop: 0 }}>
        {mode === 'account' && 'Saved to your account.'}
        {mode === 'device' && <>Saved in this browser. <button className="ll-link" onClick={() => window.dispatchEvent(new Event('site:sign-in'))}>Sign in</button> to keep your notebook in your account.</>}
        {mode === 'error' && 'Couldn’t reach the server; showing what this browser has.'}
        {mode === 'loading' && 'Loading…'}
      </p>
      {error && <p className="ll-small" style={{ color: 'var(--danger)' }}>{error}</p>}
      {!entries.length && mode !== 'loading' && <div className="ll-empty">Nothing saved yet. Run the tests, then “Save to notebook” keeps the setup and its scorecard.</div>}
      {entries.map((e) => {
        const proc = getProcess(e.experiment.process);
        const s = e.summary;
        return (
          <div key={e.id} className="ll-card" style={{ padding: '0.75rem' }}>
            {editing === e.id ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                <input type="text" value={draft.name} onChange={(ev) => setDraft({ ...draft, name: ev.target.value })} aria-label="Name" />
                <textarea rows={3} value={draft.note} onChange={(ev) => setDraft({ ...draft, note: ev.target.value })} aria-label="Note" placeholder="What did you learn?" />
                <div style={{ display: 'flex', gap: '0.4rem' }}>
                  <button className="ll-btn is-small is-primary" onClick={() => { notebook.update(e.id, draft); setEditing(null); }}>Save</button>
                  <button className="ll-btn is-small" onClick={() => setEditing(null)}>Cancel</button>
                </div>
              </div>
            ) : (
              <>
                <div className="ll-card-head" style={{ marginBottom: '0.3rem' }}>
                  <strong>{e.name}</strong>
                  <span className="ll-small">{proc.icon} {proc.name} · {new Date(e.createdAt).toLocaleDateString()}</span>
                </div>
                <div className="ll-small">{describeController(proc, e.experiment.controller)}</div>
                {s && (
                  <div className="ll-small" style={{ marginTop: '0.25rem', fontVariantNumeric: 'tabular-nums' }}>
                    IAE {fmt(s.iae, 3)} · overshoot {fmt(s.worstOvershoot, 2)} % · recovery {dur(s.worstRecovery)} · travel {fmt(s.travel, 3)}/h · Ms {fmt(s.worstMs, 3)}
                  </div>
                )}
                {e.note && <p style={{ margin: '0.4rem 0 0', fontSize: '0.88rem', whiteSpace: 'pre-wrap' }}>{e.note}</p>}
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem', marginTop: '0.5rem' }}>
                  <button className="ll-btn is-small is-primary" onClick={() => onLoad(e.experiment)}>Load</button>
                  <button className="ll-btn is-small" onClick={() => onCompare(e)}>Compare</button>
                  <button className="ll-btn is-small" onClick={() => { setDraft({ name: e.name, note: e.note }); setEditing(e.id); }}>Edit</button>
                  <button className="ll-btn is-small" onClick={() => { if (confirm(`Delete “${e.name}”?`)) notebook.remove(e.id); }}>Delete</button>
                </div>
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}
