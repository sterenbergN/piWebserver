'use client';

import { useMemo, useState } from 'react';
import { areaStats, coChange, formatDay, milestones, type AreaStat } from '@/lib/site-history/stats';
import type { HistoryCommit } from '@/lib/site-history/types';
import { NEUTRAL, chipStyle, useAreaColor } from './AreaChip';
import { textWidth, useWidth } from './chart';

function Spark({ values }: { values: number[] }) {
  const max = Math.max(1, ...values);
  const w = 100, h = 26;
  const d = values.map((v, i) => `${i ? 'L' : 'M'}${((i / Math.max(1, values.length - 1)) * w).toFixed(1)},${(h - 2 - (v / max) * (h - 4)).toFixed(1)}`).join('');
  return <svg className="sh-spark" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" aria-hidden><path d={d} vectorEffect="non-scaling-stroke" /></svg>;
}

/** Each part of the site: how often it changed, when it appeared, when it was last touched. Tap to filter the timeline. */
export function AreaList({ commits, selected, onSelect }: { commits: HistoryCommit[]; selected: string | null; onSelect: (a: string | null) => void }) {
  const color = useAreaColor();
  const stats = useMemo(() => areaStats(commits), [commits]);
  const card = (a: AreaStat) => (
    <button key={a.name} type="button" className={`sh-area${selected === a.name ? ' on' : ''}`} style={chipStyle(color(a.name))} onClick={() => onSelect(selected === a.name ? null : a.name)} aria-pressed={selected === a.name}>
      <span className="sh-area-top">
        <span className="sh-area-name"><span className="sh-dot" />{a.name}</span>
        <b>{a.count}</b>
      </span>
      <Spark values={a.spark} />
      <small>Arrived {formatDay(a.born, true)} · last {formatDay(a.last, true)}</small>
    </button>
  );
  return (
    <>
      <div className="sh-areas">{stats.filter((a) => !a.support).map(card)}</div>
      <h3 className="sh-h3">Behind the scenes</h3>
      <div className="sh-areas" style={{ marginTop: '0.5rem' }}>{stats.filter((a) => a.support).map(card)}</div>
    </>
  );
}

/**
 * Which areas change together. Areas sit around a circle in the order they arrived, clockwise
 * from the top; a curve joins two areas that shared commits, thicker for more of them.
 */
export function Network({ commits }: { commits: HistoryCommit[] }) {
  const color = useAreaColor();
  const [box, W] = useWidth<HTMLDivElement>(520);
  const [pinned, setPinned] = useState<string | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  const { nodes, edges, all } = useMemo(() => {
    const all = coChange(commits);
    return { nodes: milestones(commits), edges: all.filter((p) => p.n >= 2), all };
  }, [commits]);
  if (nodes.length < 3) return <p className="sh-sub">Not enough areas to draw connections yet.</p>;

  const focus = hovered ?? pinned;
  const size = Math.min(W, 580);
  const fs = size < 420 ? 10 : 11.5;
  const n = nodes.length;
  const angle = (i: number) => -Math.PI / 2 + (i / n) * Math.PI * 2;
  const maxCount = Math.max(...nodes.map((d) => d.count));
  const rNode = (count: number) => 3 + 9 * Math.sqrt(count / maxCount);
  // On a phone, labels at the top and bottom point outwards along their spoke, so neighbours
  // there don't run into each other; elsewhere they sit level beside their node.
  const radial = (i: number) => size < 460 && Math.abs(Math.sin(angle(i))) > 0.7;
  // As big a circle as still leaves room for every label beside its node.
  let R = size / 2 - 30;
  nodes.forEach((d, i) => {
    const c = Math.abs(Math.cos(angle(i)));
    if (c < 0.05) return;
    const len = textWidth(d.area, fs);
    const r = rNode(d.count);
    R = Math.min(R, radial(i) ? (size / 2 - 4) / c - r - 7 - len : (size / 2 - 4 - r - 7 - len) / c);
  });
  R = Math.max(70, R);
  let above = 0;
  let below = 0;
  nodes.forEach((d, i) => {
    const s = Math.sin(angle(i));
    const reach = radial(i) ? (R + rNode(d.count) + 7 + textWidth(d.area, fs)) * Math.abs(s) : R * Math.abs(s) + rNode(d.count) + 18;
    if (s < 0) above = Math.max(above, reach); else below = Math.max(below, reach);
  });
  const cx = size / 2;
  const cy = Math.max(above, R + 20) + 6;
  const H = cy + Math.max(below, R + 20) + 6;
  const pos = new Map(nodes.map((d, i) => [d.area, { x: cx + Math.cos(angle(i)) * R, y: cy + Math.sin(angle(i)) * R, a: angle(i) }]));
  const maxN = Math.max(1, ...edges.map((e) => e.n));
  const touches = (e: { a: string; b: string }, name: string) => e.a === name || e.b === name;
  // A picked area also shows its one-off links, which are too faint to draw for everything.
  const shown = focus ? [...edges, ...all.filter((e) => e.n < 2 && touches(e, focus))] : edges;
  const linked = new Set(focus ? shown.filter((e) => touches(e, focus)).flatMap((e) => [e.a, e.b]) : []);
  const focusColor = focus ? (color(focus) === NEUTRAL ? 'var(--accent-light)' : color(focus)) : '';
  const partners = focus ? all.filter((e) => touches(e, focus)).slice(0, 6) : [];
  const focusNode = focus ? nodes.find((d) => d.area === focus) : null;
  const pairs = all.slice(0, 6);
  const list = focus ? partners : pairs;

  return (
    <div>
      <div ref={box} className="sh-net-box">
        <svg width={size} height={H} viewBox={`0 0 ${size} ${H}`} className="sh-net" role="img" aria-label="Areas of the site joined by the commits they share">
          <circle className="sh-net-ring" cx={cx} cy={cy} r={R} />
          {[...shown].sort((a, b) => Number(focus ? touches(a, focus) : 0) - Number(focus ? touches(b, focus) : 0) || a.n - b.n).map((e) => {
            const a = pos.get(e.a), b = pos.get(e.b);
            if (!a || !b) return null;
            const hot = focus ? touches(e, focus) : false;
            // Near neighbours get a shallow arc; areas across the circle bend through the middle.
            const k = 0.85 * Math.max(0, 1 - Math.hypot(a.x - b.x, a.y - b.y) / (2 * R));
            const qx = cx + ((a.x + b.x) / 2 - cx) * k;
            const qy = cy + ((a.y + b.y) / 2 - cy) * k;
            return (
              <path
                key={`${e.a}|${e.b}`} d={`M${a.x.toFixed(1)},${a.y.toFixed(1)}Q${qx.toFixed(1)},${qy.toFixed(1)} ${b.x.toFixed(1)},${b.y.toFixed(1)}`}
                className="sh-net-edge" strokeWidth={0.8 + (e.n / maxN) * 5}
                style={hot ? { stroke: focusColor, opacity: 0.85 } : { opacity: focus ? 0.05 : 0.14 + 0.3 * (e.n / maxN) }}
              />
            );
          })}
          {nodes.map((d, i) => {
            const p = pos.get(d.area)!;
            const r = rNode(d.count);
            const c = Math.cos(p.a), s = Math.sin(p.a);
            const lx = cx + c * (R + r + 6), ly = cy + s * (R + r + 6);
            const spoke = radial(i);
            const anchor = spoke ? (c < 0 ? 'end' : 'start') : c > 0.2 ? 'start' : c < -0.2 ? 'end' : 'middle';
            const turn = spoke ? (p.a * 180) / Math.PI + (c < 0 ? 180 : 0) : 0;
            const dim = focus && focus !== d.area && !linked.has(d.area);
            return (
              <g
                key={d.area} className={`sh-net-node${focus === d.area ? ' on' : ''}`} opacity={dim ? 0.28 : 1}
                onPointerEnter={(e) => { if (e.pointerType === 'mouse') setHovered(d.area); }}
                onPointerLeave={() => setHovered(null)}
                onClick={() => setPinned(pinned === d.area ? null : d.area)}
              >
                <circle cx={p.x} cy={p.y} r={Math.max(r + 6, 13)} fill="transparent" />
                <circle cx={p.x} cy={p.y} r={r} style={{ fill: color(d.area) }} />
                {spoke
                  ? <text x={lx} y={ly + 3.5} textAnchor={anchor} transform={`rotate(${turn.toFixed(1)} ${lx.toFixed(1)} ${ly.toFixed(1)})`} style={{ fontSize: fs }}>{d.area}</text>
                  : <text x={lx} y={ly + (s < -0.8 ? -1 : s > 0.8 ? 9 : 3.5)} textAnchor={anchor} style={{ fontSize: fs }}>{d.area}</text>}
              </g>
            );
          })}
        </svg>
      </div>
      <p className="sh-fine" style={{ textAlign: 'center' }}>Clockwise from the top in the order they arrived, {nodes[0].area} first and {nodes[nodes.length - 1].area} newest. Bigger dots had more commits. {pinned ? 'Tap it again to let go.' : 'Tap an area to see what it changes with.'}</p>

      <h3 className="sh-h3">{focusNode ? `${focusNode.area}: ${focusNode.count} commits, arrived ${formatDay(focusNode.day, true)}` : 'Most often changed together'}</h3>
      {list.length ? (
        <ul className="sh-pairs">
          {list.map((p) => (
            <li className="sh-pair" key={`${p.a}|${p.b}`}>
              <span>{focus ? (p.a === focus ? p.b : p.a) : `${p.a} + ${p.b}`}</span><b>{p.n}</b>
              <span className="bar"><i style={{ width: `${(p.n / list[0].n) * 100}%`, background: focus ? focusColor : undefined }} /></span>
            </li>
          ))}
        </ul>
      ) : <p className="sh-sub" style={{ marginTop: '0.4rem' }}>It hasn’t shared a commit with another area yet.</p>}
    </div>
  );
}
