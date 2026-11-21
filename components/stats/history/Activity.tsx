'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { compact, dayOf, formatDay, heatmap, sizeOverTime, daysBetween, type Summary } from '@/lib/site-history/stats';
import type { HistoryCommit } from '@/lib/site-history/types';

export function Headline({ s }: { s: Summary }) {
  const items: [string, string][] = [
    [s.commits.toLocaleString('en-US'), 'commits'],
    [s.daysSinceFirst.toLocaleString('en-US'), `days since the first, ${formatDay(s.firstDay, true)}`],
    [s.activeDays.toLocaleString('en-US'), 'days with work'],
    [`+${compact(s.added)} / −${compact(s.removed)}`, 'lines added / removed'],
    [compact(s.net), 'lines of code now'],
    [String(s.areas), 'site areas'],
    [s.busiestWeek ? String(s.busiestWeek.commits) : '–', s.busiestWeek ? `commits in the busiest week (of ${formatDay(s.busiestWeek.start)})` : 'busiest week'],
    [s.commits && s.activeDays ? (s.commits / s.activeDays).toFixed(1) : '–', 'commits per active day'],
  ];
  return (
    <div className="sh-stats">
      {items.map(([big, label]) => (
        <div className="sh-stat" key={label}><b>{big}</b><span>{label}</span></div>
      ))}
    </div>
  );
}

/** A GitHub-style grid of days; the shade is how many commits landed. Tap a day to list them. */
export function Heatmap({ commits }: { commits: HistoryCommit[] }) {
  const map = useMemo(() => heatmap(commits), [commits]);
  const [picked, setPicked] = useState<string | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  // Start at the newest weeks, which is what people want to see on a narrow screen.
  useEffect(() => { if (scroller.current) scroller.current.scrollLeft = scroller.current.scrollWidth; }, []);
  const level = (n: number) => (n <= 0 ? '' : n >= map.max * 0.75 ? ' l4' : n >= map.max * 0.5 ? ' l3' : n >= map.max * 0.25 ? ' l2' : ' l1');
  const dayCommits = picked ? commits.filter((c) => dayOf(c) === picked) : [];

  return (
    <div>
      <div className="sh-heat-scroll" ref={scroller}>
        <div className="sh-heat-months" aria-hidden>
          {map.weeks.map((_, i) => <span key={i}>{map.months.find(([col]) => col === i)?.[1] ?? ''}</span>)}
        </div>
        <div className="sh-heat" role="grid" aria-label="Commits per day">
          {map.weeks.flatMap((col, w) => col.map((cell, r) => cell
            ? <button key={`${w}-${r}`} type="button" className={`sh-cell${level(cell.count)}${picked === cell.day ? ' picked' : ''}`} title={`${formatDay(cell.day, true)}: ${cell.count} commit${cell.count === 1 ? '' : 's'}`} aria-label={`${formatDay(cell.day, true)}: ${cell.count} commits`} onClick={() => setPicked(picked === cell.day ? null : cell.day)} />
            : <span key={`${w}-${r}`} className="sh-cell empty" />))}
        </div>
      </div>
      {picked && (
        <div className="sh-day">
          <strong>{formatDay(picked, true)}</strong>: {dayCommits.length} commit{dayCommits.length === 1 ? '' : 's'}
          <ul>{dayCommits.map((c) => <li key={c.h}>{c.s}</li>)}</ul>
        </div>
      )}
    </div>
  );
}

/** Net lines of code over time, one point per day with commits. `marker` draws a line at a checkpoint's day. */
export function SizeChart({ commits, marker }: { commits: HistoryCommit[]; marker?: string }) {
  const W = 600, H = 190, L = 42, R = 10, T = 10, B = 22;
  const pts = useMemo(() => sizeOverTime(commits), [commits]);
  if (pts.length < 2) return null;
  const first = pts[0].day;
  const span = Math.max(1, daysBetween(first, pts[pts.length - 1].day));
  const top = Math.max(...pts.map((p) => p.loc), 1);
  const x = (day: string) => L + (daysBetween(first, day) / span) * (W - L - R);
  const y = (loc: number) => T + (1 - Math.max(0, loc) / top) * (H - T - B);
  const line = pts.map((p, i) => `${i ? 'L' : 'M'}${x(p.day).toFixed(1)},${y(p.loc).toFixed(1)}`).join('');
  const area = `${line}L${x(pts[pts.length - 1].day).toFixed(1)},${H - B}L${x(first).toFixed(1)},${H - B}Z`;
  // A tick at the start of each month that has commits.
  const ticks: { day: string; label: string }[] = [];
  let seen = '';
  for (const p of pts) { const m = p.day.slice(0, 7); if (m !== seen) { seen = m; ticks.push({ day: p.day, label: formatDay(p.day).split(' ')[0] }); } }
  const grid = [0, 0.5, 1];

  return (
    <svg className="sh-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Lines of code over time, now ${compact(pts[pts.length - 1].loc)}`}>
      {grid.map((g) => <g key={g}><line className="grid" x1={L} x2={W - R} y1={y(top * g)} y2={y(top * g)} /><text x={L - 5} y={y(top * g) + 3} textAnchor="end">{compact(Math.round(top * g))}</text></g>)}
      <path className="fill" d={area} />
      <path className="line" d={line} />
      {ticks.map((t) => <text key={t.day} x={x(t.day)} y={H - 6} textAnchor="middle">{t.label}</text>)}
      {marker && marker >= first && <line className="mark" x1={x(marker)} x2={x(marker)} y1={T} y2={H - B} />}
    </svg>
  );
}
