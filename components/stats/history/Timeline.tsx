'use client';

import { useMemo, useState, type CSSProperties } from 'react';
import { bigDays, commitUrl, compact, filterCommits, formatDay, groupTimeline, dayOf, isSiteArea } from '@/lib/site-history/stats';
import type { HistoryCommit } from '@/lib/site-history/types';
import AreaChip, { NEUTRAL, useAreaColor } from './AreaChip';

const PAGE = 60;

/** A month's commits split by area, as one thin bar: what that month was mostly about. */
function MonthMix({ commits }: { commits: HistoryCommit[] }) {
  const color = useAreaColor();
  const shares = new Map<string, number>();
  for (const c of commits) {
    const site = c.a.filter(isSiteArea);
    const areas = site.length ? site : ['Behind the scenes'];
    for (const a of areas) shares.set(a, (shares.get(a) ?? 0) + 1 / areas.length);
  }
  // Coloured areas first, biggest first; everything grey shares one segment at the end.
  const coloured = [...shares.entries()].filter(([a]) => color(a) !== NEUTRAL).sort((x, y) => y[1] - x[1]);
  const rest = [...shares.entries()].filter(([a]) => color(a) === NEUTRAL).reduce((sum, [, v]) => sum + v, 0);
  const parts: [string, number][] = rest > 0 ? [...coloured, ['Everything else', rest]] : coloured;
  const total = commits.length || 1;
  const named = coloured.slice(0, 3).map(([a]) => a);
  return (
    <div className="sh-mix" title={parts.map(([a, v]) => `${a}: ${Math.round(v)}`).join(', ')}>
      <span className="sh-mix-bar" aria-hidden>
        {parts.map(([a, v]) => <i key={a} style={{ flexGrow: v / total, background: color(a) }} />)}
      </span>
      {named.length > 0 && <small>Mostly {named.join(', ')}</small>}
    </div>
  );
}

/** Every commit, newest first, grouped by month and week. Tap one to open its message and changes. */
export default function Timeline({ commits, repo, area, onArea }: { commits: HistoryCommit[]; repo: string | null; area: string | null; onArea: (a: string | null) => void }) {
  const color = useAreaColor();
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const [shown, setShown] = useState(PAGE);
  const filtered = useMemo(() => filterCommits(commits, area, query), [commits, area, query]);
  // Newest first; only the first `shown` are drawn, and they are grouped afterwards.
  const visible = useMemo(() => filtered.slice(Math.max(0, filtered.length - shown)), [filtered, shown]);
  const groups = useMemo(() => groupTimeline(visible), [visible]);
  const big = useMemo(() => new Map(bigDays(commits, 5).map((b) => [b.day, b])), [commits]);
  const dotColor = (c: HistoryCommit) => color(c.a.find(isSiteArea) ?? c.a[0] ?? '');

  return (
    <div>
      <div className="sh-controls">
        <input className="sh-search" type="search" placeholder="Search commits…" value={query} onChange={(e) => { setQuery(e.target.value); setShown(PAGE); }} aria-label="Search commits" />
        {area && <div className="sh-chips"><AreaChip name={area} on onClick={() => onArea(null)} /><span className="sh-sub" style={{ margin: 0 }}>filtered · tap to clear</span></div>}
      </div>
      <p className="sh-sub">{filtered.length} commit{filtered.length === 1 ? '' : 's'}{area || query ? ' match' : ''}</p>

      {groups.map((m) => (
        <section key={m.key}>
          <h3 className="sh-month">{m.label}<small>{m.count} shown</small></h3>
          {!area && !query && <MonthMix commits={m.weeks.flatMap((w) => w.commits)} />}
          {m.weeks.map((w) => (
            <div key={w.start}>
              <div className="sh-week">{w.label}</div>
              {w.commits.map((c, i) => {
                const isOpen = open === c.h;
                const link = commitUrl(repo, c.h);
                const day = dayOf(c);
                const bd = big.get(day);
                const firstOfDay = i === 0 || dayOf(w.commits[i - 1]) !== day;
                return (
                  <div key={c.h}>
                    {bd && firstOfDay && (
                      <div className="sh-bigday">
                        <strong>Big day · {formatDay(day)}</strong>
                        <span>{bd.commits} commits, <span className="sh-plus">+{compact(bd.added)}</span> <span className="sh-minus">−{compact(bd.removed)}</span> lines</span>
                      </div>
                    )}
                    <div className="sh-commit" style={{ '--dot': dotColor(c) } as CSSProperties}>
                      <button type="button" className="sh-commit-btn" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : c.h)}>
                        <span className="sh-commit-s">{c.s}</span>
                        <span className="sh-commit-meta">
                          <span>{formatDay(day)}</span>
                          {c.a.slice(0, 3).map((a) => <AreaChip key={a} name={a} />)}
                          {c.a.length > 3 && <span>+{c.a.length - 3}</span>}
                          <span className="sh-plus">+{c.ad}</span><span className="sh-minus">−{c.de}</span>
                        </span>
                      </button>
                      {isOpen && (
                        <div>
                          {c.b && <div className="sh-body">{c.b}</div>}
                          <div className="sh-chips">{c.a.map((a) => <AreaChip key={a} name={a} on={a === area} onClick={() => onArea(a === area ? null : a)} />)}</div>
                          <ul className="sh-files">
                            <li>{c.f} code file{c.f === 1 ? '' : 's'} changed · {c.d.slice(11)}</li>
                            {c.tf.map((f) => <li key={f}>{f}</li>)}
                          </ul>
                          {link && <a className="sh-link" href={link} target="_blank" rel="noreferrer">View on GitHub ↗</a>}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          ))}
        </section>
      ))}
      {filtered.length > visible.length && (
        <button type="button" className="sh-btn sh-more" onClick={() => setShown(shown + PAGE)}>Show older commits ({filtered.length - visible.length} more)</button>
      )}
    </div>
  );
}
