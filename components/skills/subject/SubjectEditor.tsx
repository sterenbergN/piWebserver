'use client';

import { useId, useState } from 'react';
import { SUBJECT_STATUSES, STATUS_LABEL, type SubjectStatus } from '@/lib/skills/types';
import { ErrorNote, LevelPicker } from '../Ui';
import { useAct, type TabProps } from './shared';

// The inline editor under the subject's header. One form, one save.

export default function SubjectEditor({ data, reload, onDone }: TabProps & { onDone: () => void }) {
  const s = data.subject;
  const uid = useId();
  const { act, busy, error } = useAct(data, reload);
  const [name, setName] = useState(s.name);
  const [icon, setIcon] = useState(s.icon);
  const [area, setArea] = useState(s.area);
  const [status, setStatus] = useState<SubjectStatus>(s.status);
  const [target, setTarget] = useState(s.target);
  const [goal, setGoal] = useState(s.goal ?? '');
  const [background, setBackground] = useState(s.background ?? '');
  const [hours, setHours] = useState(s.hoursPerWeek ? String(s.hoursPerWeek) : '');

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const ok = await act('edit-subject', { changes: { name, icon, area, status, target, goal, background, hoursPerWeek: hours } });
    if (ok) onDone();
  }

  return (
    <form className="sk-card sk-editor" onSubmit={save}>
      <h2>Edit this subject</h2>
      <div className="sk-grid-2">
        <label className="sk-field"><span>Name</span><input value={name} maxLength={100} required onChange={(e) => setName(e.target.value)} /></label>
        <label className="sk-field"><span>Icon</span><input value={icon} maxLength={8} onChange={(e) => setIcon(e.target.value)} /><small>One emoji is plenty.</small></label>
        <label className="sk-field" htmlFor={`${uid}-area`}><span>Area</span>
          <input id={`${uid}-area`} list={`${uid}-areas`} value={area} maxLength={60} onChange={(e) => setArea(e.target.value)} />
          <datalist id={`${uid}-areas`}>{data.areas.map((a) => <option key={a} value={a} />)}</datalist>
          <small>Subjects with the same area sit together on the board.</small>
        </label>
        <label className="sk-field"><span>Status</span>
          <select value={status} onChange={(e) => setStatus(e.target.value as SubjectStatus)}>
            {SUBJECT_STATUSES.map((v) => <option key={v} value={v}>{STATUS_LABEL[v]}</option>)}
          </select>
        </label>
      </div>
      <div className="sk-field"><span id={`${uid}-target`}>Target level</span>
        <LevelPicker label="Target level" value={target} allowClear={false} onChange={(v) => v !== null && setTarget(Math.max(1, v))} />
        <small>Where you want to get to, 1 to 5.</small>
      </div>
      <label className="sk-field"><span>Goal</span><textarea rows={2} value={goal} maxLength={1000} onChange={(e) => setGoal(e.target.value)} placeholder="Why you’re learning it" /></label>
      <label className="sk-field"><span>What you already know</span><textarea rows={3} value={background} maxLength={2000} onChange={(e) => setBackground(e.target.value)} placeholder="Helps the AI plan from where you are" /></label>
      <label className="sk-field sk-narrow-field"><span>Hours a week</span><input type="number" min={0} max={80} value={hours} onChange={(e) => setHours(e.target.value)} /></label>
      {error && <ErrorNote>{error}</ErrorNote>}
      <div className="sk-actions">
        <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
        <button type="button" className="sk-text-btn" onClick={onDone}>Cancel</button>
      </div>
    </form>
  );
}
