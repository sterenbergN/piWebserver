'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { useSitePopup } from '@/components/SitePopup';
import SignInPrompt from '@/components/journal/SignInPrompt';
import type { MapResponse } from '@/components/study/MapTypes';
import { BLUEPRINT, suggestSystem, type ClassEntry } from '@/lib/study/coverage';
import type { PanceSystem } from '@/lib/study/study';

// Her classes: which are finished and what they cover. This is the map's first
// and quickest level, and the way to tell it what happened in the first 5 months.

type Draft = { id?: string; name: string; done: boolean; score: string; systems: PanceSystem[] };
const blank = (name = ''): Draft => {
  const guess = suggestSystem(name);
  return { name, done: true, score: '', systems: guess ? [guess] : [] };
};
const toDraft = (c: ClassEntry): Draft => ({ id: c.id, name: c.name, done: c.done, score: c.score === undefined ? '' : String(c.score), systems: c.systems });
const labelOf = (system: PanceSystem) => BLUEPRINT.find((b) => b.system === system)?.label ?? system;

async function post(action: string, payload: Record<string, unknown> = {}) {
  const res = await fetch('/api/study/map', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, ...payload }) });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.success) throw new Error(body.message || 'That didn’t save. Try again.');
}

function ClassForm({ draft, onChange, onSave, onCancel, busy, error }: { draft: Draft; onChange: (draft: Draft) => void; onSave: () => void; onCancel: () => void; busy: boolean; error: string }) {
  const toggle = (system: PanceSystem) => onChange({ ...draft, systems: draft.systems.includes(system) ? draft.systems.filter((s) => s !== system) : [...draft.systems, system] });
  return (
    <form className="sd-card sd-class-form" onSubmit={(e) => { e.preventDefault(); onSave(); }}>
      <h2>{draft.id ? 'Edit class' : 'Add a class'}</h2>
      <div className="sd-fields">
        <label className="sd-wide">Name
          <input value={draft.name} maxLength={80} autoFocus placeholder="Clinical Medicine I" onChange={(e) => {
            const name = e.target.value;
            // Until she picks for herself, keep suggesting from the name.
            const guess = suggestSystem(name);
            onChange({ ...draft, name, systems: draft.systems.length > 1 || (draft.systems.length === 1 && draft.systems[0] !== suggestSystem(draft.name)) ? draft.systems : guess ? [guess] : [] });
          }} />
        </label>
        <label>Exam average, % (optional)
          <input inputMode="numeric" value={draft.score} maxLength={3} placeholder="88" onChange={(e) => onChange({ ...draft, score: e.target.value.replace(/\D/g, '') })} />
        </label>
        <label className="sd-check sd-class-done">
          <input type="checkbox" checked={draft.done} onChange={(e) => onChange({ ...draft, done: e.target.checked })} />
          <span>Finished</span>
        </label>
      </div>
      <fieldset className="sd-systems">
        <legend>What it covers</legend>
        {BLUEPRINT.map((b) => (
          <button key={b.system} type="button" aria-pressed={draft.systems.includes(b.system)} onClick={() => toggle(b.system)}>{b.label}</button>
        ))}
      </fieldset>
      {!draft.systems.length && <p className="hb-hint">A class with no systems picked, like Pharmacology or Professional Practice, stays on your list but doesn’t change the map.</p>}
      {error && <p className="sd-warning" role="alert">{error}</p>}
      <div className="sd-actions">
        <button type="submit" className="btn btn-primary" disabled={busy || !draft.name.trim()}>Save class</button>
        <button type="button" className="hb-text-btn" disabled={busy} onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}

export default function ClassesPage() {
  const { confirm, popup } = useSitePopup();
  const [state, setState] = useState<'loading' | 'ready' | 'signed-out' | 'error'>('loading');
  const [data, setData] = useState<MapResponse | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    const res = await fetch('/api/study/map', { cache: 'no-store' });
    if (res.status === 401) { setState('signed-out'); return; }
    const body = await res.json().catch(() => ({}));
    if (!res.ok || !body.success) { setState('error'); return; }
    setData(body);
    setState('ready');
  }, []);
  useEffect(() => { load().catch(() => setState('error')); }, [load]);

  if (state === 'signed-out') return <div className="sd"><SignInPrompt title="Sign in to add your classes">Your classes are only shown to your account.</SignInPrompt></div>;

  const save = async () => {
    if (!draft) return;
    setBusy(true);
    setError('');
    try {
      await post('save-class', { ...draft });
      setDraft(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That didn’t save. Try again.');
    } finally {
      setBusy(false);
    }
  };

  const toggleDone = async (entry: ClassEntry) => {
    setError('');
    try {
      await post('save-class', { ...entry, done: !entry.done });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That didn’t save. Try again.');
    }
  };

  const remove = async (entry: ClassEntry) => {
    const ok = await confirm({ title: 'Remove this class?', message: `“${entry.name}” leaves your list and the map. Your tests aren’t touched.`, confirmLabel: 'Remove', danger: true });
    if (!ok) return;
    await post('delete-class', { id: entry.id }).catch(() => {});
    await load();
  };

  return (
    <div className="sd sd-narrow animate-fade-in">
      {popup}
      <header className="sd-head">
        <div>
          <Link className="sd-back" href="/study/map">← PANCE map</Link>
          <h1>Classes</h1>
          <p>Tick off what you’ve finished, and the map marks those systems as covered.</p>
        </div>
        {!draft && <button type="button" className="btn btn-primary" onClick={() => { setError(''); setDraft(blank()); }}>Add a class</button>}
      </header>

      {state === 'loading' && <p className="hb-hint">Loading…</p>}
      {state === 'error' && <div className="hb-banner is-error"><span>Couldn’t load your classes.</span><button type="button" className="hb-small-btn" onClick={() => window.location.reload()}>Try again</button></div>}
      {error && !draft && <div className="hb-banner is-error" role="alert"><span>{error}</span></div>}

      {draft && <ClassForm draft={draft} onChange={setDraft} onSave={save} onCancel={() => { setDraft(null); setError(''); }} busy={busy} error={error} />}

      {data && !draft && data.courses.length > 0 && (
        <section className="sd-card">
          <h2>From your tests</h2>
          <div className="sd-actions">
            {data.courses.map((name) => <button key={name} type="button" className="hb-small-btn" onClick={() => { setError(''); setDraft(blank(name)); }}>+ {name}</button>)}
          </div>
        </section>
      )}

      {data && data.classes.length === 0 && !draft && (
        <section className="sd-card sd-done">
          <h2>No classes yet</h2>
          <p className="hb-hint">Add the ones from your first 5 months. It only takes a minute, and they’re the quickest way to fill in the map.</p>
        </section>
      )}

      {data && data.classes.length > 0 && (
        <section className="sd-card">
          <ul className="sd-class-list">
            {data.classes.map((entry) => (
              <li key={entry.id}>
                <label className="sd-check" title={entry.done ? 'Finished' : 'Not finished yet'}>
                  <input type="checkbox" checked={entry.done} aria-label={`${entry.name} finished`} onChange={() => toggleDone(entry)} />
                </label>
                <span className="sd-test-main">
                  <strong>{entry.name}</strong>
                  <small>{[entry.score !== undefined ? `Exam average ${entry.score}%` : '', entry.systems.length ? entry.systems.map(labelOf).join(', ') : 'No systems picked'].filter(Boolean).join(' · ')}</small>
                </span>
                <span className="sd-actions">
                  <button type="button" className="hb-small-btn" onClick={() => { setError(''); setDraft(toDraft(entry)); window.scrollTo({ top: 0 }); }}>Edit</button>
                  <button type="button" className="hb-text-btn sd-danger-link" onClick={() => remove(entry)}>Remove</button>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
