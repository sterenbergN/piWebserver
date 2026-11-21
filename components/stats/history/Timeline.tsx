'use client';

import { useMemo, useState } from 'react';
import { commitUrl, filterCommits, formatDay, groupTimeline, dayOf } from '@/lib/site-history/stats';
import type { HistoryCommit } from '@/lib/site-history/types';
import AreaChip from './AreaChip';

const PAGE = 60;

/** Every commit, newest first, grouped by month and week. Tap one to open its message and changes. */
export default function Timeline({ commits, repo, area, onArea }: { commits: HistoryCommit[]; repo: string | null; area: string | null; onArea: (a: string | null) => void }) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const [shown, setShown] = useState(PAGE);
  const filtered = useMemo(() => filterCommits(commits, area, query), [commits, area, query]);
  // Newest first; only the first `shown` are drawn, and they are grouped afterwards.
  const visible = useMemo(() => filtered.slice(Math.max(0, filtered.length - shown)), [filtered, shown]);
  const groups = useMemo(() => groupTimeline(visible), [visible]);

  return (
    <div>
      <div className="sh-controls">
        <input className="sh-search" type="search" placeholder="Search commits…" value={query} onChange={(e) => { setQuery(e.target.value); setShown(PAGE); }} aria-label="Search commits" />
        {area && <div className="sh-chips"><AreaChip name={area} on count={undefined} onClick={() => onArea(null)} /><span className="sh-sub" style={{ margin: 0 }}>filtered · tap to clear</span></div>}
      </div>
      <p className="sh-sub">{filtered.length} commit{filtered.length === 1 ? '' : 's'}{area || query ? ' match' : ''}</p>

      {groups.map((m) => (
        <section key={m.key}>
          <h3 className="sh-month">{m.label}<small>{m.count} shown</small></h3>
          {m.weeks.map((w) => (
            <div key={w.start}>
              <div className="sh-week">{w.label}</div>
              {w.commits.map((c) => {
                const isOpen = open === c.h;
                const link = commitUrl(repo, c.h);
                return (
                  <div className="sh-commit" key={c.h}>
                    <button type="button" className="sh-commit-btn" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : c.h)}>
                      <span className="sh-commit-s">{c.s}</span>
                      <span className="sh-commit-meta">
                        <span>{formatDay(dayOf(c))}</span>
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
