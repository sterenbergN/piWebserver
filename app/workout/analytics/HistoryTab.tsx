'use client';

import { useMemo, useState } from 'react';
import { rirLabel } from '@/components/workout/SetEditSheet';
import { calcAverage1RM } from '@/lib/workout/analytics';
import { exerciseKey } from '@/lib/workout/exercises';
import { localDayKey, weekStart, type Workout } from '@/lib/workout/insights';
import { readPref, savePref } from '@/lib/workout/device-prefs';
import { compact } from './charts';
import { createWorkoutLink, shareLink } from '@/lib/workout/share-link';
import { cardDataForWorkout, renderWorkoutCard, type CardFormat } from '@/lib/workout/share-card';
import ShareViewer from '@/components/workout/ShareViewer';
import EditWorkoutSheet from './EditWorkoutSheet';

type HistoryTabProps = {
  history: Workout[];
  lifts: Record<string, { name?: string; exercise?: string }>;
  gymNames: Map<string, string>;
  /** Logged in (not the demo): workouts can be edited, deleted and sent. */
  canEdit: boolean;
  onDelete: (id: string) => void;
  onUpdated: (workout: Workout) => void;
  /** Open an exercise on the Lifts tab. */
  onOpenLift: (key: string) => void;
};

type View = 'list' | 'calendar';

const WEEKS_PER_PAGE = 8;
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const CARD_FORMATS = [{ key: 'post', label: 'Post 4:5' }, { key: 'story', label: 'Story 9:16' }];

const nameOf = (w: Workout, id: string, lifts: HistoryTabProps['lifts']) => w.liftMeta?.[id]?.name || lifts[id]?.name || 'Lift';
const typeOf = (w: Workout) => w.type?.name || w.name || 'Workout';
const gymOf = (w: Workout, gymNames: Map<string, string>) => w.gymName || gymNames.get(w.gymId || '') || '';

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

/** Every saved workout, newest first, grouped by week or on a calendar; tap one for its sets. */
export default function HistoryTab({ history, lifts, gymNames, canEdit, onDelete, onUpdated, onOpenLift }: HistoryTabProps) {
  const [query, setQuery] = useState('');
  const [gym, setGym] = useState('');
  const [type, setType] = useState('');
  const [view, setView] = useState<View>(() => (readPref('workout:historyView') === 'calendar' ? 'calendar' : 'list'));
  const [month, setMonth] = useState<Date | null>(null);
  const [day, setDay] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [pages, setPages] = useState(1);
  const [linkNote, setLinkNote] = useState<{ id: string; text: string } | null>(null);
  const [cardFor, setCardFor] = useState<Workout | null>(null);
  const [editing, setEditing] = useState<Workout | null>(null);
  const q = query.trim().toLowerCase();

  const chooseView = (next: View) => { setView(next); savePref('workout:historyView', next); };

  const sendLink = async (w: Workout) => {
    setLinkNote({ id: w.id!, text: 'Making link…' });
    try {
      const url = await createWorkoutLink({ historyId: w.id! });
      const result = await shareLink(url, `${typeOf(w)} — do it with me`);
      setLinkNote({ id: w.id!, text: result === 'copied' ? 'Link copied — send it to a friend.' : result === 'shared' ? 'Link sent.' : '' });
    } catch (err) {
      setLinkNote({ id: w.id!, text: err instanceof Error ? err.message : 'Could not create the link' });
    }
  };

  // Filter chips only show when there's more than one to choose from.
  const options = useMemo(() => ({
    gyms: [...new Set(history.map((w) => gymOf(w, gymNames)).filter(Boolean))].sort(),
    types: [...new Set(history.map(typeOf))].sort(),
  }), [history, gymNames]);

  // A filter whose last workout was deleted or edited away stops applying.
  const gymFilter = options.gyms.includes(gym) ? gym : '';
  const typeFilter = options.types.includes(type) ? type : '';
  const matches = useMemo(() => [...history]
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
    .filter((w) => (!gymFilter || gymOf(w, gymNames) === gymFilter) && (!typeFilter || typeOf(w) === typeFilter))
    .filter((w) => !q || [typeOf(w), w.name, gymOf(w, gymNames), ...Object.keys(w.logs || {}).map((id) => nameOf(w, id, lifts))]
      .some((text) => (text || '').toLowerCase().includes(q))),
  [history, q, gymFilter, typeFilter, gymNames, lifts]);

  const weeks = useMemo(() => {
    const groups = new Map<string, { start: Date; workouts: Workout[] }>();
    for (const w of matches) {
      const start = weekStart(new Date(w.timestamp));
      const key = localDayKey(start);
      const group = groups.get(key) || { start, workouts: [] };
      group.workouts.push(w);
      groups.set(key, group);
    }
    return [...groups.entries()];
  }, [matches]);

  const byDay = useMemo(() => {
    const map = new Map<string, Workout[]>();
    for (const w of matches) {
      const key = localDayKey(new Date(w.timestamp));
      map.set(key, [...(map.get(key) || []), w]);
    }
    return map;
  }, [matches]);

  const shown = weeks.slice(0, pages * WEEKS_PER_PAGE);
  const shownMonth = month || (matches[0] ? new Date(matches[0].timestamp) : new Date());

  const renderWorkout = (w: Workout) => {
    const id = w.id || w.timestamp;
    const s = stats(w);
    const isOpen = open === id;
    return (
      <div key={id} className={`an-workout${isOpen ? ' is-open' : ''}`}>
        <button type="button" className="an-workout-head" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : id)}>
          <span className="workout-card-text">
            <span className="workout-card-title">{w.isDeload ? '🧘 ' : ''}{typeOf(w)}</span>
            <span className="workout-card-meta">
              {new Date(w.timestamp).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}
              {gymOf(w, gymNames) ? ` · ${gymOf(w, gymNames)}` : ''}
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
              const key = exerciseKey({ ...lifts[liftId], ...w.liftMeta?.[liftId] }) || liftId;
              return (
                <div key={liftId} className="an-workout-lift">
                  <div className="workout-flex-between" style={{ gap: '0.5rem' }}>
                    <button type="button" className="an-lift-link" onClick={() => onOpenLift(key)}>{nameOf(w, liftId, lifts)} <span aria-hidden>›</span></button>
                    {best > 0 && <span className="workout-hint">est. 1RM {Math.round(best)}</span>}
                  </div>
                  <span className="workout-hint">
                    {valid.map((set) => `${set.weight}×${set.reps}${typeof set.rir === 'number' ? ` @${rirLabel(set.rir)}` : ''}`).join(' · ')}
                  </span>
                </div>
              );
            })}
            {Object.keys(w.logs || {}).length === 0 && <p className="workout-hint">No sets were logged.</p>}
            <div className="an-workout-actions">
              {s.sets > 0 && <button type="button" className="workout-button is-small" onClick={() => setCardFor(w)}>📸 Share card</button>}
              {canEdit && w.id && (<>
                <button type="button" className="workout-button is-small" onClick={() => sendLink(w)}>🔗 Send</button>
                <button type="button" className="workout-button is-small" onClick={() => setEditing(w)}>✏️ Edit</button>
                <button type="button" className="workout-text-btn danger" onClick={() => onDelete(w.id!)}>Delete</button>
              </>)}
            </div>
            {linkNote && linkNote.id === w.id && linkNote.text && <p className="workout-hint" style={{ margin: '0.3rem 0 0' }}>{linkNote.text}</p>}
          </div>
        )}
      </div>
    );
  };

  const calendar = () => {
    const first = new Date(shownMonth.getFullYear(), shownMonth.getMonth(), 1);
    const daysInMonth = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
    const lead = (first.getDay() + 6) % 7; // Monday first
    const today = localDayKey(new Date());
    const inMonth = matches.filter((w) => {
      const d = new Date(w.timestamp);
      return d.getFullYear() === first.getFullYear() && d.getMonth() === first.getMonth();
    });
    const monthSets = inMonth.reduce((n, w) => n + stats(w).sets, 0);
    const moveMonth = (delta: number) => { setMonth(new Date(first.getFullYear(), first.getMonth() + delta, 1)); setDay(null); };
    const dayWorkouts = day ? byDay.get(day) || [] : [];
    return (<>
      <section className="workout-tile an-card an-calendar">
        <div className="an-calendar-head">
          <button type="button" className="workout-icon-btn" aria-label="Previous month" onClick={() => moveMonth(-1)}>‹</button>
          <div>
            <strong>{first.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}</strong>
            <span className="workout-hint">{inMonth.length} workout{inMonth.length === 1 ? '' : 's'} · {monthSets} sets</span>
          </div>
          <button type="button" className="workout-icon-btn" aria-label="Next month" onClick={() => moveMonth(1)}>›</button>
        </div>
        <div className="an-calendar-grid" role="grid">
          {WEEKDAYS.map((d) => <span key={d} className="an-calendar-weekday">{d.slice(0, 1)}</span>)}
          {Array.from({ length: lead }, (_, i) => <span key={`lead-${i}`} />)}
          {Array.from({ length: daysInMonth }, (_, i) => {
            const key = localDayKey(new Date(first.getFullYear(), first.getMonth(), i + 1));
            const count = byDay.get(key)?.length || 0;
            const classes = ['an-calendar-day', count ? 'has-workout' : '', key === today ? 'is-today' : '', key === day ? 'is-selected' : ''].filter(Boolean).join(' ');
            return (
              <button
                key={key}
                type="button"
                className={classes}
                disabled={!count}
                aria-pressed={key === day}
                aria-label={`${new Date(first.getFullYear(), first.getMonth(), i + 1).toLocaleDateString(undefined, { month: 'long', day: 'numeric' })}${count ? `, ${count} workout${count === 1 ? '' : 's'}` : ''}`}
                onClick={() => { setDay(key === day ? null : key); setOpen((byDay.get(key) || [])[0]?.id || null); }}
              >
                {i + 1}
                {count > 1 && <small>{count}</small>}
              </button>
            );
          })}
        </div>
      </section>
      {day ? (
        <div className="workout-stack">{dayWorkouts.map(renderWorkout)}</div>
      ) : (
        <p className="workout-hint" style={{ textAlign: 'center', margin: 0 }}>{inMonth.length ? 'Tap a highlighted day to see its workout.' : 'No workouts this month.'}</p>
      )}
    </>);
  };

  return (
    <div className="an-stack">
      <section className="workout-tile an-card an-history-filters">
        <div className="an-history-search">
          <input className="workout-input" type="search" placeholder="Search by workout, lift or gym" value={query} onChange={(e) => setQuery(e.target.value)} />
          <div className="an-view-toggle" role="radiogroup" aria-label="View">
            <button type="button" role="radio" aria-checked={view === 'list'} aria-label="List" onClick={() => chooseView('list')}>☰</button>
            <button type="button" role="radio" aria-checked={view === 'calendar'} aria-label="Calendar" onClick={() => chooseView('calendar')}>📅</button>
          </div>
        </div>
        {options.types.length > 1 && (
          <div className="an-periods" role="radiogroup" aria-label="Workout type">
            {['', ...options.types].map((t) => (
              <button key={t || 'all'} type="button" role="radio" aria-checked={typeFilter === t} onClick={() => setType(t)}>{t || 'All workouts'}</button>
            ))}
          </div>
        )}
        {options.gyms.length > 1 && (
          <div className="an-periods" role="radiogroup" aria-label="Gym">
            {['', ...options.gyms].map((g) => (
              <button key={g || 'all'} type="button" role="radio" aria-checked={gymFilter === g} onClick={() => setGym(g)}>{g || 'All gyms'}</button>
            ))}
          </div>
        )}
        <p className="workout-hint" style={{ margin: 0 }}>
          {history.length} workouts saved{matches.length !== history.length ? ` · ${matches.length} match` : ''}
        </p>
      </section>

      {view === 'calendar' ? calendar() : (<>
        {shown.map(([key, group]) => {
          const totals = group.workouts.reduce((acc, w) => { const s = stats(w); return { sets: acc.sets + s.sets, volume: acc.volume + s.volume }; }, { sets: 0, volume: 0 });
          return (
            <section key={key} className="an-week">
              <h3 className="an-week-head">
                Week of {group.start.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                <span>{group.workouts.length} workout{group.workouts.length === 1 ? '' : 's'} · {totals.sets} sets · {compact(totals.volume)} lb</span>
              </h3>
              <div className="workout-stack">{group.workouts.map(renderWorkout)}</div>
            </section>
          );
        })}
        {weeks.length === 0 && <p className="workout-hint" style={{ textAlign: 'center' }}>No workouts match.</p>}
        {weeks.length > shown.length && (
          <button type="button" className="workout-button is-block" onClick={() => setPages((p) => p + 1)}>Show older weeks</button>
        )}
      </>)}

      {cardFor && (
        <ShareViewer
          title={`${typeOf(cardFor)} · ${new Date(cardFor.timestamp).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`}
          options={CARD_FORMATS}
          optionPref="workout:cardFormat"
          render={async (format) => [await renderWorkoutCard(cardDataForWorkout(cardFor, history, { gymName: gymNames.get(cardFor.gymId || ''), lifts }), format as CardFormat)]}
          fileBase={`workout-${localDayKey(new Date(cardFor.timestamp))}`}
          shareTitle={typeOf(cardFor)}
          onClose={() => setCardFor(null)}
        />
      )}
      {editing && (
        <EditWorkoutSheet
          workout={editing}
          liftName={(id) => nameOf(editing, id, lifts)}
          onSaved={(w) => { onUpdated(w); setEditing(null); }}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}
