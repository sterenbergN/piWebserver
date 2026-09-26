'use client';

import { useState, useEffect, useRef } from 'react';
import { useSitePopup } from '@/components/SitePopup';
import { MUSCLE_GROUPS, type FixedLiftRef, type Gym, type WorkoutType } from '@/lib/workout/types';

const EMPTY_TYPE: Partial<WorkoutType> = {
  name: '',
  muscles: [],
  intensity: 75,
  sets: 4,
  minReps: 8,
  maxReps: 12,
  isPublic: false,
};

/** Rep/set defaults for a target intensity: heavy → low reps, light → high reps. */
function schemeForIntensity(intensity: number) {
  if (intensity >= 85) return { minReps: 3, maxReps: 6, sets: 5 };
  if (intensity <= 60) return { minReps: 12, maxReps: 20, sets: 3 };
  return { minReps: 8, maxReps: 12, sets: 4 };
}

function intensityLabel(intensity: number) {
  if (intensity > 80) return 'Power';
  if (intensity > 60) return 'Hypertrophy';
  return 'Endurance';
}

const toInt = (value: string) => {
  const parsed = parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
};

async function requestJson(url: string, init?: RequestInit) {
  const res = await fetch(url, { headers: { 'Content-Type': 'application/json' }, ...init });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.success) throw new Error(data.message || `Request failed (${res.status})`);
  return data;
}

export default function WorkoutTypeEditor() {
  const { confirm, popup } = useSitePopup();
  const [types, setTypes] = useState<WorkoutType[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [userId, setUserId] = useState('');
  // null = closed; 'new' = creating; otherwise the id being edited
  const [editingId, setEditingId] = useState<string | 'new' | null>(null);
  const [draft, setDraft] = useState<Partial<WorkoutType>>(EMPTY_TYPE);
  const formRef = useRef<HTMLDivElement | null>(null);
  const [liftOptions, setLiftOptions] = useState<{ liftId: string; name: string; label: string }[]>([]);

  useEffect(() => {
    Promise.all([
      fetch('/api/workout/types?scope=all').then((r) => r.json()),
      fetch('/api/workout/auth').then((r) => r.json()),
      fetch('/api/workout/gyms').then((r) => r.json()).catch(() => null),
    ])
      .then(([dTypes, dAuth, dGyms]) => {
        if (dTypes.success) setTypes(dTypes.types);
        if (dGyms?.success) {
          setLiftOptions((dGyms.gyms as Gym[]).flatMap((gym) =>
            gym.stations.flatMap((station) =>
              station.lifts.map((lift) => ({ liftId: lift.id, name: lift.name, label: `${lift.name} — ${gym.name}` }))
            )
          ));
        }
        if (dAuth.authenticated && dAuth.user) setUserId(dAuth.user.id);
      })
      .catch(() => setError('Could not load workout types.'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (editingId) formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [editingId]);

  const openEditor = (type?: WorkoutType) => {
    setDraft(type ? { ...type, isPublic: type.isPublic === true } : EMPTY_TYPE);
    setEditingId(type ? type.id : 'new');
    setError('');
  };

  const closeEditor = () => {
    setEditingId(null);
    setDraft(EMPTY_TYPE);
  };

  const handleSave = async () => {
    if (!draft.name?.trim()) return;
    try {
      if (draft.id) {
        const data = await requestJson('/api/workout/types', { method: 'PUT', body: JSON.stringify(draft) });
        setTypes((prev) => prev.map((type) => (type.id === data.type.id ? data.type : type)));
      } else {
        const data = await requestJson('/api/workout/types', { method: 'POST', body: JSON.stringify(draft) });
        setTypes((prev) => [...prev, data.type]);
      }
      closeEditor();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save workout type.');
    }
  };

  const handleDelete = async (type: WorkoutType) => {
    const ok = await confirm({ title: 'Delete Template', message: `Delete "${type.name}"?`, confirmLabel: 'Delete', danger: true });
    if (!ok) return;
    try {
      await requestJson(`/api/workout/types?id=${encodeURIComponent(type.id)}`, { method: 'DELETE' });
      setTypes((prev) => prev.filter((entry) => entry.id !== type.id));
      if (editingId === type.id) closeEditor();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not delete workout type.');
    }
  };

  const handleImport = async (type: WorkoutType) => {
    const ok = await confirm({ title: 'Import Template', message: `Import template "${type.name}"?`, confirmLabel: 'Import' });
    if (!ok) return;
    try {
      const data = await requestJson('/api/workout/types', {
        method: 'POST',
        body: JSON.stringify({ ...type, id: undefined, name: `${type.name} (Copy)`, isPublic: false }),
      });
      setTypes((prev) => [...prev, data.type]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not import workout type.');
    }
  };

  const toggleMuscle = (muscle: string) => {
    const current = draft.muscles || [];
    setDraft({
      ...draft,
      muscles: current.includes(muscle) ? current.filter((entry) => entry !== muscle) : [...current, muscle],
    });
  };

  const pinned: FixedLiftRef[] = draft.fixedLifts || [];
  const setPinned = (next: FixedLiftRef[]) => setDraft({ ...draft, fixedLifts: next });
  const movePinned = (index: number, direction: -1 | 1) => {
    const next = [...pinned];
    const target = index + direction;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    setPinned(next);
  };

  if (loading) return <div style={{ padding: '1.5rem' }}>Loading Types...</div>;

  const myTypes = types.filter((type) => type.ownerId === userId);
  const otherTypes = types.filter((type) => type.ownerId !== userId);
  const intensity = draft.intensity ?? 75;

  const renderEditor = () => (
    <div ref={formRef} className="workout-form-panel animate-fade-in">
      <span className="workout-pill">{draft.id ? 'Editing' : 'New'}</span>
      <h4 style={{ margin: '0.5rem 0 1rem 0' }}>{draft.id ? 'Edit' : 'New'} Workout Type</h4>
      <input className="workout-input" placeholder="Name (e.g. Upper Hypertrophy)" value={draft.name || ''} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />

      <label className="workout-label">Target Muscles</label>
      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
        {MUSCLE_GROUPS.map((muscle) => {
          const active = draft.muscles?.includes(muscle);
          return (
            <button
              key={muscle}
              onClick={() => toggleMuscle(muscle)}
              aria-pressed={active}
              style={{
                padding: '0.4rem 0.8rem',
                borderRadius: '20px',
                border: `1px solid ${active ? 'var(--accent)' : 'var(--surface-border)'}`,
                background: active ? 'rgba(var(--accent-rgb), 0.2)' : 'transparent',
                color: active ? 'var(--foreground)' : 'var(--muted)',
                fontWeight: active ? 600 : 400,
                cursor: 'pointer',
                fontSize: '0.85rem',
              }}
            >
              {muscle}
            </button>
          );
        })}
      </div>

      <label className="workout-label">Pinned Lifts (optional)</label>
      <p className="workout-hint" style={{ margin: '0 0 0.5rem' }}>
        Pinned lifts always come first, in this order. Any remaining slots are still picked randomly from the target muscles.
      </p>
      {pinned.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem', marginBottom: '0.5rem' }}>
          {pinned.map((ref, index) => (
            <div key={`${ref.liftId}-${index}`} className="workout-list-row" style={{ padding: '0.4rem 0.6rem' }}>
              <span style={{ fontSize: '0.85rem' }}>{index + 1}. {ref.name}</span>
              <div style={{ display: 'flex', gap: '0.6rem' }}>
                <button className="workout-text-btn" aria-label={`Move ${ref.name} up`} disabled={index === 0} onClick={() => movePinned(index, -1)}>↑</button>
                <button className="workout-text-btn" aria-label={`Move ${ref.name} down`} disabled={index === pinned.length - 1} onClick={() => movePinned(index, 1)}>↓</button>
                <button className="workout-text-btn danger" aria-label={`Unpin ${ref.name}`} onClick={() => setPinned(pinned.filter((_, i) => i !== index))}>✕</button>
              </div>
            </div>
          ))}
        </div>
      )}
      {liftOptions.length > 0 ? (
        <select
          className="workout-input"
          value=""
          onChange={(e) => {
            const option = liftOptions.find((o) => o.liftId === e.target.value);
            if (option && !pinned.some((ref) => ref.liftId === option.liftId)) {
              setPinned([...pinned, { liftId: option.liftId, name: option.name }]);
            }
          }}
        >
          <option value="">+ Pin a lift…</option>
          {liftOptions.filter((o) => !pinned.some((ref) => ref.liftId === o.liftId)).map((o) => (
            <option key={o.liftId} value={o.liftId}>{o.label}</option>
          ))}
        </select>
      ) : (
        <p className="workout-hint" style={{ marginBottom: '1rem' }}>Add lifts to a gym to pin them here.</p>
      )}

      <label className="workout-label" style={{ display: 'flex', justifyContent: 'space-between' }}>
        <span>Target Intensity (%)</span>
        <span style={{ color: 'var(--accent-light)' }}>{intensity}% ({intensityLabel(intensity)})</span>
      </label>
      <input
        type="range"
        min="30"
        max="100"
        step="5"
        value={intensity}
        onChange={(e) => {
          const value = parseInt(e.target.value, 10);
          setDraft({ ...draft, intensity: value, ...schemeForIntensity(value) });
        }}
        style={{ width: '100%', marginBottom: '1.5rem', accentColor: 'var(--accent)' }}
      />

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.5rem' }}>
        <div>
          <label className="workout-label">Sets</label>
          <input className="workout-input" type="number" min={1} value={draft.sets ?? ''} onChange={(e) => setDraft({ ...draft, sets: toInt(e.target.value) })} />
        </div>
        <div>
          <label className="workout-label">Min Reps</label>
          <input className="workout-input" type="number" min={1} value={draft.minReps ?? ''} onChange={(e) => setDraft({ ...draft, minReps: toInt(e.target.value) })} />
        </div>
        <div>
          <label className="workout-label">Max Reps</label>
          <input className="workout-input" type="number" min={1} value={draft.maxReps ?? ''} onChange={(e) => setDraft({ ...draft, maxReps: toInt(e.target.value) })} />
        </div>
      </div>

      <label style={{ display: 'flex', alignItems: 'flex-start', gap: '0.6rem', margin: '0.5rem 0', padding: '0.75rem', border: '1px solid var(--surface-border)', borderRadius: '10px', cursor: 'pointer' }}>
        <input type="checkbox" checked={draft.isPublic === true} onChange={(e) => setDraft({ ...draft, isPublic: e.target.checked })} style={{ marginTop: '0.15rem' }} />
        <div>
          <div style={{ fontWeight: 600 }}>Publish this workout type for others to import</div>
          <div style={{ fontSize: '0.85rem', color: 'var(--muted)' }}>Published workout types appear in the public import list. Private ones are visible only to you.</div>
        </div>
      </label>

      <div className="workout-btn-row" style={{ marginTop: '0.5rem' }}>
        <button className="workout-btn-primary" disabled={!draft.name?.trim()} onClick={handleSave}>Save</button>
        <button className="btn btn-secondary" onClick={closeEditor}>Cancel</button>
      </div>
    </div>
  );

  return (
    <div style={{ padding: '1.5rem' }}>
      <h3 style={{ margin: '0 0 1.5rem 0' }}>Your Workout Templates</h3>
      {error && <p className="workout-error" style={{ marginBottom: '1rem' }}>{error}</p>}

      <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', marginBottom: '1.5rem' }}>
        {myTypes.map((type) => (
          <div key={type.id} style={{ background: 'var(--background)', padding: '1rem', borderRadius: '12px', border: '1px solid var(--surface-border)' }}>
            <div className="workout-flex-between">
              <strong>{type.name}</strong>
              <div style={{ display: 'flex', gap: '0.75rem' }}>
                <button className="workout-text-btn" onClick={() => (editingId === type.id ? closeEditor() : openEditor(type))}>
                  {editingId === type.id ? 'Close' : 'Edit'}
                </button>
                <button className="workout-text-btn danger" onClick={() => handleDelete(type)}>Delete</button>
              </div>
            </div>
            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginTop: '0.5rem' }}>
              {type.muscles.map((muscle) => <span key={muscle} className="workout-pill">{muscle}</span>)}
            </div>
            <p style={{ margin: '0.5rem 0 0', fontSize: '0.85rem', color: 'var(--muted)' }}>
              Target: {type.sets} Sets • {type.minReps}-{type.maxReps} Reps (Intensity: {type.intensity}%) • {type.isPublic ? 'Published' : 'Private'}
            </p>
            {(type.fixedLifts?.length || 0) > 0 && (
              <p className="workout-hint" style={{ margin: '0.25rem 0 0' }}>📌 {type.fixedLifts!.map((ref) => ref.name).join(', ')} + random fill</p>
            )}

            {editingId === type.id && <div style={{ marginTop: '0.75rem' }}>{renderEditor()}</div>}
          </div>
        ))}
        {myTypes.length === 0 && <p style={{ fontSize: '0.9rem', color: 'var(--muted)' }}>No templates created yet.</p>}
      </div>

      {editingId === 'new' ? renderEditor() : editingId === null && (
        <button className="workout-btn-primary" onClick={() => openEditor()}>+ Create Template</button>
      )}

      {otherTypes.length > 0 && (
        <div style={{ marginTop: '2rem' }}>
          <h3 style={{ margin: '0 0 1rem 0' }}>Import Public Templates</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            {otherTypes.map((type) => (
              <div key={type.id} className="workout-list-row" style={{ padding: '0.75rem 1rem', borderRadius: '12px' }}>
                <span>{type.name} <small style={{ color: 'var(--muted)' }}>({type.intensity}%)</small></span>
                <button className="btn btn-secondary" style={{ padding: '0.25rem 0.75rem', fontSize: '0.85rem' }} onClick={() => handleImport(type)}>Import</button>
              </div>
            ))}
          </div>
        </div>
      )}

      {popup}
    </div>
  );
}
