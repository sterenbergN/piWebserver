'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { useSitePopup } from '@/components/SitePopup';
import SignInPrompt from '@/components/journal/SignInPrompt';
import { ExamHelpView, useExamHelp } from '@/components/study/ExamHelpBanner';
import { usePlan } from '@/components/study/usePlan';
import { addDays, weekStart, type DateKey } from '@/lib/habits/dates';
import {
  calendarInbox, DEADLINE_KINDS, dayPlan, KIND_ICON, KIND_LABEL, MAX_PANCAKES, openTasks, upcoming,
  type Deadline, type DeadlineKind, type DeadlineView, type PlanTask,
} from '@/lib/study/plan';

// The plan: what's coming up and how long is left, the work toward each date, and
// a calendar of it all. Today's plate itself lives on PA Today.

type Planner = ReturnType<typeof usePlan>;
const SIZES = [1, 2, 3, 4, 5, 8];
const fmt = (key: string, options: Intl.DateTimeFormatOptions = { weekday: 'short', month: 'short', day: 'numeric' }) => new Date(`${key}T12:00:00`).toLocaleDateString(undefined, options);
const countdown = (days: number) => (days === 0 ? 'Today' : days === 1 ? 'Tomorrow' : `${days} days`);

function SizePicker({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  return (
    <div className="sd-sizes" role="radiogroup" aria-label="How many pancakes it’s worth">
      {SIZES.map((n) => <button key={n} type="button" role="radio" aria-checked={value === n} onClick={() => onChange(n)}>{n} 🥞</button>)}
      <input type="number" min={1} max={MAX_PANCAKES} value={value} aria-label="Or type a number" onChange={(e) => onChange(Math.max(1, Math.min(MAX_PANCAKES, Number(e.target.value) || 1)))} />
    </div>
  );
}

/** Add work: a name and a rough size. Tying it to a test means handing that test in eats it. */
function WorkForm({ planner, deadlineId, onDone }: { planner: Planner; deadlineId?: string; onDone: () => void }) {
  const [title, setTitle] = useState('');
  const [size, setSize] = useState(2);
  const [testId, setTestId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const tests = planner.data?.tests ?? [];
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const test = tests.find((t) => t.id === testId);
      await planner.post('add-task', { title: title.trim() || (test ? `Take ${test.title}` : ''), pancakes: size, deadlineId, testId });
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That didn’t save.');
      setBusy(false);
    }
  };
  return (
    <form className="sd-inline-form" onSubmit={submit}>
      <div className="sd-fields">
        <label className="sd-wide">The work
          <input value={title} autoFocus maxLength={160} placeholder="Heart failure lectures" onChange={(e) => setTitle(e.target.value)} />
        </label>
      </div>
      <p className="sd-setup-title">Rough size</p>
      <SizePicker value={size} onChange={setSize} />
      {tests.length > 0 && (
        <div className="sd-fields">
          <label className="sd-wide">Taking a test? (optional)
            <select value={testId} onChange={(e) => setTestId(e.target.value)}>
              <option value="">No test</option>
              {tests.map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}
            </select>
          </label>
        </div>
      )}
      {testId && <p className="hb-hint">Handing in that test eats these pancakes by itself.</p>}
      {error && <p className="sd-warning" role="alert">{error}</p>}
      <div className="sd-actions">
        <button type="submit" className="btn btn-primary" disabled={busy}>Add to the plan</button>
        <button type="button" className="hb-text-btn" disabled={busy} onClick={onDone}>Cancel</button>
      </div>
    </form>
  );
}

function DateForm({ planner, deadline, onDone }: { planner: Planner; deadline?: Deadline; onDone: () => void }) {
  const [title, setTitle] = useState(deadline?.title ?? '');
  const [kind, setKind] = useState<DeadlineKind>(deadline?.kind ?? 'exam');
  const [dueOn, setDueOn] = useState(deadline?.dueOn ?? '');
  const [course, setCourse] = useState(deadline?.course ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await planner.post(deadline ? 'edit-deadline' : 'add-deadline', { id: deadline?.id, title, kind, dueOn, course });
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That didn’t save.');
      setBusy(false);
    }
  };
  return (
    <form className={deadline ? 'sd-inline-form' : 'sd-card sd-inline-form'} onSubmit={submit}>
      {!deadline && <h2>Add a date</h2>}
      <div className="sd-fields">
        <label className="sd-wide">Name
          <input value={title} autoFocus maxLength={120} placeholder="Cardiology exam" onChange={(e) => setTitle(e.target.value)} />
        </label>
        <label>Kind
          <select value={kind} onChange={(e) => setKind(e.target.value as DeadlineKind)}>
            {DEADLINE_KINDS.map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
          </select>
        </label>
        <label>Date
          <input type="date" value={dueOn} onChange={(e) => setDueOn(e.target.value)} />
        </label>
        <label className="sd-wide">Class (optional)
          <input value={course} maxLength={80} placeholder="Clinical Medicine II" onChange={(e) => setCourse(e.target.value)} />
        </label>
      </div>
      {deadline?.calendarUid && <p className="hb-hint">This came from your calendar, so a change there will replace a date you set here.</p>}
      {error && <p className="sd-warning" role="alert">{error}</p>}
      <div className="sd-actions">
        <button type="submit" className="btn btn-primary" disabled={busy}>Save</button>
        <button type="button" className="hb-text-btn" disabled={busy} onClick={onDone}>Cancel</button>
      </div>
    </form>
  );
}

function TaskLine({ task, planner, today }: { task: PlanTask; planner: Planner; today: DateKey }) {
  const { confirm, popup } = useSitePopup();
  const [error, setError] = useState('');
  const left = task.pancakes - task.eaten;
  const nextDay = Object.keys(task.plate).filter((d) => d >= today).sort()[0];
  const resize = (by: number) => planner.post('edit-task', { id: task.id, pancakes: task.pancakes + by }).catch((e) => setError(e.message));
  const remove = async () => {
    if (await confirm({ title: 'Remove this work?', message: `“${task.title}” comes off your plan.`, confirmLabel: 'Remove', danger: true })) planner.post('remove-task', { id: task.id }).catch((e) => setError(e.message));
  };
  return (
    <li className="sd-task">
      {popup}
      <span className="sd-test-main">
        <strong className={left ? '' : 'is-done'}>{left ? '' : '✓ '}{task.title}</strong>
        <small>{task.eaten} of {task.pancakes} eaten{left && nextDay ? ` · next ${nextDay === today ? 'today' : fmt(nextDay)}` : ''}{task.testId ? ' · tied to a test' : ''}</small>
        {error && <small className="sd-warning" role="alert">{error}</small>}
      </span>
      <span className="sd-actions">
        <button type="button" className="hb-small-btn" aria-label={`One fewer pancake for ${task.title}`} disabled={task.pancakes <= Math.max(1, task.eaten)} onClick={() => resize(-1)}>−</button>
        <button type="button" className="hb-small-btn" aria-label={`One more pancake for ${task.title}`} disabled={task.pancakes >= MAX_PANCAKES} onClick={() => resize(1)}>+</button>
        <button type="button" className="hb-text-btn sd-danger-link" onClick={remove}>Remove</button>
      </span>
    </li>
  );
}

function DeadlineCard({ view, planner, today, help }: { view: DeadlineView; planner: Planner; today: DateKey; help: ReturnType<typeof useExamHelp> }) {
  const { confirm, popup } = useSitePopup();
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState('');
  const { deadline, daysLeft, tasks, left, pancakes, eaten } = view;
  const perDay = planner.data!.plan.settings.perDay;
  const remove = async () => {
    const work = tasks.length ? ` Its ${tasks.length} piece${tasks.length === 1 ? '' : 's'} of work go too.` : '';
    if (await confirm({ title: 'Remove this date?', message: `“${deadline.title}” comes off your plan.${work}`, confirmLabel: 'Remove', danger: true })) planner.post('remove-deadline', { id: deadline.id }).catch((e) => setError(e.message));
  };
  const askHelp = async () => {
    const ok = await confirm({
      title: 'Ask the household for help?',
      message: `Your chores due by ${fmt(deadline.dueOn)} move to the rest of your household, and everyone sees it on Today, Chores and the meal plan. They go back after the exam.`,
      confirmLabel: 'Ask for help',
    });
    if (ok) help.act('start', deadline.id).catch((e) => setError(e.message));
  };
  const close = deadline.kind === 'exam' || deadline.kind === 'practical';
  return (
    <li className={`sd-card sd-deadline${daysLeft <= 3 ? ' is-soon' : ''}`}>
      {popup}
      <div className="sd-deadline-head">
        <div className="sd-countdown" aria-label={`${countdown(daysLeft)} left`}><strong>{daysLeft > 1 ? daysLeft : countdown(daysLeft)}</strong>{daysLeft > 1 && <small>days</small>}</div>
        <div className="sd-test-main">
          <strong>{KIND_ICON[deadline.kind]} {deadline.title}</strong>
          <small>{[KIND_LABEL[deadline.kind], fmt(deadline.dueOn), deadline.course].filter(Boolean).join(' · ')}</small>
        </div>
        {pancakes > 0 && <span className="td-chip">{left ? `${left} 🥞 left` : '✓ All eaten'}</span>}
      </div>
      {pancakes > 0 && (
        <div className="progress" role="progressbar" aria-label="Pancakes eaten" aria-valuemin={0} aria-valuemax={pancakes} aria-valuenow={eaten}><div style={{ width: `${(eaten / pancakes) * 100}%` }} /></div>
      )}
      {view.tooMuch && view.needPerDay !== null && (
        <p className="sd-warning">⚠️ This needs about {Math.ceil(view.needPerDay)} a day, counting anything due before it, and you planned {perDay}. There’s still time to change it.</p>
      )}
      {view.daysLate !== null && <p className="sd-warning">🐢 At your recent pace you’d finish {view.daysLate} day{view.daysLate === 1 ? '' : 's'} late.</p>}
      {pancakes === 0 && <p className="hb-hint">No work planned yet.</p>}
      {tasks.length > 0 && <ul className="sd-task-list">{tasks.map((task) => <TaskLine key={task.id} task={task} planner={planner} today={today} />)}</ul>}
      {adding && <WorkForm planner={planner} deadlineId={deadline.id} onDone={() => setAdding(false)} />}
      {editing && <DateForm planner={planner} deadline={deadline} onDone={() => setEditing(false)} />}
      {error && <p className="sd-warning" role="alert">{error}</p>}
      {!adding && !editing && (
        <div className="sd-actions">
          <button type="button" className="hb-small-btn is-primary" onClick={() => setAdding(true)}>+ Add work</button>
          <button type="button" className="hb-small-btn" onClick={() => setEditing(true)}>Edit</button>
          {close && daysLeft <= 14 && help.state?.canAsk && !help.state.help && <button type="button" className="hb-small-btn" onClick={askHelp}>Ask the household for help</button>}
          <button type="button" className="hb-text-btn sd-danger-link" onClick={remove}>Remove</button>
        </div>
      )}
    </li>
  );
}

/** What the calendar wants decided: a date that moved, one that's gone, and events to take on. */
function Asks({ planner }: { planner: Planner }) {
  const [showOthers, setShowOthers] = useState(false);
  const [error, setError] = useState('');
  const plan = planner.data!.plan;
  const gone = plan.deadlines.filter((d) => d.gone);
  const moved = plan.deadlines.filter((d) => d.movedFrom);
  const inbox = calendarInbox(plan);
  const act = (action: string, payload: Record<string, unknown>) => planner.post(action, payload).catch((e) => setError(e.message));
  if (!gone.length && !moved.length && !inbox.suggested.length && !inbox.others.length && !plan.calendar.lastError && !error) return null;
  return (
    <section className="sd-card sd-asks">
      <h2>From your calendar</h2>
      {plan.calendar.lastError && <p className="sd-warning" role="alert">⚠️ {plan.calendar.lastError} Your plan stays as it was. <Link href="/study/plan/setup">Check the connection</Link></p>}
      {error && <p className="sd-warning" role="alert">{error}</p>}
      {moved.map((d) => (
        <p key={d.id} className="sd-ask">📅 <strong>{d.title}</strong> moved from {fmt(d.movedFrom!)} to {fmt(d.dueOn)}. Its upcoming pancakes moved with it.</p>
      ))}
      {moved.length > 0 && <button type="button" className="hb-small-btn sd-self-start" onClick={() => act('clear-moved', {})}>Got it</button>}
      {gone.map((d) => (
        <div key={d.id} className="sd-ask-row">
          <span><strong>{d.title}</strong> ({fmt(d.dueOn)}) is no longer on your calendar. Was it cancelled?</span>
          <span className="sd-actions">
            <button type="button" className="hb-small-btn" onClick={() => act('edit-deadline', { id: d.id })}>Keep it</button>
            <button type="button" className="hb-small-btn" onClick={() => act('remove-deadline', { id: d.id })}>Remove it</button>
          </span>
        </div>
      ))}
      {inbox.suggested.map((event) => (
        <div key={event.uid} className="sd-ask-row">
          <span>{event.kind ? KIND_ICON[event.kind] : '📅'} <strong>{event.title}</strong> · {fmt(event.on)}</span>
          <span className="sd-actions">
            <button type="button" className="hb-small-btn is-primary" onClick={() => act('calendar-accept', { uid: event.uid })}>Add</button>
            <button type="button" className="hb-small-btn" onClick={() => act('calendar-ignore', { uid: event.uid })}>Not this</button>
          </span>
        </div>
      ))}
      {inbox.others.length > 0 && (
        showOthers ? (
          <>
            <p className="sd-setup-title">Everything else coming up</p>
            {inbox.others.slice(0, 40).map((event) => (
              <div key={event.uid} className="sd-ask-row">
                <span>{event.title} · {fmt(event.on)}</span>
                <span className="sd-actions">
                  <button type="button" className="hb-small-btn" onClick={() => act('calendar-accept', { uid: event.uid, kind: 'other' })}>Add</button>
                  <button type="button" className="hb-small-btn" onClick={() => act('calendar-ignore', { uid: event.uid })}>Not this</button>
                </span>
              </div>
            ))}
          </>
        ) : <button type="button" className="hb-text-btn sd-self-start" onClick={() => setShowOthers(true)}>See {inbox.others.length} other event{inbox.others.length === 1 ? '' : 's'}</button>
      )}
    </section>
  );
}

/** One day in the week list, or under the month when picked. */
function DayDetail({ planner, day, today }: { planner: Planner; day: DateKey; today: DateKey }) {
  const plan = planner.data!.plan;
  const info = dayPlan(plan, day, today);
  const count = info.items.reduce((n, i) => n + i.count, 0);
  const canOff = day >= today;
  return (
    <div className={`sd-day${day === today ? ' is-today' : ''}${info.off ? ' is-off' : ''}`}>
      <div className="sd-day-head">
        <strong>{day === today ? 'Today' : fmt(day)}</strong>
        <span className="sd-day-tags">
          {info.clean && <span className="td-chip">🧈 Clean plate</span>}
          {!info.clean && info.eaten > 0 && <span className="td-chip">{info.eaten} eaten</span>}
          {count > 0 && <span className="td-chip">{count} 🥞</span>}
          {info.off && <span className="td-chip">Day off</span>}
          {!info.off && !info.studyDay && <span className="td-chip">Not a study day</span>}
        </span>
      </div>
      {info.deadlines.map((d) => <p key={d.id} className="sd-day-due">{KIND_ICON[d.kind]} {d.title}</p>)}
      {info.items.length > 0 && <ul>{info.items.map(({ task, count: n, deadline }) => <li key={task.id}>{n} 🥞 {task.title}{deadline ? ` · ${deadline.title}` : ''}</li>)}</ul>}
      {canOff && (info.off
        ? <button type="button" className="hb-text-btn" onClick={() => planner.post('day-off', { day, on: false })}>Studying after all</button>
        : info.studyDay && <button type="button" className="hb-text-btn" onClick={() => planner.post('day-off', { day, on: true })}>Take this day off</button>)}
    </div>
  );
}

function CalendarView({ planner, today }: { planner: Planner; today: DateKey }) {
  const [mode, setMode] = useState<'week' | 'month'>('week');
  const [anchor, setAnchor] = useState(today);
  const [picked, setPicked] = useState(today);
  const plan = planner.data!.plan;

  const start = weekStart(anchor);
  const week = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(start, i)), [start]);
  const monthFirst = `${anchor.slice(0, 7)}-01`;
  const grid = useMemo(() => {
    const first = weekStart(monthFirst);
    return Array.from({ length: 42 }, (_, i) => addDays(first, i));
  }, [monthFirst]);
  const shiftMonth = (by: number) => {
    const [y, m] = anchor.split('-').map(Number);
    const date = new Date(Date.UTC(y, m - 1 + by, 1));
    setAnchor(date.toISOString().slice(0, 10));
  };
  const lastWeekNeeded = grid[35].slice(0, 7) === monthFirst.slice(0, 7);
  const cells = lastWeekNeeded ? grid : grid.slice(0, 35);

  return (
    <section className="sd-card sd-calendar">
      <div className="sd-card-head">
        <h2>Calendar</h2>
        <div className="sd-segments" role="radiogroup" aria-label="Calendar view">
          <button type="button" role="radio" aria-checked={mode === 'week'} onClick={() => setMode('week')}>Week</button>
          <button type="button" role="radio" aria-checked={mode === 'month'} onClick={() => setMode('month')}>Month</button>
        </div>
      </div>
      <div className="sd-cal-nav">
        <button type="button" className="hb-small-btn" aria-label={`Previous ${mode}`} onClick={() => (mode === 'week' ? setAnchor(addDays(anchor, -7)) : shiftMonth(-1))}>←</button>
        <strong>{mode === 'week' ? `${fmt(week[0], { month: 'short', day: 'numeric' })} – ${fmt(week[6], { month: 'short', day: 'numeric' })}` : fmt(monthFirst, { month: 'long', year: 'numeric' })}</strong>
        <button type="button" className="hb-small-btn" aria-label={`Next ${mode}`} onClick={() => (mode === 'week' ? setAnchor(addDays(anchor, 7)) : shiftMonth(1))}>→</button>
        {anchor !== today && <button type="button" className="hb-text-btn" onClick={() => { setAnchor(today); setPicked(today); }}>Today</button>}
      </div>
      {mode === 'week' ? (
        <div className="sd-week">{week.map((day) => <DayDetail key={day} planner={planner} day={day} today={today} />)}</div>
      ) : (
        <>
          <div className="sd-month" role="grid" aria-label="Month">
            {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => <span key={d} className="sd-month-name" aria-hidden>{d}</span>)}
            {cells.map((day) => {
              const info = dayPlan(plan, day, today);
              const count = info.items.reduce((n, i) => n + i.count, 0);
              const inMonth = day.slice(0, 7) === monthFirst.slice(0, 7);
              return (
                <button key={day} type="button" aria-pressed={picked === day} className={`${inMonth ? '' : 'is-other'}${day === today ? ' is-today' : ''}${info.off ? ' is-off' : ''}`} onClick={() => setPicked(day)}
                  aria-label={`${fmt(day)}${info.deadlines.length ? `, ${info.deadlines.map((d) => d.title).join(', ')}` : ''}${count ? `, ${count} pancakes` : ''}`}>
                  <span className="sd-month-day">{Number(day.slice(8))}</span>
                  {info.deadlines.length > 0 && <span className="sd-month-due" aria-hidden>{KIND_ICON[info.deadlines[0].kind]}{info.deadlines.length > 1 ? `+${info.deadlines.length - 1}` : ''}</span>}
                  {count > 0 && <span className="sd-month-count" aria-hidden>{count}🥞</span>}
                  {info.clean && <span className="sd-month-clean" aria-hidden>🧈</span>}
                </button>
              );
            })}
          </div>
          <DayDetail planner={planner} day={picked} today={today} />
        </>
      )}
    </section>
  );
}

export default function PlanPage() {
  const planner = usePlan();
  const help = useExamHelp();
  const { status, data, today } = planner;
  const [addingDate, setAddingDate] = useState(false);
  const [addingOpen, setAddingOpen] = useState(false);

  if (status === 'signed-out') return <div className="sd"><SignInPrompt title="Sign in to plan">Your plan is only shown to your account.</SignInPrompt></div>;

  const views = data ? upcoming(data.plan, today) : [];
  const open = data ? openTasks(data.plan, today) : [];
  const isEmpty = data && !views.length && !open.length;
  return (
    <div className="sd animate-fade-in">
      <header className="sd-head">
        <div>
          <h1>Plan</h1>
          <p>What’s coming up, and the pancakes between you and it.</p>
        </div>
        <div className="sd-actions">
          <Link className="btn btn-secondary" href="/study/plan/setup">Your week &amp; calendar</Link>
          {!addingDate && <button type="button" className="btn btn-primary" onClick={() => setAddingDate(true)}>Add a date</button>}
        </div>
      </header>

      {status === 'loading' && <p className="hb-hint">Loading…</p>}
      {status === 'error' && <div className="hb-banner is-error"><span>Couldn’t load your plan.</span><button type="button" className="hb-small-btn" onClick={() => window.location.reload()}>Try again</button></div>}

      {data && (
        <>
          <ExamHelpView helper={help} />
          <Asks planner={planner} />
          {addingDate && <DateForm planner={planner} onDone={() => setAddingDate(false)} />}

          {isEmpty && !addingDate && (
            <section className="sd-card sd-welcome">
              <h2>Get your dates in</h2>
              <ol>
                <li><Link href="/study/plan/setup">Connect your Google Calendar</Link>, and pick out the exams and due dates.</li>
                <li><Link href="/study/plan/setup#syllabus">Paste in a syllabus</Link>, for the dates and the work toward them.</li>
                <li>Or add a date by hand, with the button above.</li>
              </ol>
              <p className="hb-hint">Then give each piece of work a rough size in pancakes. They get spread over your study days, ending a day or two before an exam, and each day you have a plate to eat.</p>
            </section>
          )}

          {views.length > 0 && <ul className="sd-deadlines">{views.map((view) => <DeadlineCard key={view.deadline.id} view={view} planner={planner} today={today} help={help} />)}</ul>}

          {(open.length > 0 || !isEmpty) && (
            <section className="sd-card">
              <div className="sd-card-head">
                <h2>Work with no date</h2>
                {!addingOpen && <button type="button" className="hb-small-btn" onClick={() => setAddingOpen(true)}>+ Add work</button>}
              </div>
              {open.length > 0 ? <ul className="sd-task-list">{open.map((task) => <TaskLine key={task.id} task={task} planner={planner} today={today} />)}</ul>
                : !addingOpen && <p className="hb-hint">Anything here gets spread over the next two weeks.</p>}
              {addingOpen && <WorkForm planner={planner} onDone={() => setAddingOpen(false)} />}
            </section>
          )}

          <CalendarView planner={planner} today={today} />
        </>
      )}
    </div>
  );
}
