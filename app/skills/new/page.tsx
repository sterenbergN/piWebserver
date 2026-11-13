'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import { skillsGet, skillsPost, SignedOut, type BoardResponse } from '@/components/skills/api';
import { ErrorNote, LevelPicker, LevelScale, Loading, SignedOutCard } from '@/components/skills/Ui';
import type { SubjectStatus } from '@/lib/skills/types';

// Add a subject: just enough to start (name, area, where you are, where you want
// to be). Topics and resources come from the AI plan, which this can jump to.

const ICONS = ['🚀', '⚙️', '🎛️', '🔥', '💻', '🧪', '📐', '🔌', '🗣️', '📈'];
const STATUS_CHOICES: { value: SubjectStatus; title: string; note: string }[] = [
  { value: 'want', title: 'Want to learn', note: 'Not started' },
  { value: 'learning', title: 'Learning', note: 'Working on it now' },
  { value: 'maintaining', title: 'I already know it', note: 'Keep it fresh and prove it' },
  { value: 'paused', title: 'Paused', note: 'Not right now' },
];

function NewSubject() {
  const router = useRouter();
  const params = useSearchParams();
  const [areas, setAreas] = useState<string[]>([]);
  const [signedOut, setSignedOut] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [name, setName] = useState(params.get('name') ?? '');
  const [icon, setIcon] = useState('🎯');
  const [area, setArea] = useState('');
  const [status, setStatus] = useState<SubjectStatus>('learning');
  const [target, setTarget] = useState(4);
  const [goal, setGoal] = useState('');
  const [background, setBackground] = useState('');
  const [hours, setHours] = useState('');
  const [plan, setPlan] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    skillsGet<BoardResponse>()
      .then((r) => setAreas(r.board.areas))
      .catch((e) => { if (e instanceof SignedOut) setSignedOut(true); })
      .finally(() => setLoaded(true));
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (saving) return;
    setSaving(true);
    setError('');
    try {
      const hoursPerWeek = hours.trim() ? Number(hours) : undefined;
      const { id } = await skillsPost<{ id: string }>('add-subject', {
        name: name.trim(), icon: icon.trim() || '🎯', area: area.trim(), status, target, goal, background,
        hoursPerWeek: hoursPerWeek !== undefined && Number.isFinite(hoursPerWeek) ? hoursPerWeek : undefined,
      });
      router.push(plan ? `/skills/${id}/plan` : `/skills/${id}`);
    } catch (err) {
      if (err instanceof SignedOut) setSignedOut(true);
      else setError(err instanceof Error ? err.message : 'Couldn’t save that. Try again.');
      setSaving(false);
    }
  }

  if (signedOut) return <main className="sk sk-narrow sk-new"><SignedOutCard /></main>;
  if (!loaded) return <main className="sk sk-narrow sk-new"><Loading rows={2} /></main>;

  return (
    <main className="sk sk-narrow sk-new">
      <header className="sk-head">
        <div>
          <Link href="/skills" className="sk-back">← Skills</Link>
          <h1>Add a subject</h1>
          <p>Say what it is and where you want to get to. You can plan it with AI next.</p>
        </div>
      </header>

      <form className="sk-card" onSubmit={submit}>
        <div className="sk-grid-2">
          <label className="sk-field">
            <span>Name</span>
            <input value={name} required maxLength={80} onChange={(e) => setName(e.target.value)} placeholder="e.g. Rocket propulsion" autoFocus />
          </label>
          <label className="sk-field">
            <span>Area</span>
            <input value={area} list="sk-areas" maxLength={60} onChange={(e) => setArea(e.target.value)} placeholder="e.g. Controls, Mechanical, Software, Leadership" />
            <datalist id="sk-areas">{areas.map((a) => <option key={a} value={a} />)}</datalist>
          </label>
        </div>

        <div className="sk-field">
          <label htmlFor="sk-icon"><span>Icon</span></label>
          <input id="sk-icon" value={icon} maxLength={8} onChange={(e) => setIcon(e.target.value)} style={{ maxWidth: '6rem' }} />
          <div className="sk-new-icons">
            {ICONS.map((i) => (
              <button key={i} type="button" aria-pressed={icon === i} aria-label={`Use ${i}`} onClick={() => setIcon(i)}>{i}</button>
            ))}
          </div>
        </div>

        <fieldset className="sk-new-statuses">
          <legend>Where are you with it?</legend>
          {STATUS_CHOICES.map((c) => (
            <label key={c.value} className="sk-new-status">
              <input type="radio" name="status" value={c.value} checked={status === c.value} onChange={() => setStatus(c.value)} />
              <span><strong>{c.title}</strong>{c.note}</span>
            </label>
          ))}
        </fieldset>
        {status === 'maintaining' && (
          <p className="sk-hint">After planning, rate yourself on each topic, then take a placement test. That’s how the board learns what you really know.</p>
        )}

        <div className="sk-field">
          <span>Target level</span>
          <LevelPicker value={target} onChange={(v) => setTarget(v ?? 4)} label="Target level" allowClear={false} />
          <LevelScale highlight={target} />
        </div>

        <label className="sk-field">
          <span>Why do you want it?</span>
          <textarea rows={3} value={goal} maxLength={600} onChange={(e) => setGoal(e.target.value)} />
        </label>
        <label className="sk-field">
          <span>What do you already know?</span>
          <textarea rows={4} value={background} maxLength={2000} onChange={(e) => setBackground(e.target.value)} />
          <small>This goes into the AI plan prompt, so the plan starts where you are.</small>
        </label>
        <label className="sk-field" style={{ maxWidth: '12rem' }}>
          <span>Hours per week</span>
          <input type="number" min={0} max={80} step="0.5" inputMode="decimal" value={hours} onChange={(e) => setHours(e.target.value)} />
        </label>

        <label className="sk-new-check">
          <input type="checkbox" checked={plan} onChange={(e) => setPlan(e.target.checked)} /> Plan it with AI next
        </label>

        {error && <ErrorNote>{error}</ErrorNote>}
        <div className="sk-actions">
          <button type="submit" className="btn btn-primary" disabled={saving || !name.trim()}>{saving ? 'Saving…' : 'Add subject'}</button>
          <Link href="/skills" className="sk-text-btn">Cancel</Link>
        </div>
      </form>
    </main>
  );
}

export default function NewSubjectPage() {
  return <Suspense><NewSubject /></Suspense>;
}
