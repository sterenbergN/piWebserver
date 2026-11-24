'use client';

import { useMemo, useState } from 'react';
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { drillTargets, problemHistory, summarizeMathStats, timesGrid, weeklyProgress, type MathStats } from '@/lib/workout/rest-math-stats';

// Mental math stats, in four parts: an overview (accuracy and speed by operation and
// level, judged against your level), the times table as a grid, progress over time,
// and the actual problems you miss or take longest on.

type Tab = 'overview' | 'grid' | 'progress' | 'problems';
const TABS: { key: Tab; label: string }[] = [
  { key: 'overview', label: 'Overview' },
  { key: 'grid', label: 'Times table' },
  { key: 'progress', label: 'Progress' },
  { key: 'problems', label: 'Problems' },
];

const fmtSec = (ms: number | null) => (ms !== null ? `${(ms / 1000).toFixed(1)}s` : '—');

export function MathStatsPanel({ stats, onResetLevelRule }: { stats: MathStats; onResetLevelRule?: () => void }) {
  const [tab, setTab] = useState<Tab>('overview');
  return (
    <div className="rest-math-stats">
      <div className="rest-math-tabs" role="tablist" aria-label="Math stats">
        {TABS.map((t) => (
          <button key={t.key} type="button" role="tab" aria-selected={tab === t.key} onClick={() => setTab(t.key)}>{t.label}</button>
        ))}
      </div>
      {tab === 'overview' && <Overview stats={stats} onResetLevelRule={onResetLevelRule} />}
      {tab === 'grid' && <TimesTable stats={stats} />}
      {tab === 'progress' && <Progress stats={stats} />}
      {tab === 'problems' && <Problems stats={stats} />}
    </div>
  );
}

/** Red for 50% or less, through amber, to green at 100%. */
const accuracyColor = (accuracy: number) => `hsl(${Math.round(Math.max(0, Math.min(1, (accuracy - 50) / 50)) * 125)} 65% 42%)`;

function TimesTable({ stats }: { stats: MathStats }) {
  const grid = useMemo(() => timesGrid(stats), [stats]);
  const weak = useMemo(() => new Set(drillTargets(stats).flatMap((t) => ('pair' in t ? [`${t.pair[0]}x${t.pair[1]}`] : []))), [stats]);
  const [picked, setPicked] = useState<string | null>(null);
  const nums = Array.from({ length: grid.max - 1 }, (_, i) => i + 2);
  const keyOf = (a: number, b: number) => (a <= b ? `${a}x${b}` : `${b}x${a}`);
  const tried = Object.keys(grid.cells).length;
  const pickedCell = picked ? grid.cells[picked] : null;
  if (!tried) return <p className="rest-note">Multiplication and division you answer fill this in, fact by fact (7 × 8 and 56 ÷ 7 both count as 7 × 8).</p>;
  return (
    <div className="rest-math-grid-wrap">
      <p className="rest-note" style={{ margin: 0 }}>Each square is one fact: colour for how often you get it right, a dot when it’s slow. Tap one for the numbers.</p>
      <div className="rest-math-grid" role="grid" aria-label="Times table accuracy" style={{ gridTemplateColumns: `repeat(${nums.length + 1}, minmax(0, 1fr))` }}>
        <span className="rest-math-grid-corner" aria-hidden>×</span>
        {nums.map((n) => <span key={`h${n}`} className="rest-math-grid-head" role="columnheader">{n}</span>)}
        {nums.map((a) => [
          <span key={`r${a}`} className="rest-math-grid-head" role="rowheader">{a}</span>,
          ...nums.map((b) => {
            const key = keyOf(a, b);
            const cell = grid.cells[key];
            const slow = !!cell && !!grid.avgMs && cell.avgMs > grid.avgMs * 1.3;
            return (
              <button
                key={`${a}-${b}`}
                type="button"
                role="gridcell"
                className={`rest-math-grid-cell${cell ? '' : ' is-empty'}${slow ? ' is-slow' : ''}${weak.has(key) ? ' is-weak' : ''}${picked === key ? ' is-picked' : ''}`}
                style={cell ? { background: accuracyColor(cell.accuracy) } : undefined}
                aria-label={cell ? `${a} × ${b}: ${cell.accuracy}% right of ${cell.attempts}, ${fmtSec(cell.avgMs)}` : `${a} × ${b}: not met yet`}
                onClick={() => setPicked(cell ? key : null)}
              />
            );
          }),
        ])}
      </div>
      <p className="rest-math-grid-detail" aria-live="polite">
        {pickedCell
          ? <><strong>{pickedCell.a} × {pickedCell.b} = {pickedCell.a * pickedCell.b}</strong>: {pickedCell.accuracy}% right over {pickedCell.attempts} {pickedCell.attempts === 1 ? 'try' : 'tries'}, {fmtSec(pickedCell.avgMs)} on average{grid.avgMs ? ` (your usual ${fmtSec(grid.avgMs)})` : ''}.</>
          : `${tried} fact${tried === 1 ? '' : 's'} met so far. Grey ones you haven’t had yet.`}
      </p>
      <div className="rest-math-legend" aria-hidden>
        <span><i style={{ background: accuracyColor(50) }} /> ≤50%</span>
        <span><i style={{ background: accuracyColor(75) }} /> 75%</span>
        <span><i style={{ background: accuracyColor(100) }} /> 100%</span>
        <span><i className="is-slow-key" /> slow</span>
      </div>
    </div>
  );
}

function Progress({ stats }: { stats: MathStats }) {
  const weeks = useMemo(() => weeklyProgress(stats), [stats]);
  const sprints = stats.recent.slice(-40).map((r, i) => ({
    n: i + 1,
    score: r.score,
    accuracy: r.score + r.misses ? Math.round((r.score / (r.score + r.misses)) * 100) : null,
    seconds: r.avgMs ? Math.round(r.avgMs / 100) / 10 : null,
    date: new Date(r.at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
  }));
  if (sprints.length < 2) return <p className="rest-note">Two or more sprints and your progress shows here: score, accuracy and speed over time.</p>;
  const tick = { fill: 'var(--muted)', fontSize: 10 };
  const tooltip = { background: 'var(--background)', border: '1px solid var(--surface-border)', borderRadius: 8, fontSize: 12, color: 'var(--foreground)' };
  const chart = (key: 'score' | 'seconds' | 'accuracy', label: string, unit = '') => (
    <div>
      <p className="rest-math-subhead">{label}</p>
      <div className="rest-math-chart" role="img" aria-label={`${label}, last ${sprints.length} sprints`}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={sprints} margin={{ top: 6, right: 6, bottom: 0, left: -18 }}>
            <CartesianGrid vertical={false} stroke="var(--surface-border)" />
            <XAxis dataKey="n" tick={tick} tickLine={false} axisLine={{ stroke: 'var(--surface-border)' }} interval="preserveStartEnd" minTickGap={18} />
            <YAxis tick={tick} tickLine={false} axisLine={false} width={44} allowDecimals={key === 'seconds'} domain={key === 'accuracy' ? [0, 100] : ['auto', 'auto']} />
            <Tooltip contentStyle={tooltip} labelFormatter={(n, items) => `Sprint ${n} · ${(items?.[0]?.payload as { date?: string } | undefined)?.date ?? ''}`} formatter={(v) => [`${v}${unit}`, label]} />
            <Line type="monotone" dataKey={key} stroke="var(--accent)" strokeWidth={2} dot={sprints.length <= 20 ? { r: 2.5, fill: 'var(--accent)' } : false} connectNulls isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
  return (
    <div className="rest-math-progress">
      {chart('score', 'Right per sprint')}
      {chart('seconds', 'Seconds per problem', 's')}
      {chart('accuracy', 'Accuracy', '%')}
      <p className="rest-math-subhead">By week</p>
      <div className="rest-math-ops" role="table" aria-label="Progress by week">
        <div className="rest-math-op is-head is-week" role="row">
          <span role="columnheader">Week of</span>
          <span role="columnheader">Sprints</span>
          <span role="columnheader">Avg</span>
          <span role="columnheader">Right</span>
          <span role="columnheader" className="rest-math-op-time">Time</span>
          <span role="columnheader">Lvl</span>
        </div>
        {[...weeks].reverse().slice(0, 12).map((w) => (
          <div key={w.week} className="rest-math-op is-week" role="row">
            <span role="cell" className="rest-math-op-name">{new Date(`${w.week}T12:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</span>
            <span role="cell">{w.sprints}</span>
            <span role="cell" className="rest-math-op-acc">{w.avgScore}</span>
            <span role="cell">{w.accuracy}%</span>
            <span role="cell" className="rest-math-op-time">{fmtSec(w.avgMs)}</span>
            <span role="cell">{w.topLevel || '—'}</span>
          </div>
        ))}
      </div>
      {stats.drills > 0 && <p className="rest-note">Plus {stats.drills} drill{stats.drills === 1 ? '' : 's'}, which count toward the times table and problems but not these.</p>}
    </div>
  );
}

function Problems({ stats }: { stats: MathStats }) {
  const { mostMissed, slowest } = useMemo(() => problemHistory(stats), [stats]);
  if (!mostMissed.length && !slowest.length) return <p className="rest-note">The problems you answer show up here once you play a sprint: the ones you miss most and the ones that take longest.</p>;
  return (
    <div className="rest-math-problems">
      {mostMissed.length > 0 && (<>
        <p className="rest-math-subhead">Missed most</p>
        <ul className="rest-math-facts">
          {mostMissed.map((p) => (
            <li key={p.text}>
              <strong>{p.text} = {p.answer}</strong>
              <span>
                missed {p.wrong} of {p.attempts}
                {p.lastWrong !== undefined && <span className="rest-muted"> · {p.lastWrong ? `you put ${p.lastWrong}` : 'skipped'}</span>}
              </span>
            </li>
          ))}
        </ul>
      </>)}
      {slowest.length > 0 && (<>
        <p className="rest-math-subhead">Slowest (when right)</p>
        <ul className="rest-math-facts is-slow">
          {slowest.map((p) => (
            <li key={p.text}>
              <strong>{p.text} = {p.answer}</strong>
              <span>{fmtSec(p.avgMs)}{p.attempts > 1 && <span className="rest-muted"> · {p.attempts} times</span>}</span>
            </li>
          ))}
        </ul>
      </>)}
      <p className="rest-note">🎯 Drill weak spots serves these facts and kinds of problem more often.</p>
    </div>
  );
}

/** How many right in a row levels you up, and why it's that many for you. */
function LevelRuleNote({ stats, onReset }: { stats: MathStats; onReset?: () => void }) {
  const rule = stats.levelRule;
  const last = rule?.changes[rule.changes.length - 1];
  const n = rule?.streakUp ?? 3;
  return (
    <p className="rest-note" style={{ margin: 0 }}>
      You go up a level after <strong>{n}</strong> right in a row{last ? ', tuned to you' : ''}.
      {last && ` On ${new Date(last.at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} it went from ${last.from} to ${last.to}: you dropped straight back after ${Math.round(last.dropRate * 100)}% of level-ups${last.to > last.from ? ', so levels now wait until you’re steadier' : ', so you can climb faster'}.`}
      {!last && rule && rule.ups > 0 && ` It adjusts to how often you drop straight back (${rule.ups} of 12 level-ups so far).`}
      {last && onReset && <> <button type="button" className="rest-link" onClick={onReset}>Reset</button></>}
    </p>
  );
}

function Overview({ stats, onResetLevelRule }: { stats: MathStats; onResetLevelRule?: () => void }) {
  const summary = summarizeMathStats(stats);
  // Accuracy against your other answers at the same levels: a harder level doesn't count against you.
  const vsLevel = (c: { accuracy: number; expectedAccuracy: number | null }) => {
    if (c.expectedAccuracy === null) return { text: '—', tone: '' };
    const d = c.accuracy - c.expectedAccuracy;
    return { text: `${d > 0 ? '+' : ''}${d}`, tone: d <= -10 ? 'is-low' : d >= 5 ? 'is-high' : '' };
  };

  return (
    <div className="rest-math-overview">
      <LevelRuleNote stats={stats} onReset={onResetLevelRule} />
      <div className="rest-math-pills is-five">
        <div className="rest-math-pill">
          <span>Sprints</span>
          <strong>{stats.sprints}</strong>
        </div>
        <div className="rest-math-pill">
          <span>Best</span>
          <strong>{stats.best}</strong>
        </div>
        <div className="rest-math-pill">
          <span>Accuracy</span>
          <strong>{summary.accuracy !== null ? `${summary.accuracy}%` : '—'}</strong>
        </div>
        <div className="rest-math-pill">
          <span>Avg time</span>
          <strong>{fmtSec(summary.avgMs)}</strong>
        </div>
        <div className="rest-math-pill">
          <span>Top level</span>
          <strong>{summary.peakLevel || '—'}</strong>
        </div>
      </div>

      {summary.troubleAreas.length > 0 ? (
        <p className="rest-math-trouble is-warn">
          Needs work{summary.levelAdjusted ? ' (next to your other answers at the same levels)' : ''}:{' '}
          {summary.troubleAreas
            .map((t) => (t.expectedAccuracy !== null
              ? `${t.label} (${t.accuracy}% vs ${t.expectedAccuracy}%, ${fmtSec(t.avgMs)} vs ${fmtSec(t.expectedMs)})`
              : `${t.label} (${t.accuracy}%, ${fmtSec(t.avgMs)})`))
            .join(', ')}
        </p>
      ) : summary.totalAttempts >= 10 ? (
        <p className="rest-math-trouble is-ok">Solid across all areas so far</p>
      ) : null}

      {summary.categories.length > 0 ? (
        <div className="rest-math-ops" role="table" aria-label="Breakdown by operation">
          <div className="rest-math-op is-head is-four" role="row">
            <span role="columnheader">Operation</span>
            <span role="columnheader">Right</span>
            <span role="columnheader" className="rest-math-op-vs" title="Accuracy compared with your other answers at the same levels">vs lvl</span>
            <span role="columnheader" className="rest-math-op-time">Time</span>
          </div>
          {summary.categories.map((c) => {
            const vs = vsLevel(c);
            return (
              <div className="rest-math-op is-four" role="row" key={c.op}>
                <span className="rest-math-op-name" role="cell">{c.label} <span className="rest-muted">· {c.attempts}</span></span>
                <span className="rest-math-op-acc" role="cell">{c.accuracy}%</span>
                <span className={`rest-math-op-vs ${vs.tone}`} role="cell">{vs.text}</span>
                <span className="rest-math-op-time" role="cell">{fmtSec(c.avgMs)}</span>
              </div>
            );
          })}
        </div>
      ) : (
        <p className="rest-note">Finish a sprint to see your operation breakdown.</p>
      )}

      {summary.troubleFacts.length > 0 && (
        <div>
          <p className="rest-math-subhead">Numbers that trip you up</p>
          <ul className="rest-math-facts">
            {summary.troubleFacts.map((f) => (
              <li key={f.tag} title={`Level ${f.levels[0] === f.levels[1] ? f.levels[0] : `${f.levels[0]}–${f.levels[1]}`}, ${f.attempts} tries`}>
                <strong>{f.label}</strong>
                <span>
                  {f.accuracy}% <span className="rest-muted">(others {f.expectedAccuracy}%)</span> · {fmtSec(f.avgMs)} <span className="rest-muted">({fmtSec(f.expectedMs)})</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {summary.levels.length > 0 && (
        <div>
          <p className="rest-math-subhead">By level</p>
          <div className="rest-math-ops" role="table" aria-label="Breakdown by level">
            {summary.levels.map((l) => (
              <div className="rest-math-op" role="row" key={l.level}>
                <span className="rest-math-op-name" role="cell">Level {l.level} <span className="rest-muted">· {l.attempts}</span></span>
                <span className="rest-math-op-acc" role="cell">{l.accuracy}%</span>
                <span className="rest-math-op-time" role="cell">{fmtSec(l.avgMs)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

    </div>
  );
}

