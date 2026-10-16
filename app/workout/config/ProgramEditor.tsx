'use client';

import { useEffect, useState } from 'react';
import { useSitePopup } from '@/components/SitePopup';
import Sheet from '@/components/workout/Sheet';
import type { Program, ProgramDay } from '@/lib/workout/programs';

type TypeOption = { id: string; name: string; muscles?: string[] };
type GymOption = { id: string; name: string; emoji?: string };
type Draft = { id?: string; name: string; days: ProgramDay[]; deloadEveryWeeks?: number; gymId?: string };

const DELOAD_OPTIONS = [0, 3, 4, 5, 6, 8];

async function requestJson(url: string, init?: RequestInit) {
  const res = await fetch(url, { headers: { 'Content-Type': 'application/json' }, ...init });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.success) throw new Error(data.message || `Request failed (${res.status})`);
  return data;
}

/**
 * Programs: pre-plan a rotation of workout days (Push → Pull → Legs…), each
 * using one of your workout types. Starting a program from the home page picks
 * the next day automatically.
 */
export default function ProgramEditor() {
  const { confirm, popup } = useSitePopup();
  const [programs, setPrograms] = useState<Program[]>([]);
  const [types, setTypes] = useState<TypeOption[]>([]);
  const [gyms, setGyms] = useState<GymOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    Promise.all([
      fetch('/api/workout/programs').then((r) => r.json()),
      fetch('/api/workout/types?scope=mine').then((r) => r.json()),
      fetch('/api/workout/gyms').then((r) => r.json()),
    ]).then(([p, t, g]) => {
      if (p.success) setPrograms(p.programs);
      if (t.success) setTypes(t.types);
      if (g.success) setGyms(g.gyms);
    }).catch(() => setError('Could not load programs.')).finally(() => setLoading(false));
  }, []);

  const typeName = (id: string) => types.find((t) => t.id === id)?.name || 'Missing workout type';
  const dayLabel = (day: ProgramDay) => day.name || typeName(day.typeId);

  const save = async () => {
    if (!draft) return;
    setSaving(true);
    setError('');
    try {
      const body = JSON.stringify({ ...draft, deloadEveryWeeks: draft.deloadEveryWeeks || undefined, gymId: draft.gymId || undefined });
      const data = await requestJson('/api/workout/programs', { method: draft.id ? 'PUT' : 'POST', body });
      setPrograms((prev) => (draft.id ? prev.map((p) => (p.id === data.program.id ? data.program : p)) : [...prev, data.program]));
      setDraft(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save.');
    } finally {
      setSaving(false);
    }
  };

  const remove = async (program: Program) => {
    const ok = await confirm({ title: 'Delete program', message: `Delete ${program.name}? Past workouts keep their history.`, confirmLabel: 'Delete', danger: true });
    if (!ok) return;
    try {
      await requestJson(`/api/workout/programs?id=${encodeURIComponent(program.id)}`, { method: 'DELETE' });
      setPrograms((prev) => prev.filter((p) => p.id !== program.id));
      setDraft(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not delete.');
    }
  };

  const updateDay = (index: number, patch: Partial<ProgramDay>) => draft && setDraft({ ...draft, days: draft.days.map((d, i) => (i === index ? { ...d, ...patch } : d)) });
  const moveDay = (index: number, by: -1 | 1) => {
    if (!draft) return;
    const days = [...draft.days];
    const [day] = days.splice(index, 1);
    days.splice(index + by, 0, day);
    setDraft({ ...draft, days });
  };

  if (loading) return <p className="workout-hint">Loading programs…</p>;

  return (
    <div>
      <p className="workout-hint" style={{ marginTop: 0 }}>
        A program is a rotation of workout days — e.g. Push → Pull → Legs. Start it from the home page and it picks the next day for you.
        Quick one-off workouts still work the same.
      </p>
      {error && !draft && <p className="workout-error">{error}</p>}
      <div className="workout-stack is-loose">
        {programs.map((program) => (
          <button key={program.id} type="button" className="workout-gym-card" onClick={() => { setError(''); setDraft({ ...program }); }}>
            <span className="workout-avatar" aria-hidden>🗓️</span>
            <span className="workout-card-text">
              <span className="workout-card-title">{program.name}</span>
              <span className="workout-card-meta">{program.days.map(dayLabel).join(' → ')}</span>
              {program.deloadEveryWeeks && <span className="workout-card-meta">Deload every {program.deloadEveryWeeks} weeks</span>}
            </span>
            <span className="workout-chevron" aria-hidden>›</span>
          </button>
        ))}
        {types.length === 0 ? (
          <p className="workout-hint">Make some workout types first (the Workout Types tab) — each program day uses one.</p>
        ) : (
          <button className="workout-button is-primary is-block" style={{ minHeight: 52 }} onClick={() => { setError(''); setDraft({ name: '', days: [{ typeId: types[0].id }] }); }}>+ New program</button>
        )}
      </div>

      {draft && (
        <Sheet
          title={draft.id ? 'Edit program' : 'New program'}
          onClose={() => setDraft(null)}
          footer={<button className="workout-button is-primary" disabled={saving || !draft.name.trim() || draft.days.length === 0} onClick={save}>{saving ? 'Saving…' : 'Save program'}</button>}
        >
          {error && <p className="workout-error">{error}</p>}
          <label className="workout-field" style={{ display: 'block' }}>
            <span className="workout-label">Name</span>
            <input className="workout-input" placeholder="e.g. Push / Pull / Legs" autoFocus={!draft.id} value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
          </label>

          <div className="workout-section-title">
            Days in order
            <button type="button" className="workout-text-btn" style={{ textTransform: 'none', letterSpacing: 0 }} onClick={() => setDraft({ ...draft, days: types.map((t) => ({ typeId: t.id })) })}>Use all my types</button>
          </div>
          <div className="workout-stack" style={{ marginBottom: '0.75rem' }}>
            {draft.days.map((day, i) => (
              <div key={i} className="workout-tile" style={{ margin: 0, padding: '0.6rem' }}>
                <div className="workout-flex-between" style={{ gap: '0.4rem', marginBottom: '0.4rem' }}>
                  <strong>Day {i + 1}</strong>
                  <span style={{ display: 'flex', gap: '0.3rem' }}>
                    <button type="button" className="workout-icon-btn" aria-label="Move day up" disabled={i === 0} onClick={() => moveDay(i, -1)}>↑</button>
                    <button type="button" className="workout-icon-btn" aria-label="Move day down" disabled={i === draft.days.length - 1} onClick={() => moveDay(i, 1)}>↓</button>
                    <button type="button" className="workout-icon-btn" aria-label="Remove day" disabled={draft.days.length === 1} onClick={() => setDraft({ ...draft, days: draft.days.filter((_, j) => j !== i) })}>✕</button>
                  </span>
                </div>
                <div className="workout-grid-2">
                  <label>
                    <span className="workout-label">Workout type</span>
                    <select className="workout-input" value={day.typeId} onChange={(e) => updateDay(i, { typeId: e.target.value })}>
                      {!types.some((t) => t.id === day.typeId) && <option value={day.typeId}>Missing type</option>}
                      {types.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                    </select>
                  </label>
                  <label>
                    <span className="workout-label">Lifts</span>
                    <select className="workout-input" value={day.lifts ?? 5} onChange={(e) => updateDay(i, { lifts: Number(e.target.value) })}>
                      {[3, 4, 5, 6, 7, 8].map((n) => <option key={n} value={n}>{n} lifts</option>)}
                    </select>
                  </label>
                </div>
                <input className="workout-input" style={{ marginBottom: 0 }} placeholder={`Label (optional, e.g. Heavy ${typeName(day.typeId)})`} value={day.name || ''} onChange={(e) => updateDay(i, { name: e.target.value || undefined })} />
              </div>
            ))}
          </div>
          <button type="button" className="workout-button is-dashed is-block" onClick={() => setDraft({ ...draft, days: [...draft.days, { typeId: types[0]?.id || '' }] })}>+ Add a day</button>

          <div className="workout-grid-2 workout-field" style={{ marginTop: '1rem' }}>
            <label>
              <span className="workout-label">Deload suggestion</span>
              <select className="workout-input" value={draft.deloadEveryWeeks || 0} onChange={(e) => setDraft({ ...draft, deloadEveryWeeks: Number(e.target.value) || undefined })}>
                {DELOAD_OPTIONS.map((n) => <option key={n} value={n}>{n ? `Every ${n} weeks` : 'Only when needed'}</option>)}
              </select>
            </label>
            <label>
              <span className="workout-label">Usual gym</span>
              <select className="workout-input" value={draft.gymId || ''} onChange={(e) => setDraft({ ...draft, gymId: e.target.value || undefined })}>
                <option value="">Ask each time</option>
                {gyms.map((g) => <option key={g.id} value={g.id}>{g.emoji ? `${g.emoji} ` : ''}{g.name}</option>)}
              </select>
            </label>
          </div>
          <p className="workout-hint" style={{ marginTop: 0 }}>Deloads are only ever suggested — you choose whether to take one when you start.</p>

          {draft.id && <button type="button" className="workout-button is-danger is-block" onClick={() => remove(draft as Program)}>Delete program</button>}
        </Sheet>
      )}
      {popup}
    </div>
  );
}
