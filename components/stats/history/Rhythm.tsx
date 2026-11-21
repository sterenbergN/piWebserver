'use client';

import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { bigDays, compact, dayOf, formatDay, heatmap, punchcard, streaks, type WorkSessions } from '@/lib/site-history/stats';
import type { HistoryCommit } from '@/lib/site-history/types';
import AreaChip from './AreaChip';
import { useWidth } from './chart';

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const LONG_DAYS = ['Mondays', 'Tuesdays', 'Wednesdays', 'Thursdays', 'Fridays', 'Saturdays', 'Sundays'];
const hourLabel = (h: number) => (h === 0 ? '12 am' : h < 12 ? `${h} am` : h === 12 ? '12 pm' : `${h - 12} pm`);
const duration = (min: number) => (min >= 60 ? `${Math.floor(min / 60)}h ${String(min % 60).padStart(2, '0')}m` : `${min}m`);

function inRange(day: string, s: { start: string; end: string } | null) {
  return !!s && day >= s.start && day <= s.end;
}

/** When the work happened: a calendar of days, streaks, the hours of the week, and a time estimate. */
export default function Rhythm({ commits, today, work }: { commits: HistoryCommit[]; today: string; work: WorkSessions }) {
  const map = useMemo(() => heatmap(commits), [commits]);
  const runs = useMemo(() => streaks(commits, today), [commits, today]);
  const big = useMemo(() => bigDays(commits, 5), [commits]);
  const [picked, setPicked] = useState<string | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const [calBox, calW] = useWidth<HTMLDivElement>(0);
  // Squares grow to fill a wide screen (up to a point); on a phone the grid scrolls instead.
  const cell = calW ? Math.max(13, Math.min(20, Math.floor((calW - 40) / Math.max(1, map.weeks.length)) - 3)) : 13;
  // Open at the newest weeks, which is what people want to see on a narrow screen.
  useEffect(() => { if (scroller.current) scroller.current.scrollLeft = scroller.current.scrollWidth; }, []);
  const level = (n: number) => (n <= 0 ? 0 : n >= map.max * 0.75 ? 4 : n >= map.max * 0.5 ? 3 : n >= map.max * 0.25 ? 2 : 1);
  const dayCommits = picked ? commits.filter((c) => dayOf(c) === picked) : [];
  const hours = Math.round(work.minutes / 60);

  return (
    <div className="sh-rhythm">
      <div className="sh-cal" ref={calBox} style={{ '--cell': `${cell}px` } as CSSProperties}>
        <div className="sh-cal-days" aria-hidden>
          {WEEKDAYS.map((d, i) => <span key={d}>{i % 2 === 0 ? d : ''}</span>)}
        </div>
        <div className="sh-heat-scroll" ref={scroller}>
          <div className="sh-heat-months" aria-hidden>
            {map.weeks.map((_, i) => <span key={i}>{map.months.find(([col]) => col === i)?.[1] ?? ''}</span>)}
          </div>
          <div className="sh-heat" role="grid" aria-label="Commits per day">
            {map.weeks.flatMap((col, w) => col.map((cell, r) => {
              if (!cell) return <span key={`${w}-${r}`} className="sh-cell empty" />;
              const streak = inRange(cell.day, runs.longest) && (runs.longest?.days ?? 0) > 1 ? ' streak' : '';
              return (
                <button
                  key={`${w}-${r}`} type="button" className={`sh-cell l${level(cell.count)}${streak}${picked === cell.day ? ' picked' : ''}`}
                  title={`${formatDay(cell.day, true)}: ${cell.count} commit${cell.count === 1 ? '' : 's'}`}
                  aria-label={`${formatDay(cell.day, true)}: ${cell.count} commits`}
                  onClick={() => setPicked(picked === cell.day ? null : cell.day)}
                />
              );
            }))}
          </div>
        </div>
      </div>
      <div className="sh-cal-foot">
        <span className="sh-legend-scale" aria-hidden>Less {[0, 1, 2, 3, 4].map((l) => <i key={l} className={`sh-cell l${l}`} />)} More</span>
        {runs.longest && runs.longest.days > 1 && <span className="sh-streak-key"><i className="sh-cell l2 streak" /> Longest streak</span>}
      </div>

      {picked && (
        <div className="sh-day">
          <strong>{formatDay(picked, true)}</strong>: {dayCommits.length} commit{dayCommits.length === 1 ? '' : 's'}
          <ul>{dayCommits.map((c) => <li key={c.h}><span>{c.s}</span> {c.a.slice(0, 2).map((a) => <AreaChip key={a} name={a} />)}</li>)}</ul>
        </div>
      )}

      <div className="sh-tiles">
        {runs.longest && (
          <div className="sh-tile">
            <b>{runs.longest.days} days</b>
            <span>Longest streak, {formatDay(runs.longest.start)} to {formatDay(runs.longest.end)}</span>
          </div>
        )}
        <div className="sh-tile">
          <b>{runs.current ? `${runs.current.days} day${runs.current.days === 1 ? '' : 's'}` : 'None'}</b>
          <span>{runs.current ? 'Current streak, still going' : 'Current streak'}</span>
        </div>
        <div className="sh-tile">
          <b>≈{hours} hours</b>
          <span>across {work.sessions} sittings</span>
        </div>
        {work.longest && (
          <div className="sh-tile">
            <b>{duration(work.longest.minutes)}</b>
            <span>Longest sitting, {formatDay(work.longest.day)} ({work.longest.commits} commits)</span>
          </div>
        )}
      </div>
      <p className="sh-fine">The hours are a guess from commit times: commits less than two hours apart count as one sitting, plus half an hour for the work before its first commit.</p>

      {big.length > 0 && (
        <>
          <h3 className="sh-h3">Biggest days</h3>
          <ol className="sh-bigdays">
            {big.map((b) => (
              <li key={b.day}>
                <button type="button" className={picked === b.day ? 'on' : ''} onClick={() => setPicked(picked === b.day ? null : b.day)}>
                  <span className="sh-bigday-name">{formatDay(b.day, true)}</span>
                  <span className="sh-bigday-bar"><i style={{ width: `${(b.commits / big[0].commits) * 100}%` }} /></span>
                  <b>{b.commits}</b>
                  <small><span className="sh-plus">+{compact(b.added)}</span> <span className="sh-minus">−{compact(b.removed)}</span></small>
                </button>
              </li>
            ))}
          </ol>
        </>
      )}

      <h3 className="sh-h3">Hours of the week</h3>
      <Punchcard commits={commits} />
    </div>
  );
}

/** Commits by weekday and hour: a dot per hour, bigger for more commits. */
function Punchcard({ commits }: { commits: HistoryCommit[] }) {
  const { grid, max } = useMemo(() => punchcard(commits), [commits]);
  const [box, W] = useWidth<HTMLDivElement>(640);
  const [at, setAt] = useState<[number, number] | null>(null);
  const L = 34, R = 4, T = 4;
  const cell = Math.min(26, Math.max(10, (W - L - R) / 24));
  const SW = L + cell * 24 + R;
  const H = T + cell * 7 + 18;
  const rMax = Math.min(cell, 18) * 0.48;
  const best = grid.flatMap((row, d) => row.map((n, h) => ({ d, h, n }))).sort((a, b) => b.n - a.n)[0];
  const show = at ?? (best ? [best.d, best.h] as [number, number] : null);

  return (
    <div ref={box} className="sh-punch">
      <svg width={SW} height={H} viewBox={`0 0 ${SW} ${H}`} role="img" aria-label="Commits by day of the week and hour of the day">
        {WEEKDAYS.map((d, i) => <text key={d} className="sh-axis" x={L - 8} y={T + cell * i + cell / 2 + 3.5} textAnchor="end">{d}</text>)}
        {[0, 6, 12, 18].map((h) => <text key={h} className="sh-axis" x={L + cell * h + cell / 2} y={H - 4} textAnchor="middle">{hourLabel(h)}</text>)}
        {grid.map((row, d) => row.map((n, h) => {
          const cx = L + cell * h + cell / 2;
          const cy = T + cell * d + cell / 2;
          const on = show && show[0] === d && show[1] === h && at !== null;
          return (
            <g key={`${d}-${h}`}>
              {n > 0
                ? <circle className={`sh-punch-dot${on ? ' on' : ''}`} cx={cx} cy={cy} r={Math.max(1.8, Math.sqrt(n / max) * rMax)} />
                : <circle className="sh-punch-none" cx={cx} cy={cy} r={1} />}
              <rect
                x={cx - cell / 2} y={cy - cell / 2} width={cell} height={cell} fill="transparent"
                onPointerEnter={() => setAt([d, h])} onPointerDown={() => setAt([d, h])}
              >
                <title>{`${LONG_DAYS[d]}, ${hourLabel(h)}: ${n} commit${n === 1 ? '' : 's'}`}</title>
              </rect>
            </g>
          );
        }))}
      </svg>
      {show && (
        <p className="sh-sub" style={{ margin: '0.3rem 0 0' }}>
          {at ? '' : 'Busiest hour: '}{LONG_DAYS[show[0]]} at {hourLabel(show[1])}: {grid[show[0]][show[1]]} commit{grid[show[0]][show[1]] === 1 ? '' : 's'} in all
        </p>
      )}
    </div>
  );
}
