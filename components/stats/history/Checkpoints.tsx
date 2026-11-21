'use client';

import { checkpointView, compact, formatDay, treeUrl } from '@/lib/site-history/stats';
import type { HistoryData } from '@/lib/site-history/types';

/** Wayback-lite: pick a moment and see which pages existed, what was new, and how big the code was. */
export default function Checkpoints({ data, index, onChange }: { data: HistoryData; index: number; onChange: (i: number) => void }) {
  const last = data.checkpoints.length - 1;
  const view = checkpointView(data, index);
  if (!view) return null;
  const tree = treeUrl(data.repo, view.hash);

  return (
    <div>
      <div className="sh-cp-head">
        <span className="sh-cp-title">{view.label}</span>
        <span className="sh-cp-when">{formatDay(view.day, true)} · commit {view.commitNumber} of {data.commits.length}</span>
      </div>
      <div className="sh-slider">
        <button type="button" className="sh-btn" aria-label="Earlier checkpoint" disabled={index <= 0} onClick={() => onChange(index - 1)}>‹</button>
        <input type="range" min={0} max={last} step={1} value={index} aria-label="Checkpoint" onChange={(e) => onChange(Number(e.target.value))} />
        <button type="button" className="sh-btn" aria-label="Later checkpoint" disabled={index >= last} onClick={() => onChange(index + 1)}>›</button>
      </div>
      <p className="sh-sub" style={{ margin: 0 }}>
        {view.routes.length} pages · about {compact(view.loc)} lines of code at this point ({index + 1} of {last + 1} checkpoints)
      </p>

      {index > 0 && (
        <>
          <h3 className="sh-h3">New since the previous checkpoint</h3>
          {view.added.length || view.removed.length ? (
            <div className="sh-routes">
              {view.added.map((r) => <span key={r} className="sh-route new">+ {r}</span>)}
              {view.removed.map((r) => <span key={r} className="sh-route gone">{r}</span>)}
            </div>
          ) : <p className="sh-sub" style={{ marginTop: '0.4rem' }}>No new pages, just changes inside the existing ones.</p>}
        </>
      )}

      <details className="sh-details">
        <summary>All {view.routes.length} pages at this point</summary>
        <div className="sh-routes">
          {view.routes.map((r) => <span key={r} className={`sh-route${view.added.includes(r) ? ' new' : ''}`}>{r}</span>)}
        </div>
      </details>

      <p style={{ margin: '0.9rem 0 0', display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
        {tree && <a className="sh-btn" href={tree} target="_blank" rel="noreferrer">Browse the code here ↗</a>}
        <span className="sh-sub" style={{ margin: 0 }}>Page lists come from the code at that commit; there are no screenshots.</span>
      </p>
    </div>
  );
}
