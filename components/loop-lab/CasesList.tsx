'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { benchOn, metaOf } from '@/lib/loop-lab/catalog';
import { CASES } from '@/lib/loop-lab/content';
import { getProcess } from '@/lib/loop-lab/processes';

/** The case studies, filtered by verdict or searched by name, process or controller. */
export default function CasesList() {
  const [family, setFamily] = useState<'all' | 'pid-wins' | 'escalation'>('all');
  const [search, setSearch] = useState('');

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return CASES.filter((c) => {
      if (family !== 'all' && c.family !== family) return false;
      if (!q) return true;
      const proc = getProcess(c.process);
      const ctrls = c.steps.flatMap((s) => s.presets?.map((p) => metaOf(p.controller.kind)?.short ?? p.controller.kind) ?? []);
      const haystack = `${c.title} ${c.question} ${proc.name} ${ctrls.join(' ')}`.toLowerCase();
      return haystack.includes(q);
    });
  }, [family, search]);

  const pidWinsCount = CASES.filter((c) => c.family === 'pid-wins').length;
  const escalationCount = CASES.filter((c) => c.family === 'escalation').length;

  return (
    <div className="ll ll-index">
      <header className="ll-title">
        <h1>Case Studies</h1>
        <p>
          Step-by-step industrial problems with live simulations and honest engineering verdicts.
          From flow loops where PI is all you need to high-order multi-variable processes requiring state feedback or MPC.
        </p>
      </header>

      <div className="ll-filter-bar">
        <div className="ll-seg" role="group" aria-label="Filter case studies by family">
          <button
            aria-pressed={family === 'all'}
            onClick={() => setFamily('all')}
          >
            All ({CASES.length})
          </button>
          <button
            aria-pressed={family === 'pid-wins'}
            onClick={() => setFamily('pid-wins')}
          >
            PID is the answer ({pidWinsCount})
          </button>
          <button
            aria-pressed={family === 'escalation'}
            onClick={() => setFamily('escalation')}
          >
            PID falls short: escalation ({escalationCount})
          </button>
        </div>

        <input
          type="search"
          className="ll-search-input"
          placeholder="Search by title, process, controller, or symptom…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          aria-label="Search case studies"
        />
      </div>

      {filtered.length === 0 ? (
        <div className="ll-empty">
          <p>No case studies matched &ldquo;{search}&rdquo; in this filter.</p>
          <button className="ll-btn is-small" onClick={() => { setSearch(''); setFamily('all'); }}>
            Reset filters
          </button>
        </div>
      ) : (
        <div className="ll-case-grid">
          {filtered.map((c) => {
            const proc = getProcess(c.process);
            const featuredControllers = Array.from(
              new Set(
                c.steps.flatMap((s) => s.presets?.map((p) => metaOf(p.controller.kind)?.short ?? p.controller.kind) ?? [])
              )
            );

            return (
              <article key={c.id} className="ll-case-card">
                <div className="ll-case-meta">
                  <span className="ll-badge">
                    <span aria-hidden>{proc.icon}</span> {proc.name}
                  </span>
                  {c.family === 'pid-wins' ? (
                    <span className="ll-badge is-good">PID wins</span>
                  ) : (
                    <span className="ll-badge is-warn">PID falls short</span>
                  )}
                  <span className="ll-badge">{c.steps.length} steps</span>
                </div>

                <h2 className="ll-case-title">
                  <Link href={`/loop-lab/cases/${c.id}`}>{c.title}</Link>
                </h2>

                <p className="ll-case-q">{c.question}</p>

                {featuredControllers.length > 0 && (
                  <div className="ll-case-controllers">
                    <span className="ll-small">Featured:</span>
                    {featuredControllers.map((ctrl) => (
                      <span key={ctrl} className="ll-chip-text-badge">{ctrl}</span>
                    ))}
                  </div>
                )}

                <div className="ll-case-actions">
                  <Link className="ll-btn is-small is-primary" href={`/loop-lab/cases/${c.id}`}>
                    Read worked case →
                  </Link>
                  <Link className="ll-btn is-small" href={benchOn(c.process)}>
                    Open process on bench
                  </Link>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
