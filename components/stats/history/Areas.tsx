'use client';

import { useMemo, useState } from 'react';
import { areaStats, coChange, formatDay, layoutGraph, type AreaStat } from '@/lib/site-history/stats';
import type { HistoryCommit } from '@/lib/site-history/types';
import { areaColor, chipStyle } from './AreaChip';

function Spark({ values }: { values: number[] }) {
  const max = Math.max(1, ...values);
  const w = 100, h = 26;
  const d = values.map((v, i) => `${i ? 'L' : 'M'}${((i / Math.max(1, values.length - 1)) * w).toFixed(1)},${(h - 2 - (v / max) * (h - 4)).toFixed(1)}`).join('');
  return <svg className="sh-spark" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" aria-hidden><path d={d} vectorEffect="non-scaling-stroke" /></svg>;
}

/** Each part of the site: how often it changed, when it appeared, when it was last touched. Tap to filter the timeline. */
export function AreaList({ commits, selected, onSelect }: { commits: HistoryCommit[]; selected: string | null; onSelect: (a: string | null) => void }) {
  const stats = useMemo(() => areaStats(commits), [commits]);
  const card = (a: AreaStat) => (
    <button key={a.name} type="button" className={`sh-area${selected === a.name ? ' on' : ''}`} style={chipStyle(a.name)} onClick={() => onSelect(selected === a.name ? null : a.name)} aria-pressed={selected === a.name}>
      <span className="sh-area-top">
        <span className="sh-area-name"><span className="sh-dot" />{a.name}</span>
        <b>{a.count}</b>
      </span>
      <Spark values={a.spark} />
      <small>Born {formatDay(a.born, true)} · last {formatDay(a.last, true)}</small>
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

const GW = 360, GH = 340;

/** Which areas change together: nodes are areas, a line is shared commits, thicker = more of them. */
export function Connections({ commits }: { commits: HistoryCommit[] }) {
  const [focus, setFocus] = useState<string | null>(null);
  const { pairs, nodes, edges } = useMemo(() => {
    const all = coChange(commits);
    const edges = all.filter((p) => p.n >= 2).slice(0, 30);
    const counts = new Map<string, number>();
    for (const c of commits) for (const a of c.a) counts.set(a, (counts.get(a) ?? 0) + 1);
    const names = [...new Set(edges.flatMap((e) => [e.a, e.b]))].sort();
    const nodes = layoutGraph(names.map((name) => ({ name, count: counts.get(name) ?? 0 })), edges, GW, GH);
    return { pairs: all.slice(0, 8), nodes, edges };
  }, [commits]);
  if (!nodes.length) return <p className="sh-sub">Not enough shared commits to draw connections yet.</p>;

  const byName = new Map(nodes.map((n) => [n.name, n]));
  const maxN = Math.max(...edges.map((e) => e.n));
  const maxCount = Math.max(...nodes.map((n) => n.count));
  const linked = (name: string) => edges.some((e) => (e.a === focus && e.b === name) || (e.b === focus && e.a === name));
  const focusPartners = focus ? edges.filter((e) => e.a === focus || e.b === focus).sort((a, b) => b.n - a.n) : [];

  return (
    <div>
      <svg className="sh-graph" viewBox={`0 0 ${GW} ${GH}`} role="img" aria-label="Areas of the site connected by the commits they share">
        {edges.map((e) => {
          const a = byName.get(e.a)!, b = byName.get(e.b)!;
          const hot = !focus || e.a === focus || e.b === focus;
          return <line key={`${e.a}|${e.b}`} x1={a.x} y1={a.y} x2={b.x} y2={b.y} strokeWidth={0.8 + (e.n / maxN) * 4} opacity={hot ? 0.45 : 0.07} />;
        })}
        {nodes.map((n) => {
          const dim = focus && focus !== n.name && !linked(n.name);
          return (
            <g key={n.name} opacity={dim ? 0.25 : 1} onClick={() => setFocus(focus === n.name ? null : n.name)}>
              <circle cx={n.x} cy={n.y} r={5 + (n.count / maxCount) * 8} fill={areaColor(n.name)} />
              <text x={n.x} y={n.y - 11 - (n.count / maxCount) * 7} textAnchor="middle">{n.name}</text>
            </g>
          );
        })}
      </svg>
      <p className="sh-sub" style={{ textAlign: 'center', margin: '0.3rem 0 0' }}>Tap an area to see what it changes with.</p>

      {focus && (
        <>
          <h3 className="sh-h3">{focus} changes with</h3>
          <ul className="sh-pairs">
            {focusPartners.map((e) => (
              <li className="sh-pair" key={`${e.a}|${e.b}`}>
                <span>{e.a === focus ? e.b : e.a}</span><b>{e.n}</b>
                <span className="bar"><i style={{ width: `${(e.n / focusPartners[0].n) * 100}%` }} /></span>
              </li>
            ))}
          </ul>
        </>
      )}

      <h3 className="sh-h3">Most often changed together</h3>
      <ul className="sh-pairs">
        {pairs.map((p) => (
          <li className="sh-pair" key={`${p.a}|${p.b}`}>
            <span>{p.a} + {p.b}</span><b>{p.n} commits</b>
            <span className="bar"><i style={{ width: `${(p.n / pairs[0].n) * 100}%` }} /></span>
          </li>
        ))}
      </ul>
    </div>
  );
}
