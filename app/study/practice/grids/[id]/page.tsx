'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import SignInPrompt from '@/components/journal/SignInPrompt';
import { useSitePopup } from '@/components/SitePopup';
import { practiceGet, practicePost, SignedOut } from '@/components/study/api';
import { InlineMath } from '@/components/study/InlineMath';
import { fmtDay, pct } from '@/components/study/TestRow';
import { cellKey, GRID_LEVELS, pickHidden, type CompareGrid } from '@/lib/study/practice';

// A grid with holes in it. She says each one to herself, taps to check, and says
// whether she knew it. The ones she misses are hidden first next time.

function FullGrid({ grid, hidden, shown, marks, onShow, onMark }: {
  grid: CompareGrid;
  hidden?: Set<string>;
  shown?: Set<string>;
  marks?: Record<string, boolean>;
  onShow?: (key: string) => void;
  onMark?: (key: string, knew: boolean) => void;
}) {
  return (
    <div className="pr-grid-wrap" tabIndex={0} role="region" aria-label={grid.title}>
      <table className="pr-grid">
        <thead>
          <tr><th scope="col"><span className="sr-only">Name</span></th>{grid.columns.map((c) => <th key={c} scope="col"><InlineMath>{c}</InlineMath></th>)}</tr>
        </thead>
        <tbody>
          {grid.rows.map((row, r) => (
            <tr key={row.name}>
              <th scope="row"><InlineMath>{row.name}</InlineMath></th>
              {row.cells.map((cell, c) => {
                const key = cellKey(r, c);
                const isHidden = hidden?.has(key);
                const mark = marks?.[key];
                if (isHidden && !shown?.has(key)) {
                  return <td key={key} className="is-hidden"><button type="button" aria-label={`Show ${row.name}: ${grid.columns[c]}`} onClick={() => onShow?.(key)}>?</button></td>;
                }
                return (
                  <td key={key} className={mark === true ? 'is-knew' : mark === false ? 'is-missed' : isHidden ? 'is-open' : ''}>
                    <InlineMath>{cell}</InlineMath>
                    {isHidden && mark === undefined && (
                      <span className="pr-cell-marks">
                        <button type="button" className="hb-small-btn" aria-label={`Knew ${row.name}: ${grid.columns[c]}`} onClick={() => onMark?.(key, true)}>✓ Knew it</button>
                        <button type="button" className="hb-small-btn" aria-label={`Missed ${row.name}: ${grid.columns[c]}`} onClick={() => onMark?.(key, false)}>✕ Missed</button>
                      </span>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

type Result = { knew: number; total: number };

export default function GridPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { confirm, popup } = useSitePopup();
  const [state, setState] = useState<'loading' | 'ready' | 'signed-out' | 'error'>('loading');
  const [grid, setGrid] = useState<CompareGrid | null>(null);
  const [level, setLevel] = useState(GRID_LEVELS[1].id);
  const [hidden, setHidden] = useState<Set<string> | null>(null);
  const [shown, setShown] = useState<Set<string>>(new Set());
  const [marks, setMarks] = useState<Record<string, boolean>>({});
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    practiceGet<{ grid: CompareGrid }>(`grid=${encodeURIComponent(id)}`).then((body) => {
      if (cancelled) return;
      setGrid(body.grid);
      setState('ready');
    }).catch((e) => { if (!cancelled) setState(e instanceof SignedOut ? 'signed-out' : 'error'); });
    return () => { cancelled = true; };
  }, [id]);

  if (state === 'signed-out') return <div className="sd"><SignInPrompt title="Sign in to practice">Your grids are only shown to your account.</SignInPrompt></div>;
  const head = (
    <header className="sd-head">
      <div>
        <Link className="sd-back" href="/study/practice">← Practice</Link>
        <h1>{grid?.title ?? 'Comparison grid'}</h1>
        {grid?.course && <p>{grid.course}</p>}
      </div>
    </header>
  );
  if (!grid) {
    return (
      <div className="sd sd-narrow animate-fade-in">
        {head}
        {state === 'loading' ? <p className="hb-hint">Loading…</p> : <div className="hb-banner is-error"><span>That grid isn’t here any more.</span></div>}
      </div>
    );
  }

  const start = () => {
    const share = GRID_LEVELS.find((l) => l.id === level)?.share ?? 0.6;
    setHidden(new Set(pickHidden(grid, share, Date.now() % 100000)));
    setShown(new Set());
    setMarks({});
    setResult(null);
    setError('');
  };
  const finish = async () => {
    setError('');
    try {
      const body = await practicePost<{ result: Result }>('grid-result', { id, results: marks });
      setResult(body.result);
      const fresh = await practiceGet<{ grid: CompareGrid }>(`grid=${encodeURIComponent(id)}`);
      setGrid(fresh.grid);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Couldn’t save that. Try again.');
    }
  };
  const remove = async () => {
    const ok = await confirm({ title: 'Delete this grid?', message: `“${grid.title}” and how you’ve done on it will be gone.`, confirmLabel: 'Delete', danger: true });
    if (!ok) return;
    try {
      await practicePost('delete-grid', { id });
      router.push('/study/practice');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Couldn’t delete it.');
    }
  };

  const marked = Object.keys(marks).length;
  const missed = hidden ? [...hidden].filter((key) => marks[key] === false) : [];
  const last = grid.sessions[grid.sessions.length - 1];

  return (
    <div className="sd animate-fade-in">
      {popup}
      {head}
      {hidden && !result ? (
        <>
          <p className="hb-hint">Say each one to yourself, tap the ? to check, then say whether you knew it. On a phone, the table slides sideways.</p>
          <FullGrid
            grid={grid} hidden={hidden} shown={shown} marks={marks}
            onShow={(key) => setShown((s) => new Set(s).add(key))}
            onMark={(key, knew) => setMarks((m) => ({ ...m, [key]: knew }))}
          />
          {error && <div className="hb-banner is-error" role="alert"><span>{error}</span></div>}
          <div className="pr-grid-foot">
            <span className="sd-count">{marked} of {hidden.size} marked</span>
            <button type="button" className="btn btn-primary" disabled={!marked} onClick={finish}>{marked === hidden.size ? 'Finish' : 'Finish early'}</button>
          </div>
        </>
      ) : result ? (
        <>
          <section className="sd-card sd-done">
            <h2>You knew {result.knew} of {result.total}</h2>
            <p className="hb-hint">{missed.length ? 'What you missed comes back first next time.' : 'Every one. Try hiding more next time.'}</p>
            {missed.length > 0 && (
              <ul className="pr-missed">
                {missed.map((key) => {
                  const [r, c] = key.split(':').map(Number);
                  return <li key={key}><strong><InlineMath>{grid.rows[r].name}</InlineMath>, <InlineMath>{grid.columns[c]}</InlineMath>:</strong> <InlineMath>{grid.rows[r].cells[c]}</InlineMath></li>;
                })}
              </ul>
            )}
            <div className="sd-actions">
              <button type="button" className="btn btn-primary" onClick={start}>Go again</button>
              <Link className="btn btn-secondary" href="/study/practice">Done</Link>
            </div>
          </section>
          <FullGrid grid={grid} />
        </>
      ) : (
        <>
          <section className="sd-card">
            <h2>How much to hide</h2>
            <div className="sd-segments" role="radiogroup" aria-label="How much to hide">
              {GRID_LEVELS.map((l) => <button key={l.id} type="button" role="radio" aria-checked={level === l.id} onClick={() => setLevel(l.id)}>{l.label}</button>)}
            </div>
            {last && <p className="hb-hint">Last time you knew {pct(last.knew, last.total)}%, on {fmtDay(last.on)}.</p>}
            <button type="button" className="btn btn-primary sd-self-start" onClick={start}>Start</button>
          </section>
          <details className="sd-card pr-peek">
            <summary>Look at the whole grid first</summary>
            <FullGrid grid={grid} />
          </details>
          {error && <div className="hb-banner is-error" role="alert"><span>{error}</span></div>}
          <button type="button" className="hb-text-btn sd-self-start" onClick={remove}>Delete this grid</button>
        </>
      )}
    </div>
  );
}
