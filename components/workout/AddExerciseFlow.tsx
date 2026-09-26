'use client';

import { useEffect, useMemo, useState } from 'react';
import type { Gym, Lift, Station } from '@/lib/workout/types';
import { liftFromName, suggestedLiftNames, type EquipmentPreset } from '@/lib/workout/catalog';
import EquipmentPicker from './EquipmentPicker';
import StationForm from './StationForm';
import { describeLift } from './LiftForm';
import { equipmentLibrary as equipmentLibraryFor } from '@/lib/workout/equipment-library';

type Step =
  | { kind: 'station' }
  | { kind: 'pick-new' }
  | { kind: 'new-station'; preset?: EquipmentPreset; copyFrom?: Station }
  | { kind: 'lifts'; stationId: string };

type AddExerciseFlowProps = {
  gym: Gym;
  /** Stations from other gyms to reuse when adding new equipment. */
  library?: Station[];
  /** Lift ids already in the workout (shown as added). */
  inWorkout?: Set<string>;
  saveGym: (gym: Gym) => Promise<Gym>;
  onAdd: (entries: { lift: Lift; station: Station }[]) => void;
  onCancel?: () => void;
};

/**
 * Add exercises while walking around a gym: pick the machine you're at (or set
 * up new equipment on the spot), then the lifts. New stations and lifts are
 * saved to the gym so they're there next time.
 */
export default function AddExerciseFlow({ gym, library = [], inWorkout = new Set(), saveGym, onAdd, onCancel }: AddExerciseFlowProps) {
  const [step, setStep] = useState<Step>(gym.stations.length ? { kind: 'station' } : { kind: 'pick-new' });
  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [typed, setTyped] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const station = step.kind === 'lifts' ? gym.stations.find((s) => s.id === step.stationId) : undefined;
  const q = query.trim().toLowerCase();
  const stations = useMemo(() => gym.stations.filter((s) =>
    !q || s.name.toLowerCase().includes(q) || s.lifts.some((l) => l.name.toLowerCase().includes(q))), [gym.stations, q]);

  const run = async (fn: () => Promise<void>) => {
    setSaving(true);
    setError('');
    try { await fn(); } catch (err) { setError(err instanceof Error ? err.message : 'Could not save'); } finally { setSaving(false); }
  };

  const openStation = (s: Station, preselect: string[] = []) => {
    setPicked(new Set(preselect));
    setTyped('');
    setStep({ kind: 'lifts', stationId: s.id });
  };

  const saveNewStation = (created: Station) => run(async () => {
    const saved = await saveGym({ ...gym, stations: [...gym.stations, created] });
    const stored = saved.stations.find((s) => s.id === created.id) || created;
    openStation(stored, stored.lifts.map((l) => l.id));
  });

  const addToWorkout = () => run(async () => {
    if (!station) return;
    // Typed names become new lifts on this station first.
    const have = new Set(station.lifts.map((l) => l.name.toLowerCase()));
    const newLifts = typed.split(',').map((n) => n.trim()).filter((n) => n && !have.has(n.toLowerCase())).map((n) => liftFromName(n));
    let target = station;
    if (newLifts.length) {
      const saved = await saveGym({ ...gym, stations: gym.stations.map((s) => (s.id === station.id ? { ...s, lifts: [...s.lifts, ...newLifts] } : s)) });
      target = saved.stations.find((s) => s.id === station.id) || { ...station, lifts: [...station.lifts, ...newLifts] };
    }
    const chosen = target.lifts.filter((l) => picked.has(l.id) || newLifts.some((n) => n.id === l.id));
    if (chosen.length === 0) return;
    onAdd(chosen.map((lift) => ({ lift, station: target })));
    setStep({ kind: 'station' });
    setPicked(new Set());
    setTyped('');
    setQuery('');
  });

  const toggle = (id: string) => setPicked((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  if (step.kind === 'pick-new') {
    return (
      <EquipmentPicker
        existingNames={gym.stations.map((s) => s.name)}
        library={library}
        onPickStation={(s) => setStep({ kind: 'new-station', copyFrom: s })}
        onPick={(preset) => setStep({ kind: 'new-station', preset: preset || undefined })}
        onCancel={() => (gym.stations.length ? setStep({ kind: 'station' }) : onCancel?.())}
      />
    );
  }

  if (step.kind === 'new-station') {
    return (
      <>
        {error && <p className="workout-error">{error}</p>}
        <StationForm preset={step.preset} copyFrom={step.copyFrom} saving={saving} onSave={saveNewStation} onCancel={() => setStep({ kind: 'pick-new' })} />
      </>
    );
  }

  if (step.kind === 'lifts' && station) {
    const suggestions = suggestedLiftNames(station).slice(0, 8);
    const typedCount = typed.split(',').map((n) => n.trim()).filter(Boolean).length;
    const total = picked.size + typedCount;
    return (
      <div className="workout-form-panel animate-fade-in">
        <div className="workout-flex-between" style={{ marginBottom: '0.5rem' }}>
          <h4 style={{ margin: 0 }}>{station.name}</h4>
          <button className="workout-text-btn" onClick={() => setStep({ kind: 'station' })}>← Machines</button>
        </div>
        {error && <p className="workout-error">{error}</p>}
        {station.lifts.length === 0 && <p className="workout-hint">No lifts here yet — type what you&apos;re doing below.</p>}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem', marginBottom: '0.75rem' }}>
          {station.lifts.map((l) => {
            const already = inWorkout.has(l.id);
            return (
              <label key={l.id} className="workout-list-row" style={{ cursor: already ? 'default' : 'pointer', opacity: already ? 0.55 : 1 }}>
                <span style={{ display: 'flex', gap: '0.6rem', alignItems: 'center' }}>
                  <input type="checkbox" disabled={already} checked={picked.has(l.id)} onChange={() => toggle(l.id)} style={{ width: 18, height: 18 }} />
                  <span>
                    <strong style={{ fontSize: '0.9rem' }}>{l.name}</strong>
                    <span className="workout-hint" style={{ display: 'block' }}>{already ? 'Already in this workout' : describeLift(l)}</span>
                  </span>
                </span>
              </label>
            );
          })}
        </div>
        {suggestions.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem', marginBottom: '0.5rem' }}>
            {suggestions.map((name) => (
              <button key={name} type="button" className="workout-toggle-chip" onClick={() => setTyped((t) => (t.trim() ? `${t.replace(/,\s*$/, '')}, ${name}` : name))}>+ {name}</button>
            ))}
          </div>
        )}
        <input className="workout-input" placeholder="New lift(s) here, comma separated" value={typed} onChange={(e) => setTyped(e.target.value)} />
        <button className="workout-btn-primary" disabled={total === 0 || saving} onClick={addToWorkout}>
          {saving ? 'Saving…' : total ? `Add ${total} to workout` : 'Pick or type a lift'}
        </button>
      </div>
    );
  }

  return (
    <div className="workout-form-panel animate-fade-in">
      <div className="workout-flex-between" style={{ marginBottom: '0.5rem' }}>
        <h4 style={{ margin: 0 }}>What are you on?</h4>
        {onCancel && <button className="workout-text-btn" onClick={onCancel}>Close</button>}
      </div>
      <input className="workout-input" placeholder="Search machines or lifts…" value={query} onChange={(e) => setQuery(e.target.value)} />
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem', maxHeight: '45vh', overflowY: 'auto', marginBottom: '0.75rem' }}>
        {stations.map((s) => (
          <button key={s.id} className="btn btn-secondary workout-flex-between" style={{ padding: '0.7rem 0.9rem', textAlign: 'left' }} onClick={() => openStation(s)}>
            <span>
              <strong style={{ display: 'block', fontSize: '0.9rem' }}>{s.name}</strong>
              <span className="workout-hint">{s.lifts.length ? s.lifts.map((l) => l.name).slice(0, 3).join(', ') + (s.lifts.length > 3 ? '…' : '') : 'no lifts yet'}</span>
            </span>
            <span aria-hidden>›</span>
          </button>
        ))}
        {stations.length === 0 && <p className="workout-hint">No machines match.</p>}
      </div>
      <button className="workout-btn-primary" style={{ background: 'transparent', border: '1px dashed var(--accent)', color: 'var(--accent)', boxShadow: 'none' }}
        onClick={() => setStep({ kind: 'pick-new' })}>
        + New equipment here
      </button>
    </div>
  );
}

type AddExerciseForGymProps = Omit<AddExerciseFlowProps, 'gym' | 'library' | 'saveGym'> & {
  gymId: string;
  /** Called after equipment changes are saved (e.g. to refresh stations in the plan). */
  onGymUpdated?: (gym: Gym) => void;
};

/** AddExerciseFlow that loads the gym (and your other gyms' equipment) and saves changes. */
export function AddExerciseForGym({ gymId, onGymUpdated, ...rest }: AddExerciseForGymProps) {
  const [gyms, setGyms] = useState<Gym[] | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    fetch('/api/workout/gyms?scope=all').then((r) => r.json()).then((d) => {
      if (d.success) setGyms(d.gyms); else setError(d.message || 'Could not load the gym');
    }).catch(() => setError('Could not load the gym'));
  }, []);

  const gym = gyms?.find((g) => g.id === gymId);
  const library = useMemo(() => (gyms && gym ? equipmentLibraryFor(gyms, gym) : []), [gyms, gym]);

  if (error) return <p className="workout-error">{error}</p>;
  if (!gyms) return <p className="workout-hint">Loading equipment…</p>;
  if (!gym) return <p className="workout-error">This gym can only be changed by its owner.</p>;

  const saveGym = async (next: Gym) => {
    const res = await fetch('/api/workout/gyms', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(next) });
    const d = await res.json().catch(() => ({}));
    if (!res.ok || !d.success) throw new Error(d.message || 'Could not save the gym');
    setGyms((prev) => (prev || []).map((g) => (g.id === d.gym.id ? d.gym : g)));
    onGymUpdated?.(d.gym);
    return d.gym as Gym;
  };

  return <AddExerciseFlow gym={gym} library={library} saveGym={saveGym} {...rest} />;
}
