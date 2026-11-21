'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { compact, formatDay, growth, milestones, timeAxis, type Summary, type WorkSessions } from '@/lib/site-history/stats';
import type { HistoryData } from '@/lib/site-history/types';
import { useAreaColor } from './AreaChip';
import { localX, nearest, niceTicks, quietLabel, smooth, textWidth, useCountUp, useWidth, type Pt } from './chart';

function Big({ value, label, hero, approx }: { value: number; label: string; hero?: boolean; approx?: boolean }) {
  const v = useCountUp(value);
  return (
    <div className={`sh-big${hero ? ' hero' : ''}`}>
      <b>{approx ? '≈' : ''}{v.toLocaleString('en-US')}</b>
      <span>{label}</span>
    </div>
  );
}

/** The opening: big numbers, then the site's growth as one picture. */
export default function Hero({ data, summary, work }: { data: HistoryData; summary: Summary; work: WorkSessions }) {
  const points = useMemo(() => growth(data), [data]);
  const last = points[points.length - 1];
  const busiest = summary.busiestWeek;

  return (
    <section className="sh-hero">
      <div className="sh-hero-head">
        <Link href="/stats" className="sh-back">‹ Stats</Link>
        <h1>How this site was built</h1>
        <p className="sh-lede">
          From a first commit on {formatDay(summary.firstDay, true)} to {last.pages} pages today. Everything here is read from the site’s own commit history.
        </p>
      </div>

      <div className="sh-bigs">
        <Big hero value={last.loc} label="lines of code" />
        <Big value={last.pages} label="pages" />
        <Big value={summary.commits} label="commits" />
        <Big approx value={Math.round(work.minutes / 60)} label="hours of work (a guess)" />
      </div>

      <GrowthChart data={data} />

      <ul className="sh-facts">
        <li><b>{summary.activeDays}</b> days with work, out of {summary.daysSinceFirst}</li>
        <li><b className="sh-plus">+{compact(summary.added)}</b> / <b className="sh-minus">−{compact(summary.removed)}</b> lines written and removed</li>
        {busiest && <li>Busiest week: <b>{busiest.commits}</b> commits, from {formatDay(busiest.start)}</li>}
        <li><b>{summary.areas}</b> areas of the site</li>
      </ul>
    </section>
  );
}

const GRAD = 'sh-growth-fill';
const HATCH = 'sh-quiet-hatch';

/** Lines of code over time, with a page-count strip under it and a dot where each area arrived. */
function GrowthChart({ data }: { data: HistoryData }) {
  const color = useAreaColor();
  const [box, W] = useWidth<HTMLDivElement>(640);
  const [hover, setHover] = useState<number | null>(null);
  const points = useMemo(() => growth(data), [data]);
  // Three quiet weeks still read as time passing; only longer gaps get squeezed.
  const axis = useMemo(() => timeAxis(points.map((p) => p.day), 21, 8), [points]);
  const born = useMemo(() => milestones(data.commits), [data.commits]);
  if (points.length < 2) return null;

  const narrow = W < 520;
  const L = 40, R = 12;
  const T = 40, H = narrow ? 210 : 270;
  const PT = H + 26, PH = narrow ? 44 : 54;
  const total = PT + PH + 4;
  const x = (day: string) => L + axis.at(day) * (W - L - R);
  const ticks = niceTicks(Math.max(...points.map((p) => p.loc)), narrow ? 3 : 4);
  const top = ticks[ticks.length - 1] || 1;
  const yL = (v: number) => T + (1 - Math.max(0, v) / top) * (H - T);
  const topP = niceTicks(points[points.length - 1].pages, 2).at(-1) || 1;
  const yP = (v: number) => PT + (1 - v / topP) * PH;
  const xs = points.map((p) => x(p.day));
  const oneDay = axis.dayWidth * (W - L - R);

  // Across a quiet stretch the size stays flat; the jump belongs to the day work resumed.
  const line: Pt[] = [];
  points.forEach((p, i) => {
    const gap = i > 0 && axis.breaks.find((b) => b.to === p.day);
    if (gap) line.push([xs[i] - Math.max(1, oneDay), yL(points[i - 1].loc)]);
    line.push([xs[i], yL(p.loc)]);
  });
  const linePath = smooth(line);
  const areaPath = `${linePath}L${xs[xs.length - 1].toFixed(1)},${H}L${xs[0].toFixed(1)},${H}Z`;

  let pagesPath = `M${xs[0].toFixed(1)},${yP(points[0].pages).toFixed(1)}`;
  for (let i = 1; i < points.length; i++) pagesPath += `H${xs[i].toFixed(1)}V${yP(points[i].pages).toFixed(1)}`;
  const pagesArea = `${pagesPath}V${PT + PH}H${xs[0].toFixed(1)}Z`;

  // Month labels at the first working day of each month, skipped when they'd crowd.
  const months: { x: number; label: string }[] = [];
  let seen = '';
  for (const p of points) {
    const m = p.day.slice(0, 7);
    if (m === seen) continue;
    seen = m;
    const px = x(p.day);
    if (months.length && px - months[months.length - 1].x < 30) continue;
    months.push({ x: px, label: formatDay(p.day).split(' ')[0] });
  }

  // Each area's arrival sits on the curve. The busiest areas get a name; the rest show on hover.
  const dayIndex = new Map(points.map((p, i) => [p.day, i]));
  const dots = born.map((m) => {
    const i = dayIndex.get(m.day) ?? 0;
    return { ...m, cx: xs[i], cy: yL(points[i].loc) };
  });
  const rows: [number, number][][] = [[], []];
  const labels: { area: string; x: number; y: number; dotX: number; dotY: number }[] = [];
  const maxLabels = narrow ? 4 : 9;
  for (const d of [...dots].sort((a, b) => b.count - a.count)) {
    if (labels.length >= maxLabels) break;
    const w = textWidth(d.area, 11) + 8;
    const cx = Math.min(W - R - w / 2, Math.max(L + w / 2, d.cx));
    const row = rows.findIndex((r) => r.every(([a, b]) => cx + w / 2 < a || cx - w / 2 > b));
    if (row < 0) continue;
    rows[row].push([cx - w / 2, cx + w / 2]);
    labels.push({ area: d.area, x: cx, y: row === 0 ? 13 : 28, dotX: d.cx, dotY: d.cy });
  }
  const labelled = new Set(labels.map((l) => l.area));

  const end = points[points.length - 1];
  const hp = hover === null ? null : points[hover];
  const hx = hover === null ? 0 : xs[hover];
  const arrivals = hp ? born.filter((m) => m.day === hp.day) : [];

  return (
    <div className="sh-growth" ref={box}>
      <svg width={W} height={total} viewBox={`0 0 ${W} ${total}`} role="img" aria-label={`Lines of code grew to ${compact(end.loc)} and pages to ${end.pages} between ${formatDay(points[0].day, true)} and ${formatDay(end.day, true)}`}>
        <defs>
          <linearGradient id={GRAD} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" style={{ stopColor: 'var(--accent-light)', stopOpacity: 0.45 }} />
            <stop offset="1" style={{ stopColor: 'var(--accent-light)', stopOpacity: 0.02 }} />
          </linearGradient>
          <pattern id={HATCH} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <line x1="0" y1="0" x2="0" y2="6" className="sh-hatch" />
          </pattern>
        </defs>

        {ticks.map((t) => (
          <g key={t}>
            <line className="sh-grid" x1={L} x2={W - R} y1={yL(t)} y2={yL(t)} />
            <text className="sh-axis" x={L - 6} y={yL(t) + 3.5} textAnchor="end">{compact(t)}</text>
          </g>
        ))}

        {axis.breaks.map((b) => {
          const a = x(b.from), z = x(b.to);
          const mid = (a + z) / 2;
          return (
            <g key={b.from}>
              <rect x={a + 2} y={T} width={Math.max(0, z - a - 4)} height={H - T} fill={`url(#${HATCH})`} />
              <rect x={a + 2} y={PT} width={Math.max(0, z - a - 4)} height={PH} fill={`url(#${HATCH})`} />
              <text className="sh-quiet" x={mid} y={T + (H - T) * 0.36} textAnchor="middle">
                {quietLabel(b.days).split(' ').map((w, i) => <tspan key={i} x={mid} dy={i ? 12 : 0}>{w}</tspan>)}
              </text>
            </g>
          );
        })}

        <g className="sh-draw">
          <path d={areaPath} fill={`url(#${GRAD})`} />
          <path d={linePath} className="sh-line" />
          <path d={pagesArea} className="sh-pages-fill" />
          <path d={pagesPath} className="sh-pages-line" />
        </g>

        {labels.map((l) => (
          <g key={l.area} className="sh-milestone-label">
            <line x1={l.dotX} x2={l.dotX} y1={l.y + 5} y2={l.dotY - 6} />
            <text x={l.x} y={l.y} textAnchor="middle">{l.area}</text>
          </g>
        ))}
        {dots.map((d) => (
          <circle key={d.area} className="sh-milestone" cx={d.cx} cy={d.cy} r={labelled.has(d.area) ? 4.5 : 3.5} style={{ fill: color(d.area) }} />
        ))}
        <circle className="sh-end" cx={xs[xs.length - 1]} cy={yL(end.loc)} r={4.5} />
        <text className="sh-end-label" x={xs[xs.length - 1] - 9} y={yL(end.loc) + 4} textAnchor="end">{compact(end.loc)} lines</text>

        {months.map((m) => <text key={m.x} className="sh-axis" x={m.x} y={H + 15} textAnchor="middle">{m.label}</text>)}
        <text className="sh-strip-label" x={L + 4} y={PT + 12}>Pages</text>
        <text className="sh-end-label" x={xs[xs.length - 1] - 6} y={yP(end.pages) + 13} textAnchor="end">{end.pages}</text>

        {hp && (
          <g className="sh-cross" pointerEvents="none">
            <line x1={hx} x2={hx} y1={T - 4} y2={PT + PH} />
            <circle cx={hx} cy={yL(hp.loc)} r={4.5} />
            <circle cx={hx} cy={yP(hp.pages)} r={3.5} />
          </g>
        )}
        <rect
          x={L} y={0} width={W - L - R} height={total} fill="transparent" className="sh-hit"
          onPointerMove={(e) => setHover(nearest(xs, localX(e) + L))}
          onPointerDown={(e) => setHover(nearest(xs, localX(e) + L))}
          onPointerLeave={() => setHover(null)}
        />
      </svg>

      {hp && (
        <div className="sh-tip" style={hx > W / 2 ? { right: W - hx + 12, top: T } : { left: hx + 12, top: T }}>
          <strong>{formatDay(hp.day, true)}</strong>
          <span>{hp.loc.toLocaleString('en-US')} lines · {hp.pages} pages</span>
          <span>{hp.commits} commit{hp.commits === 1 ? '' : 's'} that day · {hp.total} so far</span>
          {arrivals.map((m) => <span key={m.area} className="sh-tip-key"><i style={{ background: color(m.area) }} />{m.area} arrived</span>)}
        </div>
      )}
    </div>
  );
}
