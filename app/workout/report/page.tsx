'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { monthlyStrength, weeklyReport, type ReportWorkout } from '@/lib/workout/reports';
import { DEMO_HISTORY } from '@/lib/workout/demo-data';

const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const fmt = (n: number) => n.toLocaleString();
const dateLabel = (iso: string, opts: Intl.DateTimeFormatOptions) => new Date(iso).toLocaleDateString(undefined, opts);

function Delta({ now, before, unit = '' }: { now: number; before: number; unit?: string }) {
  if (before === 0 && now === 0) return null;
  const diff = now - before;
  if (diff === 0) return <span className="workout-hint">same as before</span>;
  const up = diff > 0;
  return (
    <span style={{ fontSize: '0.75rem', fontWeight: 700, color: up ? 'var(--success)' : 'var(--muted)' }}>
      {up ? '▲' : '▼'} {fmt(Math.abs(diff))}{unit} vs last
    </span>
  );
}

function Stat({ label, now, before, unit }: { label: string; now: number; before: number; unit?: string }) {
  return (
    <div className="workout-tile" style={{ padding: '0.85rem', marginBottom: 0 }}>
      <div className="workout-hint" style={{ textTransform: 'uppercase', letterSpacing: '0.06em', fontSize: '0.65rem' }}>{label}</div>
      <div style={{ fontSize: '1.4rem', fontWeight: 800 }}>{fmt(now)}{unit}</div>
      <Delta now={now} before={before} unit={unit} />
    </div>
  );
}

export default function ReportPage() {
  const [history, setHistory] = useState<ReportWorkout[] | null>(null);
  const [isDemo, setIsDemo] = useState(false);
  const [view, setView] = useState<'week' | 'month'>('week');
  const [offset, setOffset] = useState(0); // 0 = this week/month, 1 = previous, ...
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    Promise.all([
      fetch('/api/workout/auth').then((r) => r.json()).catch(() => ({})),
      fetch('/api/workout/history').then((r) => r.json()).catch(() => ({})),
    ]).then(([auth, hist]) => {
      if (auth.authenticated) setHistory(hist.history || []);
      else { setIsDemo(true); setHistory(DEMO_HISTORY as unknown as ReportWorkout[]); }
    });
  }, []);

  const anchor = useMemo(() => {
    const d = new Date();
    if (view === 'week') d.setDate(d.getDate() - offset * 7);
    else d.setMonth(d.getMonth() - offset, 1);
    return d;
  }, [view, offset]);

  const week = useMemo(() => (history ? weeklyReport(history, anchor) : null), [history, anchor]);
  const month = useMemo(() => (history ? monthlyStrength(history, anchor) : null), [history, anchor]);

  if (!history || !week || !month) return <p style={{ color: 'var(--muted)' }}>Building your report…</p>;

  const title = view === 'week'
    ? `${dateLabel(week.weekStart, { month: 'short', day: 'numeric' })} – ${dateLabel(week.weekEnd, { month: 'short', day: 'numeric' })}`
    : dateLabel(month.monthStart, { month: 'long', year: 'numeric' });
  const maxMuscle = Math.max(1, ...week.muscles.map((m) => Math.max(m.sets, m.previous)));

  const summaryText = view === 'week'
    ? [
        `🏋️ Training week ${title}`,
        `${week.current.sessions} workouts · ${week.current.sets} sets · ${fmt(week.current.volume)} lb moved`,
        week.prs.length ? `🏆 PRs: ${week.prs.map((p) => `${p.lift} ${p.weight}×${p.reps}`).join(', ')}` : '',
        `🔥 ${week.weekStreak}-week streak`,
      ].filter(Boolean).join('\n')
    : [
        `💪 Strength ${title}`,
        `${month.improved} lifts up, ${month.declined} down over ${month.sessions} workouts`,
        ...month.lifts.filter((l) => l.change !== null).slice(0, 5).map((l) => `${l.lift}: ${l.best?.e1rm} e1RM (${l.change! > 0 ? '+' : ''}${l.change}%)`),
      ].join('\n');

  const share = async () => {
    const nav = navigator as Navigator & { share?: (d: { text: string }) => Promise<void> };
    if (nav.share) { try { await nav.share({ text: summaryText }); return; } catch { /* fall through */ } }
    await navigator.clipboard.writeText(summaryText).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="animate-fade-in" style={{ paddingBottom: '3rem' }}>
      <div className="workout-flex-between" style={{ marginBottom: '1rem' }}>
        <Link href="/workout" style={{ color: 'var(--muted)', fontSize: '0.85rem' }}>← Workout</Link>
        {isDemo && <span className="workout-pill">Sample data</span>}
      </div>
      <h1 style={{ fontSize: '1.5rem', margin: '0 0 0.75rem' }}>Training Report</h1>

      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.75rem' }}>
        {(['week', 'month'] as const).map((v) => (
          <button key={v} className={view === v ? 'workout-btn-primary' : 'btn btn-secondary'} style={{ margin: 0, padding: '0.5rem 1rem', width: 'auto', fontSize: '0.9rem' }}
            onClick={() => { setView(v); setOffset(0); }}>
            {v === 'week' ? 'Weekly' : 'Monthly strength'}
          </button>
        ))}
      </div>
      <div className="workout-flex-between" style={{ marginBottom: '1rem' }}>
        <button className="btn btn-secondary" style={{ padding: '0.35rem 0.75rem' }} onClick={() => setOffset((o) => o + 1)} aria-label="Previous">‹</button>
        <strong>{title}</strong>
        <button className="btn btn-secondary" style={{ padding: '0.35rem 0.75rem' }} disabled={offset === 0} onClick={() => setOffset((o) => Math.max(0, o - 1))} aria-label="Next">›</button>
      </div>

      {view === 'week' ? (
        <>
          <div className="workout-grid-2" style={{ gap: '0.6rem', marginBottom: '1rem' }}>
            <Stat label="Workouts" now={week.current.sessions} before={week.previous.sessions} />
            <Stat label="Sets" now={week.current.sets} before={week.previous.sets} />
            <Stat label="Volume (lb)" now={week.current.volume} before={week.previous.volume} />
            <Stat label="Minutes" now={week.current.minutes} before={week.previous.minutes} />
          </div>

          <div className="workout-tile">
            <div className="workout-flex-between">
              <h3 style={{ margin: 0, fontSize: '1rem' }}>Days trained</h3>
              <span className="workout-hint">🔥 {week.weekStreak}-week streak</span>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '0.35rem', marginTop: '0.75rem' }}>
              {DAY_LABELS.map((d, i) => (
                <div key={d} style={{ textAlign: 'center' }}>
                  <div style={{ height: 28, borderRadius: 8, background: week.activeDays.includes(i) ? 'var(--accent)' : 'var(--input-bg)', border: '1px solid var(--surface-border)' }} />
                  <div className="workout-hint" style={{ fontSize: '0.65rem', marginTop: '0.2rem' }}>{d}</div>
                </div>
              ))}
            </div>
          </div>

          <div className="workout-tile">
            <h3 style={{ margin: '0 0 0.75rem', fontSize: '1rem' }}>🏆 Personal records</h3>
            {week.prs.length === 0 ? <p className="workout-hint" style={{ margin: 0 }}>No new PRs this week.</p> : week.prs.map((p) => (
              <div key={p.lift} className="workout-list-row" style={{ marginBottom: '0.4rem' }}>
                <div><strong>{p.lift}</strong><div className="workout-hint">{p.weight} × {p.reps}</div></div>
                <div style={{ textAlign: 'right' }}><strong>{p.e1rm}</strong><div className="workout-hint">was {p.previousBest}</div></div>
              </div>
            ))}
          </div>

          <div className="workout-tile">
            <h3 style={{ margin: '0 0 0.25rem', fontSize: '1rem' }}>Sets per muscle</h3>
            <p className="workout-hint" style={{ margin: '0 0 0.75rem' }}>Bar = this week · tick = last week</p>
            {week.muscles.length === 0 && <p className="workout-hint">No sets logged.</p>}
            {week.muscles.map((m) => (
              <div key={m.muscle} style={{ display: 'grid', gridTemplateColumns: '5.5rem minmax(0,1fr) 2rem', gap: '0.5rem', alignItems: 'center', fontSize: '0.8rem', marginBottom: '0.4rem' }}>
                <span>{m.muscle}</span>
                <div style={{ position: 'relative', height: 10, background: 'var(--input-bg)', borderRadius: 4 }}>
                  <div style={{ width: `${(m.sets / maxMuscle) * 100}%`, height: '100%', background: 'var(--accent)', borderRadius: 4 }} />
                  {m.previous > 0 && <div title={`Last week: ${m.previous}`} style={{ position: 'absolute', top: -3, bottom: -3, width: 2, left: `calc(${(m.previous / maxMuscle) * 100}% - 1px)`, background: 'var(--foreground)', opacity: 0.6 }} />}
                </div>
                <span style={{ textAlign: 'right', fontWeight: 700 }}>{m.sets}</span>
              </div>
            ))}
          </div>

          {week.topLifts.length > 0 && (
            <div className="workout-tile">
              <h3 style={{ margin: '0 0 0.75rem', fontSize: '1rem' }}>Most work</h3>
              {week.topLifts.map((l) => (
                <div key={l.lift} className="workout-flex-between" style={{ fontSize: '0.85rem', padding: '0.25rem 0' }}>
                  <span>{l.lift}</span><span className="workout-hint">{l.sets} sets · {fmt(l.volume)} lb</span>
                </div>
              ))}
            </div>
          )}
        </>
      ) : (
        <>
          <div className="workout-grid-2" style={{ gap: '0.6rem', marginBottom: '1rem' }}>
            <div className="workout-tile" style={{ padding: '0.85rem', marginBottom: 0 }}>
              <div className="workout-hint" style={{ fontSize: '0.65rem', textTransform: 'uppercase' }}>Lifts up</div>
              <div style={{ fontSize: '1.4rem', fontWeight: 800, color: 'var(--success)' }}>▲ {month.improved}</div>
            </div>
            <div className="workout-tile" style={{ padding: '0.85rem', marginBottom: 0 }}>
              <div className="workout-hint" style={{ fontSize: '0.65rem', textTransform: 'uppercase' }}>Workouts</div>
              <div style={{ fontSize: '1.4rem', fontWeight: 800 }}>{month.sessions}</div>
            </div>
          </div>
          <div className="workout-tile">
            <h3 style={{ margin: '0 0 0.25rem', fontSize: '1rem' }}>Best estimated 1RM per lift</h3>
            <p className="workout-hint" style={{ margin: '0 0 0.75rem' }}>Compared with the previous month. Deload sessions are left out.</p>
            {month.lifts.length === 0 && <p className="workout-hint">No weighted lifts logged this month.</p>}
            {month.lifts.map((l) => (
              <div key={l.lift} className="workout-list-row" style={{ marginBottom: '0.4rem' }}>
                <div>
                  <strong style={{ fontSize: '0.9rem' }}>{l.lift}</strong>
                  <div className="workout-hint">{l.muscle} · {l.sessions} session{l.sessions === 1 ? '' : 's'} · top {l.best?.weight} × {l.best?.reps}</div>
                </div>
                <div style={{ textAlign: 'right', minWidth: '4.5rem' }}>
                  <strong>{l.best?.e1rm}</strong>
                  <div style={{ fontSize: '0.75rem', fontWeight: 700, color: l.change === null ? 'var(--muted)' : l.change > 0 ? 'var(--success)' : l.change < 0 ? 'var(--danger)' : 'var(--muted)' }}>
                    {l.change === null ? 'new' : `${l.change > 0 ? '▲' : l.change < 0 ? '▼' : '='} ${Math.abs(l.change)}%`}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      <button className="btn btn-secondary" style={{ width: '100%', padding: '0.85rem', borderRadius: '12px' }} onClick={share}>
        {copied ? '✅ Copied summary' : '📤 Share summary'}
      </button>
    </div>
  );
}
