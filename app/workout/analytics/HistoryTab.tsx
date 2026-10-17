'use client';

import { useMemo, useState } from 'react';
import { rirLabel } from '@/components/workout/SetEditSheet';
import { calcAverage1RM } from '@/lib/workout/analytics';
import { localDayKey, weekStart, type Workout } from '@/lib/workout/insights';
import { compact } from './charts';
import { createWorkoutLink, shareLink } from '@/lib/workout/share-link';

type HistoryTabProps = {
  history: Workout[];
  lifts: Record<string, { name?: string }>;
  gymNames: Map<string, string>;
  canDelete: boolean;
  onDelete: (id: string) => void;
};

const WEEKS_PER_PAGE = 8;

const nameOf = (w: Workout, id: string, lifts: HistoryTabProps['lifts']) => w.liftMeta?.[id]?.name || lifts[id]?.name || 'Lift';

function stats(w: Workout) {
  let sets = 0;
  let volume = 0;
  for (const list of Object.values(w.logs || {})) {
    for (const s of list || []) {
      if (Number(s.reps) > 0) { sets++; volume += (Number(s.weight) || 0) * Number(s.reps); }
    }
  }
  return { sets, volume };
}

/** Every saved workout, newest first, grouped by week; tap one for its sets. */
export default function HistoryTab({ history, lifts, gymNames, canDelete, onDelete }: HistoryTabProps) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const [pages, setPages] = useState(1);
  const [linkNote, setLinkNote] = useState<{ id: string; text: string } | null>(null);
  const q = query.trim().toLowerCase();

  const sendLink = async (w: Workout) => {
    setLinkNote({ id: w.id!, text: 'Making link…' });
    try {
      const url = await createWorkoutLink({ historyId: w.id! });
      const result = await shareLink(url, `${w.type?.name || 'Workout'} — do it with me`);
      setLinkNote({ id: w.id!, text: result === 'copied' ? 'Link copied — send it to a friend.' : result === 'shared' ? 'Link sent.' : '' });
    } catch (err) {
      setLinkNote({ id: w.id!, text: err instanceof Error ? err.message : 'Could not create the link' });
    }
  };

  const weeks = useMemo(() => {
    const matches = [...history]
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
      .filter((w) => !q || [w.type?.name, w.name, w.gymName, gymNames.get(w.gymId || ''), ...Object.keys(w.logs || {}).map((id) => nameOf(w, id, lifts))]
        .some((text) => (text || '').toLowerCase().includes(q)));
    const groups = new Map<string, { start: Date; workouts: Workout[] }>();
    for (const w of matches) {
      const start = weekStart(new Date(w.timestamp));
      const key = localDayKey(start);
      const group = groups.get(key) || { start, workouts: [] };
      group.workouts.push(w);
      groups.set(key, group);
    }
    return [...groups.entries()];
  }, [history, q, gymNames, lifts]);

  const shown = weeks.slice(0, pages * WEEKS_PER_PAGE);

  return (
    <div className="an-stack">
      <section className="workout-tile an-card">
        <input className="workout-input" type="search" placeholder="Search by workout, lift or gym" value={query} onChange={(e) => setQuery(e.target.value)} />
        <p className="workout-hint" style={{ margin: 0 }}>{history.length} workouts saved{q ? ` · ${weeks.reduce((n, [, g]) => n + g.workouts.length, 0)} match` : ''}</p>
      </section>

      {shown.map(([key, group]) => {
        const totals = group.workouts.reduce((acc, w) => { const s = stats(w); return { sets: acc.sets + s.sets, volume: acc.volume + s.volume }; }, { sets: 0, volume: 0 });
        return (
          <section key={key} className="an-week">
            <h3 className="an-week-head">
              Week of {group.start.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
              <span>{group.workouts.length} workout{group.workouts.length === 1 ? '' : 's'} · {totals.sets} sets · {compact(totals.volume)} lb</span>
            </h3>
            <div className="workout-stack">
              {group.workouts.map((w) => {
                const id = w.id || w.timestamp;
                const s = stats(w);
                const isOpen = open === id;
                return (
                  <div key={id} className={`an-workout${isOpen ? ' is-open' : ''}`}>
                    <button type="button" className="an-workout-head" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : id)}>
                      <span className="workout-card-text">
                        <span className="workout-card-title">{w.isDeload ? '🧘 ' : ''}{w.type?.name || w.name || 'Workout'}</span>
                        <span className="workout-card-meta">
                          {new Date(w.timestamp).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}
                          {w.gymName || gymNames.get(w.gymId || '') ? ` · ${w.gymName || gymNames.get(w.gymId || '')}` : ''}
                          {` · ${s.sets} sets · ${compact(s.volume)} lb`}
                          {w.durationSecs ? ` · ${Math.round(w.durationSecs / 60)} min` : ''}
                        </span>
                      </span>
                      <span className={`workout-chevron${isOpen ? ' is-open' : ''}`} aria-hidden>›</span>
                    </button>
                    {isOpen && (
                      <div className="an-workout-body animate-fade-in">
                        {Object.entries(w.logs || {}).map(([liftId, sets]) => {
                          const valid = (sets || []).filter((set) => Number(set.reps) > 0);
                          const best = valid.reduce((m, set) => Math.max(m, calcAverage1RM(Number(set.weight) || 0, Number(set.reps))), 0);
                          return (
                            <div key={liftId} className="an-workout-lift">
                              <div className="workout-flex-between" style={{ gap: '0.5rem' }}>
                                <strong>{nameOf(w, liftId, lifts)}</strong>
                                {best > 0 && <span className="workout-hint">est. 1RM {Math.round(best)}</span>}
                              </div>
                              <span className="workout-hint">
                                {valid.map((set) => `${set.weight}×${set.reps}${typeof set.rir === 'number' ? ` @${rirLabel(set.rir)}` : ''}`).join(' · ')}
                              </span>
                            </div>
                          );
                        })}
                        {Object.keys(w.logs || {}).length === 0 && <p className="workout-hint">No sets were logged.</p>}
                        {canDelete && w.id && (
                          <div className="workout-flex-between" style={{ marginTop: '0.5rem', gap: '0.75rem' }}>
                            <button type="button" className="workout-text-btn" onClick={() => sendLink(w)}>🔗 Send to a friend</button>
                            <button type="button" className="workout-text-btn danger" onClick={() => onDelete(w.id!)}>Delete this workout</button>
                          </div>
                        )}
                        {linkNote && linkNote.id === w.id && linkNote.text && <p className="workout-hint" style={{ margin: '0.3rem 0 0' }}>{linkNote.text}</p>}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        );
      })}
      {weeks.length === 0 && <p className="workout-hint" style={{ textAlign: 'center' }}>No workouts match.</p>}
      {weeks.length > shown.length && (
        <button type="button" className="workout-button is-block" onClick={() => setPages((p) => p + 1)}>Show older weeks</button>
      )}
    </div>
  );
}
