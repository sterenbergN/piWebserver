'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { addDays, localToday } from '@/lib/habits/dates';
import type { BoardSummary } from '@/lib/skills/model';
import type { ScheduledSkillTask } from '@/lib/skills/types';
import { skillsPost } from './api';
import { ErrorNote } from './Ui';

function formatDayLabel(day: string, today: string): string {
  if (day === today) return 'Today';
  if (day === addDays(today, 1)) return 'Tomorrow';
  const d = new Date(`${day}T12:00:00`);
  if (Number.isNaN(d.getTime())) return day;
  return `${d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })} · ${day}`;
}

export default function SchedulePanel({
  board,
  onReload,
}: {
  board: BoardSummary;
  onReload: () => Promise<void>;
}) {
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [adding, setAdding] = useState(false);

  const today = localToday();
  const [subjectId, setSubjectId] = useState(() => board.subjects.find((s) => s.status !== 'paused')?.id ?? board.subjects[0]?.id ?? '');
  const [title, setTitle] = useState('');
  const [day, setDay] = useState(today);
  const [amount, setAmount] = useState('');
  const [minutes, setMinutes] = useState('30');
  const [detail, setDetail] = useState('');

  const subjectMap = useMemo(
    () => new Map(board.subjects.map((s) => [s.id, s])),
    [board.subjects],
  );

  const activeSubjectId = subjectMap.has(subjectId)
    ? subjectId
    : (board.subjects.find((s) => s.status !== 'paused')?.id ?? board.subjects[0]?.id ?? '');

  const { todayTasks, upcomingDays, completedTasks, shiftedDays, shiftedFrom } = board.schedule;
  const remainingToday = todayTasks.filter((t) => !t.done).length;
  const todayMinutes = todayTasks.filter((t) => !t.done).reduce((sum, t) => sum + (t.minutes ?? 0), 0);
  const upcomingTaskCount = upcomingDays.reduce((sum, d) => sum + d.tasks.length, 0);

  async function run(key: string, action: string, payload: Record<string, unknown> = {}) {
    if (busyKey) return false;
    setBusyKey(key);
    setError('');
    try {
      await skillsPost(action, payload);
      await onReload();
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not update schedule. Try again.');
      return false;
    } finally {
      setBusyKey(null);
    }
  }

  async function submitNewTask(e: React.FormEvent) {
    e.preventDefault();
    if (!activeSubjectId || !title.trim()) return;
    const minsNum = Number(minutes);
    const ok = await run('add-task', 'add-schedule-task', {
      subjectId: activeSubjectId,
      title: title.trim(),
      day: day || today,
      ...(amount.trim() ? { amount: amount.trim() } : {}),
      ...(Number.isFinite(minsNum) && minsNum > 0 ? { minutes: Math.round(minsNum) } : {}),
      ...(detail.trim() ? { detail: detail.trim() } : {}),
    });
    if (ok) {
      setTitle('');
      setAmount('');
      setDetail('');
      setMinutes('30');
      setDay(today);
      setAdding(false);
    }
  }

  function renderTask(task: ScheduledSkillTask) {
    const subj = subjectMap.get(task.subjectId);
    const isBusy = busyKey === `toggle:${task.id}` || busyKey === `del:${task.id}`;
    return (
      <li key={task.id} className={`sk-sched-task${task.done ? ' is-done' : ''}`}>
        <label className="sk-sched-check">
          <input
            type="checkbox"
            checked={!!task.done}
            disabled={!!busyKey}
            aria-label={`Mark "${task.title}" ${task.done ? 'incomplete' : 'done'}`}
            onChange={() => void run(`toggle:${task.id}`, 'toggle-schedule-task', { taskId: task.id })}
          />
        </label>
        <div className="sk-sched-task-body">
          <div className="sk-sched-task-top">
            <Link href={`/skills/${task.subjectId}`} className="sk-sched-skill">
              <span aria-hidden>{subj?.icon ?? '🎯'}</span> {subj?.name ?? 'Skill'}
            </Link>
            <strong className="sk-sched-task-title">{task.title}</strong>
            {task.amount && <span className="sk-chip sk-sched-amount">{task.amount}</span>}
            {task.minutes && <span className="sk-chip sk-sched-mins">{task.minutes}m</span>}
            {task.stepId && <span className="sk-sched-sync-tag" title="Synced with skill steps">⇄ step</span>}
          </div>
          {task.detail && <p className="sk-hint sk-sched-detail">{task.detail}</p>}
        </div>
        <button
          type="button"
          className="sk-text-btn is-danger sk-sched-del"
          disabled={isBusy || !!busyKey}
          aria-label={`Remove "${task.title}" from schedule`}
          onClick={() => void run(`del:${task.id}`, 'remove-schedule-task', { taskId: task.id })}
        >
          ✕
        </button>
      </li>
    );
  }

  return (
    <section className="sk-card sk-sched-panel" aria-labelledby="sk-sched-heading">
      <div className="sk-card-head">
        <div>
          <h2 id="sk-sched-heading">Study Schedule &amp; Today&apos;s Queue</h2>
          <p className="sk-hint">
            {todayTasks.length > 0
              ? `${remainingToday} of ${todayTasks.length} task${todayTasks.length === 1 ? '' : 's'} left today${todayMinutes > 0 ? ` · ~${todayMinutes} min remaining` : ''}`
              : 'No tasks scheduled for today yet.'}
          </p>
        </div>
        <div className="sk-actions">
          <button
            type="button"
            className="sk-small-btn"
            disabled={!!busyKey || board.subjects.length === 0}
            onClick={() => void run('rebuild', 'rebuild-schedule-from-steps', { hoursPerDay: 1, keepCompleted: true })}
          >
            {busyKey === 'rebuild' ? 'Rebuilding…' : '⚡ Rebuild from skill steps'}
          </button>
          <Link href="/skills/plan" className="sk-small-btn sk-sched-ai-link">
            🤖 Interconnected AI Plan →
          </Link>
        </div>
      </div>

      {shiftedDays > 0 && (
        <div className="sk-sched-shift-banner" role="status">
          <p>
            Paused days carried forward: tasks from <strong>{shiftedFrom ?? 'an earlier day'}</strong> shifted ahead{' '}
            <strong>{shiftedDays} day{shiftedDays === 1 ? '' : 's'}</strong> into today&apos;s queue to keep your learning order intact.
          </p>
          <button
            type="button"
            className="sk-small-btn"
            disabled={!!busyKey}
            onClick={() => void run('shift', 'shift-schedule')}
          >
            {busyKey === 'shift' ? 'Saving…' : 'Save shifted dates'}
          </button>
        </div>
      )}

      {error && <ErrorNote>{error}</ErrorNote>}

      <div className="sk-sched-today">
        <div className="sk-sched-subhead">
          <h3>Today&apos;s Study Queue</h3>
          {board.subjects.length > 0 && (
            <button
              type="button"
              className="sk-text-btn"
              aria-expanded={adding}
              onClick={() => setAdding(!adding)}
            >
              {adding ? 'Close' : '+ Add task'}
            </button>
          )}
        </div>

        {adding && (
          <form className="sk-sched-add-form" onSubmit={submitNewTask}>
            <div className="sk-grid-2">
              <label className="sk-field">
                <span>Skill</span>
                <select value={activeSubjectId} onChange={(e) => setSubjectId(e.target.value)} required>
                  {board.subjects.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.icon} {s.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="sk-field">
                <span>Day</span>
                <input type="date" value={day} onChange={(e) => setDay(e.target.value)} required />
              </label>
            </div>
            <div className="sk-grid-3">
              <label className="sk-field sk-sched-title-field">
                <span>Task title</span>
                <input
                  value={title}
                  maxLength={200}
                  required
                  placeholder="e.g. Read Ch. 1-2 & solve 5 exercises"
                  onChange={(e) => setTitle(e.target.value)}
                />
              </label>
              <label className="sk-field">
                <span>Amount (optional)</span>
                <input
                  value={amount}
                  maxLength={160}
                  placeholder="e.g. Ch. 1–2 (pp. 1–42)"
                  onChange={(e) => setAmount(e.target.value)}
                />
              </label>
              <label className="sk-field">
                <span>Minutes</span>
                <input
                  type="number"
                  min={5}
                  max={600}
                  value={minutes}
                  onChange={(e) => setMinutes(e.target.value)}
                />
              </label>
            </div>
            <label className="sk-field">
              <span>Notes / detail (optional)</span>
              <input
                value={detail}
                maxLength={600}
                placeholder="Key focus or deliverable"
                onChange={(e) => setDetail(e.target.value)}
              />
            </label>
            <div className="sk-actions">
              <button type="submit" className="btn btn-primary" disabled={!!busyKey || !title.trim()}>
                {busyKey === 'add-task' ? 'Adding…' : 'Add to schedule'}
              </button>
              <button type="button" className="sk-text-btn" onClick={() => setAdding(false)}>
                Cancel
              </button>
            </div>
          </form>
        )}

        {todayTasks.length > 0 ? (
          <ul className="sk-sched-list">
            {todayTasks.map(renderTask)}
          </ul>
        ) : (
          <p className="sk-empty sk-sched-empty">
            Nothing queued for today. Click <strong>Rebuild from skill steps</strong>, add a quick task above, or build an{' '}
            <Link href="/skills/plan">Interconnected AI Plan</Link>.
          </p>
        )}
      </div>

      {upcomingDays.length > 0 && (
        <details className="sk-sched-upcoming">
          <summary>
            Upcoming schedule ({upcomingDays.length} day{upcomingDays.length === 1 ? '' : 's'} · {upcomingTaskCount} task{upcomingTaskCount === 1 ? '' : 's'})
          </summary>
          <div className="sk-sched-upcoming-days">
            {upcomingDays.map((group) => (
              <div key={group.day} className="sk-sched-day-group">
                <div className="sk-sched-day-head">
                  <strong>{formatDayLabel(group.day, today)}</strong>
                  {group.totalMinutes > 0 && <span className="sk-muted">~{group.totalMinutes} min</span>}
                </div>
                <ul className="sk-sched-list">
                  {group.tasks.map(renderTask)}
                </ul>
              </div>
            ))}
          </div>
        </details>
      )}

      {completedTasks.length > 0 && (
        <p className="sk-hint sk-sched-done-count">
          {completedTasks.length} scheduled task{completedTasks.length === 1 ? '' : 's'} completed across your schedule.
        </p>
      )}
    </section>
  );
}
