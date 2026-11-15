'use client';

import { useId, useMemo, useState } from 'react';
import { SUBJECT_STATUSES, STATUS_LABEL, type SubjectStatus } from '@/lib/skills/types';
import { fmtLevel, skillsPost } from '../api';
import { ErrorNote, LevelPicker } from '../Ui';
import type { TabProps } from './shared';

// The inline editor under the subject's header. One form, one save.

export default function SubjectEditor({ data, reload, onDone, onDelete, deleting }: TabProps & { onDone: () => void; onDelete?: () => void; deleting?: boolean }) {
  const s = data.subject;
  const uid = useId();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [name, setName] = useState(s.name);
  const [icon, setIcon] = useState(s.icon);
  const [area, setArea] = useState(s.area);
  const [status, setStatus] = useState<SubjectStatus>(s.status);
  const [target, setTarget] = useState(s.target);
  const [goal, setGoal] = useState(s.goal ?? '');
  const [background, setBackground] = useState(s.background ?? '');
  const [hours, setHours] = useState(s.hoursPerWeek ? String(s.hoursPerWeek) : '');
  const [weekly, setWeekly] = useState(!!s.autoTopUp);
  const [parentIds, setParentIds] = useState<string[]>(() => s.parentIds ?? []);

  const otherSubjects = useMemo(
    () => (data.allSubjects ?? []).filter((other) => other.id !== s.id).sort((a, b) => a.name.localeCompare(b.name)),
    [data.allSubjects, s.id],
  );

  const cycleRiskIds = useMemo(() => {
    const byId = new Map((data.allSubjects ?? []).map((item) => [item.id, item]));
    const risky = new Set<string>();
    for (const candidate of otherSubjects) {
      const visited = new Set<string>();
      const stack = [candidate.id];
      while (stack.length) {
        const cur = stack.pop()!;
        if (cur === s.id) {
          risky.add(candidate.id);
          break;
        }
        if (visited.has(cur)) continue;
        visited.add(cur);
        for (const pid of byId.get(cur)?.parentIds ?? []) {
          if (!visited.has(pid)) stack.push(pid);
        }
      }
    }
    return risky;
  }, [data.allSubjects, otherSubjects, s.id]);

  function toggleParent(pid: string) {
    setParentIds((prev) => (prev.includes(pid) ? prev.filter((id) => id !== pid) : [...prev, pid]));
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await skillsPost('edit-subject', {
        subjectId: s.id,
        changes: { name, icon, area, status, target, goal, background, hoursPerWeek: hours, autoTopUp: weekly },
      });
      if (data.allSubjects !== undefined || parentIds.length > 0 || (s.parentIds?.length ?? 0) > 0) {
        await skillsPost('set-parents', { subjectId: s.id, parentIds });
      }
      await reload();
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong. Try again.');
    } finally {
      setBusy(false);
    }
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

      {otherSubjects.length > 0 && (
        <fieldset className="sk-parent-pick">
          <legend>Builds on</legend>
          <p className="sk-hint">The skills this one needs first. They come earlier in your schedule, and the graph links them.</p>
          <div className="sk-parent-grid">
            {otherSubjects.map((other) => {
              const checked = parentIds.includes(other.id);
              const cycleRisk = !checked && cycleRiskIds.has(other.id);
              return (
                <label key={other.id} className={`sk-parent-option${checked ? ' is-on' : ''}${cycleRisk ? ' is-disabled' : ''}`}>
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={cycleRisk}
                    onChange={() => toggleParent(other.id)}
                  />
                  <span aria-hidden>{other.icon}</span>
                  <span className="sk-parent-label">
                    <strong>{other.name}</strong>
                    <small>{other.area} · {fmtLevel(other.level)}{cycleRisk ? ' (subskill)' : ''}</small>
                  </span>
                </label>
              );
            })}
          </div>
        </fieldset>
      )}

      <label className="sk-weekly">
        <input type="checkbox" checked={weekly} onChange={(e) => setWeekly(e.target.checked)} />
        <span><strong>Weekly questions</strong><small>Let the weekly question writer add questions where this subject runs low.</small></span>
      </label>
      {error && <ErrorNote>{error}</ErrorNote>}
      <div className="sk-actions">
        <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
        <button type="button" className="sk-text-btn" onClick={onDone}>Cancel</button>
        {onDelete && <><span className="sk-grow" /><button type="button" className="sk-text-btn is-danger" disabled={deleting} onClick={onDelete}>Delete subject</button></>}
      </div>
    </form>
  );
}
