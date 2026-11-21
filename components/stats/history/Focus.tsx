'use client';

import { useMemo, useState, type PointerEvent } from 'react';
import { collapseQuiet, formatDay, weeklyByArea } from '@/lib/site-history/stats';
import type { HistoryCommit } from '@/lib/site-history/types';
import { NEUTRAL, useAreaColor } from './AreaChip';
import { localX, nearest, niceTicks, quietLabel, smooth, textWidth, useWidth, type Pt } from './chart';

const OTHER = 'Everything else';
const BREAK_UNITS = 1.6;

/**
 * Commits per week, stacked by area: what had the attention in each stretch. `keep` are the
 * coloured areas, bottom band first; the rest share one grey band on top.
 */
export default function Focus({ commits, keep }: { commits: HistoryCommit[]; keep: string[] }) {
  const color = useAreaColor();
  const [box, W] = useWidth<HTMLDivElement>(640);
  const [pinned, setPinned] = useState<string | null>(null);
  const [hoverBand, setHoverBand] = useState<string | null>(null);
  const [hover, setHover] = useState<number | null>(null);
  const data = useMemo(() => weeklyByArea(commits, keep, OTHER), [commits, keep]);
  const runs = useMemo(() => collapseQuiet(data.totals, 2), [data.totals]);
  if (!runs.segments.length) return null;

  const focus = hoverBand ?? pinned;
  const bandColor = (name: string) => (name === OTHER ? NEUTRAL : color(name));
  const narrow = W < 520;
  const L = 30, R = 12, T = 22, H = narrow ? 200 : 250;
  const total = H + 22;

  // Weeks that get drawn sit one unit apart; a long quiet stretch takes a fixed short gap instead.
  // Each run starts half a unit in, so its bands can rise from nothing rather than a cliff edge.
  const units = new Map<number, number>();
  const breakAt: { u: number; empty: number }[] = [];
  let u = 0.5;
  runs.segments.forEach(([s, e], k) => {
    if (k > 0) { breakAt.push({ u: u - 0.5 + BREAK_UNITS / 2, empty: runs.breaks[k - 1].empty }); u += BREAK_UNITS; }
    for (let i = s; i <= e; i++) units.set(i, u++);
  });
  const span = Math.max(1, u - 1);
  const xu = (v: number) => L + (v / span) * (W - L - R);
  const ticks = niceTicks(Math.max(...data.totals), 3);
  const top = ticks[ticks.length - 1] || 1;
  const y = (v: number) => T + (1 - v / top) * (H - T);
  const baseAt = (b: number, i: number) => data.series.slice(0, b).reduce((sum, o) => sum + o.values[i], 0);

  // Stack in order; each band is its top edge forwards and its bottom edge back, per run. Runs
  // taper to zero at their edges, except the latest week, which is still going.
  const bands = data.series.map((s, b) => {
    const paths = runs.segments.map(([start, end], k) => {
      const upper: Pt[] = [];
      const lower: Pt[] = [];
      const zero = y(0);
      upper.push([xu(units.get(start)! - 0.5), zero]);
      lower.push([xu(units.get(start)! - 0.5), zero]);
      for (let i = start; i <= end; i++) {
        const base = baseAt(b, i);
        const px = xu(units.get(i)!);
        lower.push([px, y(base)]);
        upper.push([px, y(base + s.values[i])]);
      }
      if (k < runs.segments.length - 1) {
        upper.push([xu(units.get(end)! + 0.5), zero]);
        lower.push([xu(units.get(end)! + 0.5), zero]);
      }
      return `${smooth(upper)}${smooth(lower, { reverse: true, join: true })}Z`;
    });
    return { name: s.name, total: s.total, d: paths.join('') };
  });

  // A name inside a band where it's thickest, biggest bands first, skipping any that would collide.
  const inBand: { name: string; x: number; y: number }[] = [];
  const taken: [number, number, number, number][] = [];
  const order = data.series.map((s, b) => ({ s, b })).sort((p, q) => q.s.total - p.s.total);
  for (const { s, b } of order) {
    const w = textWidth(s.name, 10.5) + 6;
    const spots = [...units].map(([i, v]) => ({ i, x: xu(v), h: (s.values[i] / top) * (H - T) }))
      .filter((p) => p.h >= 16 && p.x - w / 2 > L && p.x + w / 2 < W - R).sort((p, q) => q.h - p.h);
    for (const p of spots) {
      const ly = y(baseAt(b, p.i) + s.values[p.i] / 2) + 3.5;
      const box: [number, number, number, number] = [p.x - w / 2, ly - 10, p.x + w / 2, ly + 3];
      if (taken.some((t) => box[0] < t[2] && box[2] > t[0] && box[1] < t[3] && box[3] > t[1])) continue;
      taken.push(box);
      inBand.push({ name: s.name, x: p.x, y: ly });
      break;
    }
  }

  const drawn = [...units.entries()].sort((a, b) => a[1] - b[1]);
  const xs = drawn.map(([, v]) => xu(v));
  // A week belongs to the month its Thursday falls in, as calendars count weeks.
  const thursday = (week: string) => new Date(Date.parse(`${week}T00:00:00Z`) + 3 * 86_400_000).toISOString().slice(0, 10);
  const months: { x: number; label: string }[] = [];
  let seen = '';
  for (const [i, v] of drawn) {
    const day = thursday(data.weeks[i]);
    const m = day.slice(0, 7);
    if (m === seen) continue;
    seen = m;
    const px = xu(v);
    if (months.length && px - months[months.length - 1].x < 30) continue;
    months.push({ x: px, label: formatDay(day).split(' ')[0] });
  }

  const peak = data.totals.indexOf(Math.max(...data.totals));
  const hi = hover === null ? null : drawn[hover][0];
  const hx = hover === null ? 0 : xs[hover];
  // The week under the pointer, and with a mouse, the band under it too.
  const point = (e: PointerEvent<SVGRectElement>) => {
    const k = nearest(xs, localX(e) + L);
    setHover(k);
    if (e.pointerType !== 'mouse') return;
    const i = drawn[k][0];
    const v = (1 - (e.clientY - e.currentTarget.getBoundingClientRect().top - T) / (H - T)) * top;
    let base = 0;
    let under: string | null = null;
    for (const s of data.series) {
      if (v >= base && v < base + s.values[i]) { under = s.name; break; }
      base += s.values[i];
    }
    setHoverBand(under);
  };
  const rows = hi === null ? [] : data.series.map((s) => ({ name: s.name, v: s.values[hi] })).filter((r) => r.v >= 0.5).sort((a, b) => b.v - a.v);

  return (
    <div>
      <div className="sh-legend" role="group" aria-label="Areas">
        {[...data.series].reverse().map((s) => (
          <button
            key={s.name} type="button" className={`sh-key${focus === s.name ? ' on' : ''}${focus && focus !== s.name ? ' dim' : ''}`}
            aria-pressed={pinned === s.name} onClick={() => setPinned(pinned === s.name ? null : s.name)}
          >
            <i style={{ background: bandColor(s.name) }} />{s.name}<small>{s.total}</small>
          </button>
        ))}
      </div>

      <div className="sh-growth" ref={box}>
        <svg width={W} height={total} viewBox={`0 0 ${W} ${total}`} role="img" aria-label="Commits per week, stacked by area of the site">
          {ticks.map((t) => (
            <g key={t}>
              <line className="sh-grid" x1={L} x2={W - R} y1={y(t)} y2={y(t)} />
              <text className="sh-axis" x={L - 6} y={y(t) + 3.5} textAnchor="end">{t}</text>
            </g>
          ))}
          {breakAt.map((b) => (
            <text key={b.u} className="sh-quiet" x={xu(b.u)} y={T + (H - T) * 0.5} textAnchor="middle">
              {quietLabel(b.empty * 7).split(' ').map((w, i) => <tspan key={i} x={xu(b.u)} dy={i ? 12 : 0}>{w}</tspan>)}
            </text>
          ))}
          <g className="sh-draw">
            {bands.map((b) => (
              <path
                key={b.name} d={b.d} className="sh-band" style={{ fill: bandColor(b.name), opacity: focus && focus !== b.name ? 0.16 : b.name === OTHER ? 0.55 : 0.92 }}
              />
            ))}
          </g>
          {!focus && inBand.map((l) => <text key={l.name} className="sh-band-label" x={l.x} y={l.y} textAnchor="middle">{l.name}</text>)}
          {!focus && units.has(peak) && (
            <text className="sh-peak" x={Math.min(W - R - 40, Math.max(L + 40, xu(units.get(peak)!)))} y={y(data.totals[peak]) - 7} textAnchor="middle">{data.totals[peak]} commits</text>
          )}
          {months.map((m) => <text key={m.x} className="sh-axis" x={m.x} y={H + 15} textAnchor="middle">{m.label}</text>)}
          {hover !== null && <line className="sh-cross-line" x1={hx} x2={hx} y1={T - 6} y2={H} pointerEvents="none" />}
          <rect
            x={L} y={0} width={W - L - R} height={H} fill="transparent" className="sh-hit"
            onPointerMove={point}
            onPointerDown={point}
            onPointerLeave={() => { setHover(null); setHoverBand(null); }}
          />
        </svg>

        {hi !== null && (
          <div className="sh-tip" style={hx > W / 2 ? { right: W - hx + 12, top: T } : { left: hx + 12, top: T }}>
            <strong>Week of {formatDay(data.weeks[hi], true)}</strong>
            <span>{data.totals[hi]} commit{data.totals[hi] === 1 ? '' : 's'}</span>
            {rows.slice(0, 6).map((r) => (
              <span key={r.name} className={`sh-tip-key${focus === r.name ? ' on' : ''}`}><i style={{ background: bandColor(r.name) }} />{r.name}<b>{Math.round(r.v)}</b></span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
