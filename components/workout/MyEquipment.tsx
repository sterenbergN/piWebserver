'use client';

import { useEffect, useMemo, useState } from 'react';
import type { Gym, Station } from '@/lib/workout/types';
import { copyStation } from '@/lib/workout/equipment-library';
import { kindKey, liftLinkSuggestions, machineKindLibrary, suggestKindMatches, type KindCopy, type KindMatch, type LiftLinkSuggestion, type MachineKind } from '@/lib/workout/equipment-kinds';
import { STATION_TYPE_META } from '@/lib/workout/station-summary';
import Sheet from './Sheet';

// "My equipment" on the Gyms & Lifts page: each machine once, with every
// gym's copy of it. Link the same machine at two gyms, rename it everywhere,
// unlink a copy or add it to another gym. Each gym keeps its own weights.

async function requestJson(url: string, init?: RequestInit) {
  const res = await fetch(url, { headers: { 'Content-Type': 'application/json' }, ...init });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.success) throw new Error(data.message || `Request failed (${res.status})`);
  return data;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
const typesOf = (kind: MachineKind) => [...new Set(kind.copies.map((c) => c.stationType))];
const typeLabel = (kind: MachineKind) => typesOf(kind).map((t) => `${STATION_TYPE_META[t].icon} ${STATION_TYPE_META[t].label}`).join(' / ');
const copyLabel = (kind: MachineKind, copy: KindCopy) => `${copy.gymName}${copy.stationName !== kind.name ? ` · as “${copy.stationName}”` : ''}`;

type Props = {
  /** Your own gyms. */
  gyms: Gym[];
  /** Gyms changed on the server (replace them in the page's list). */
  onGymsUpdated: (gyms: Gym[]) => void;
};

export default function MyEquipment({ gyms, onGymsUpdated }: Props) {
  const [dismissed, setDismissed] = useState<string[]>([]);
  const [openKey, setOpenKey] = useState<string | null>(null);
  // The two machines being linked, as they were when the sheet opened (they become one once linked).
  const [linking, setLinking] = useState<[MachineKind, MachineKind] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    fetch('/api/workout/equipment').then((r) => r.json()).then((d) => { if (d.success) setDismissed(d.dismissed || []); }).catch(() => {});
  }, []);

  const kinds = useMemo(() => machineKindLibrary(gyms), [gyms]);
  const matches = useMemo(() => suggestKindMatches(kinds, dismissed), [kinds, dismissed]);
  const openKind = kinds.find((k) => k.key === openKey);

  /** Run a request; surfaces failures in the open sheet. Resolves the response, or null. */
  const run = async (action: () => Promise<any>) => {
    setBusy(true);
    setError('');
    try {
      const data = await action();
      if (Array.isArray(data?.gyms)) onGymsUpdated(data.gyms);
      if (Array.isArray(data?.dismissed)) setDismissed(data.dismissed);
      return data ?? {};
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.');
      return null;
    } finally {
      setBusy(false);
    }
  };
  const post = (body: Record<string, unknown>) => run(() => requestJson('/api/workout/equipment', { method: 'POST', body: JSON.stringify(body) }));

  const dismiss = (match: KindMatch) => post({ action: 'dismiss', a: match.a.key, b: match.b.key });
  const openLink = (a: string, b: string) => {
    const pair = [a, b].map((key) => kinds.find((k) => k.key === key));
    if (!pair[0] || !pair[1]) return;
    setError('');
    setOpenKey(null);
    setLinking(pair as [MachineKind, MachineKind]);
  };

  /** Copy the copy with the most lifts into another gym, still linked. */
  const addToGym = (kind: MachineKind, gymId: string) => run(async () => {
    const target = gyms.find((g) => g.id === gymId);
    const best = [...kind.copies].sort((a, b) => b.liftCount - a.liftCount)[0];
    const source = gyms.find((g) => g.id === best?.gymId)?.stations.find((s) => s.id === best?.stationId);
    if (!target || !source) throw new Error('That machine is gone. Reload the page.');
    const data = await requestJson('/api/workout/gyms', { method: 'PUT', body: JSON.stringify({ ...target, stations: [...target.stations, copyStation(source)] }) });
    return { gyms: [data.gym] };
  });

  if (kinds.length === 0) return null;
  const linkedCount = kinds.filter((k) => new Set(k.copies.map((c) => c.gymId)).size > 1).length;

  return (
    <>
      {matches.length > 0 && (
        <div className="workout-tile" style={{ marginTop: '1.5rem', borderLeft: '3px solid var(--accent)' }}>
          <strong style={{ display: 'block', marginBottom: '0.35rem' }}>🔗 Possible matches</strong>
          <p className="workout-hint" style={{ margin: '0 0 0.5rem' }}>The same machine at two gyms? Link them to see them together. Each gym keeps its own weights.</p>
          {error && !openKind && !linking && <p className="workout-error">{error}</p>}
          <div className="workout-stack is-loose">
            {matches.slice(0, 5).map((match) => (
              <div key={match.pair} className="workout-lift-row" style={{ cursor: 'default', flexDirection: 'column', alignItems: 'stretch' }}>
                <span className="workout-card-text">
                  <span className="workout-card-title">{match.a.name} / {match.b.name}</span>
                  <span className="workout-card-meta">{match.a.copies.map((c) => c.gymName).join(', ')} · {match.b.copies.map((c) => c.gymName).join(', ')}</span>
                  <span className="workout-card-meta">
                    {match.sameName ? 'Similar names' : `Both used for ${match.sharedExercises.slice(0, 2).join(', ')}`}
                  </span>
                </span>
                <div className="workout-grid-2">
                  <button type="button" className="workout-button is-small is-primary" disabled={busy} onClick={() => openLink(match.a.key, match.b.key)}>Link</button>
                  <button type="button" className="workout-button is-small" disabled={busy} onClick={() => dismiss(match)}>Not the same</button>
                </div>
              </div>
            ))}
          </div>
          {matches.length > 5 && <p className="workout-hint" style={{ margin: '0.5rem 0 0' }}>{plural(matches.length - 5, 'more match')} after these.</p>}
        </div>
      )}

      <details className="workout-exercise-list">
        <summary className="workout-section-title">My equipment <span style={{ textTransform: 'none', letterSpacing: 0, fontWeight: 400 }}>{kinds.length}{linkedCount ? ` · ${linkedCount} at 2+ gyms` : ''} · tap to open</span></summary>
        <p className="workout-hint" style={{ margin: '0 0 0.6rem' }}>
          Each machine once, with every gym&apos;s copy. Linking the same machine at two gyms keeps each gym&apos;s weights but helps match up your lifts.
        </p>
        <div className="workout-stack">
          {kinds.map((kind) => (
            <button key={kind.key} type="button" className="workout-lift-row" onClick={() => { setError(''); setOpenKey(kind.key); }}>
              <span className="workout-card-text">
                <span className="workout-card-title">{kind.name}</span>
                <span className="workout-card-meta">{typeLabel(kind)}</span>
                <span className="workout-card-meta">{kind.copies.map((c) => copyLabel(kind, c)).join('; ')}</span>
              </span>
              <span className="workout-chevron" aria-hidden>›</span>
            </button>
          ))}
        </div>
      </details>

      {openKind && (
        <MachineKindSheet
          key={openKind.key}
          kind={openKind}
          kinds={kinds}
          gyms={gyms}
          busy={busy}
          error={error}
          onRename={async (to) => { if (await post({ action: 'rename', from: openKind.name, to })) setOpenKey(null); }}
          onUnlink={(copy) => post({ action: 'unlink', gymId: copy.gymId, stationId: copy.stationId })}
          onLink={(other) => openLink(openKind.key, other)}
          onAddToGym={(gymId) => addToGym(openKind, gymId)}
          onClose={() => setOpenKey(null)}
        />
      )}
      {linking && (
        <LinkKindsSheet
          kinds={linking}
          gyms={gyms}
          busy={busy}
          error={error}
          onLink={(keep, other) => post({ action: 'link', from: [other.name], to: keep.name })}
          onLinkLifts={(pairs) => run(async () => {
            let latest: Gym[] | null = null;
            for (const pair of pairs) {
              const data = await requestJson('/api/workout/exercises', { method: 'POST', body: JSON.stringify({ action: 'merge', from: [pair.keep, pair.other], to: pair.keep }) });
              if (Array.isArray(data.gyms)) latest = data.gyms;
            }
            return { gyms: latest };
          })}
          onClose={() => setLinking(null)}
        />
      )}
    </>
  );
}

type KindSheetProps = {
  kind: MachineKind;
  kinds: MachineKind[];
  gyms: Gym[];
  busy: boolean;
  error: string;
  onRename: (to: string) => void;
  onUnlink: (copy: KindCopy) => void;
  onLink: (otherKey: string) => void;
  onAddToGym: (gymId: string) => void;
  onClose: () => void;
};

/** One machine: each gym's copy, rename everywhere, unlink a copy, link another, add to a gym. */
function MachineKindSheet({ kind, kinds, gyms, busy, error, onRename, onUnlink, onLink, onAddToGym, onClose }: KindSheetProps) {
  const [name, setName] = useState(kind.name);
  const [other, setOther] = useState('');
  const [gymId, setGymId] = useState('');
  const renamed = name.trim() && name.trim() !== kind.name;
  const here = new Set(kind.copies.map((c) => c.gymId));
  const types = new Set(typesOf(kind));
  // Linkable: the same type of equipment, and not already in one of the same gyms.
  const linkable = kinds.filter((k) => k.key !== kind.key && k.copies.some((c) => types.has(c.stationType)) && !k.copies.some((c) => here.has(c.gymId)));
  const otherGyms = gyms.filter((g) => !here.has(g.id));
  const pickedGym = otherGyms.find((g) => g.id === gymId);

  return (
    <Sheet title={kind.name} subtitle={`${typeLabel(kind)} · ${plural(here.size, 'gym')}`} onClose={onClose}>
      {error && <p className="workout-error">{error}</p>}
      <div className="workout-section-title" style={{ marginTop: 0 }}>At your gyms</div>
      <div className="workout-stack" style={{ marginBottom: '1rem' }}>
        {kind.copies.map((copy) => (
          <div key={copy.stationId} className="workout-lift-row" style={{ cursor: 'default' }}>
            <span className="workout-card-text">
              <span className="workout-card-title">{copyLabel(kind, copy)}</span>
              <span className="workout-card-meta">{copy.weights}</span>
              <span className="workout-card-meta">{copy.exercises.length ? copy.exercises.join(', ') : 'No lifts yet'}</span>
            </span>
            {kind.copies.length > 1 && (
              <button type="button" className="workout-button is-small" style={{ flexShrink: 0 }} disabled={busy} onClick={() => onUnlink(copy)}>Unlink</button>
            )}
          </div>
        ))}
      </div>
      {kind.copies.length > 1 && <p className="workout-hint" style={{ marginTop: '-0.5rem' }}>Not the same machine after all? Unlink that gym&apos;s copy: it keeps its lifts and history.</p>}

      <label className="workout-field" style={{ display: 'block' }}>
        <span className="workout-label">Rename everywhere</span>
        <input className="workout-input" value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <button className="workout-button is-primary is-block" disabled={!renamed || busy} onClick={() => onRename(name.trim())}>
        {busy ? 'Saving…' : 'Rename at every gym'}
      </button>

      {linkable.length > 0 && (<>
        <div className="workout-section-title">Same machine as…</div>
        <p className="workout-hint" style={{ marginTop: 0 }}>Link it with that machine at your other gyms. Each keeps its own weights.</p>
        <select className="workout-input" value={other} onChange={(e) => setOther(e.target.value)} aria-label="Machine to link with">
          <option value="">Pick a machine</option>
          {linkable.map((k) => <option key={k.key} value={k.key}>{k.name} ({k.copies.map((c) => c.gymName).join(', ')})</option>)}
        </select>
        <button className="workout-button is-block" disabled={!other || busy} onClick={() => onLink(other)}>Link…</button>
      </>)}

      {otherGyms.length > 0 && (<>
        <div className="workout-section-title">Add to another gym</div>
        <p className="workout-hint" style={{ marginTop: 0 }}>Copies it with its lifts, linked to this machine. Check its weights there afterwards.</p>
        <select className="workout-input" value={gymId} onChange={(e) => setGymId(e.target.value)} aria-label="Gym to add it to">
          <option value="">Pick a gym</option>
          {otherGyms.map((g) => <option key={g.id} value={g.id}>{g.emoji || '🏋️'} {g.name}</option>)}
        </select>
        <button className="workout-button is-block" disabled={!pickedGym || busy} onClick={() => { onAddToGym(gymId); setGymId(''); }}>
          {pickedGym ? `Add to ${pickedGym.name}` : 'Add'}
        </button>
      </>)}
    </Sheet>
  );
}

type LinkSheetProps = {
  kinds: [MachineKind, MachineKind];
  gyms: Gym[];
  busy: boolean;
  error: string;
  /** Resolves null when it failed. */
  onLink: (keep: MachineKind, other: MachineKind) => Promise<unknown>;
  onLinkLifts: (pairs: LiftLinkSuggestion[]) => Promise<unknown>;
  onClose: () => void;
};

/** Link two machines (pick the name to keep), then offer to link lifts that look the same. */
function LinkKindsSheet({ kinds, gyms, busy, error, onLink, onLinkLifts, onClose }: LinkSheetProps) {
  const [keepKey, setKeepKey] = useState(() => (kinds[1].copies.length > kinds[0].copies.length ? kinds[1] : kinds[0]).key);
  // Lifts to offer once linked; computed before linking, from each side's stations.
  const [liftPairs, setLiftPairs] = useState<LiftLinkSuggestion[] | null>(null);
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const keep = kinds.find((k) => k.key === keepKey)!;
  const other = kinds.find((k) => k.key !== keepKey)!;

  const stationsOf = (key: string): Station[] => gyms.flatMap((g) => g.stations).filter((s) => kindKey(s) === key);

  const link = async () => {
    const pairs = liftLinkSuggestions(stationsOf(keep.key), stationsOf(other.key));
    if (!(await onLink(keep, other))) return;
    if (pairs.length === 0) return onClose();
    setLiftPairs(pairs);
    setPicked(new Set(pairs.map((_, i) => i)));
  };
  const linkLifts = async () => {
    if (await onLinkLifts(liftPairs!.filter((_, i) => picked.has(i)))) onClose();
  };

  if (liftPairs) {
    return (
      <Sheet
        title="Link their lifts too?"
        subtitle={`${keep.name} is linked`}
        onClose={onClose}
        footer={<button className="workout-button is-primary" disabled={busy || picked.size === 0} onClick={linkLifts}>{busy ? 'Linking…' : `Link ${plural(picked.size, 'lift')}`}</button>}
      >
        {error && <p className="workout-error">{error}</p>}
        <p className="workout-hint" style={{ marginTop: 0 }}>These look like the same exercise on this machine. Linking them combines their history, PRs and goals under the first name.</p>
        {liftPairs.map((pair, i) => (
          <label key={`${pair.keep}|${pair.other}`} className="workout-switch-row" style={{ marginBottom: '0.5rem' }}>
            <span className="workout-card-text">
              <strong style={{ display: 'block', fontSize: '0.92rem' }}>{pair.keep}</strong>
              <span className="workout-hint">and “{pair.other}”</span>
            </span>
            <input type="checkbox" checked={picked.has(i)} onChange={(e) => setPicked((prev) => {
              const next = new Set(prev);
              if (e.target.checked) next.add(i); else next.delete(i);
              return next;
            })} />
          </label>
        ))}
        <button type="button" className="workout-button is-block" disabled={busy} onClick={onClose}>Not now</button>
      </Sheet>
    );
  }

  return (
    <Sheet
      title="Same machine?"
      subtitle="Linked machines show together; each gym keeps its own weights"
      onClose={onClose}
      footer={<button className="workout-button is-primary" disabled={busy} onClick={link}>{busy ? 'Linking…' : `Link as “${keep.name}”`}</button>}
    >
      {error && <p className="workout-error">{error}</p>}
      <span className="workout-label">Keep the name</span>
      <div className="workout-stack" role="radiogroup" aria-label="Name to keep">
        {kinds.map((kind) => (
          <button key={kind.key} type="button" role="radio" aria-checked={keepKey === kind.key} className="workout-choice is-row" onClick={() => setKeepKey(kind.key)}>
            <span aria-hidden>{keepKey === kind.key ? '◉' : '○'}</span>
            <span className="workout-card-text">
              <span className="workout-card-title">{kind.name}</span>
              <small style={{ display: 'block' }}>{kind.copies.map((c) => `${c.gymName} · ${c.weights}`).join('; ')}</small>
            </span>
          </button>
        ))}
      </div>
      <p className="workout-hint">Each gym&apos;s machine keeps its own name, weights and photo. Not the same? Just close this.</p>
    </Sheet>
  );
}
