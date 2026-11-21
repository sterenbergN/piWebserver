'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { checkpointTitle, checkpointView, compact, formatDay, siteMap, treeUrl, type MapSection } from '@/lib/site-history/stats';
import type { HistoryData } from '@/lib/site-history/types';
import { chipStyle, useAreaColor } from './AreaChip';
import { prefersReducedMotion } from './chart';

const STEP_MS = 1400;
const MINI_COLS = 20;

/** A tiny site map for a filmstrip frame: one dot per page, in section order, new ones bright. */
function MiniMap({ sections, added, rows }: { sections: MapSection[]; added: Set<string>; rows: number }) {
  const color = useAreaColor();
  const pages = sections.flatMap((s) => s.pages.map((p) => ({ p, area: s.area })));
  return (
    <svg className="sh-mini" viewBox={`0 0 ${MINI_COLS * 5} ${rows * 5}`} aria-hidden>
      {pages.map(({ p, area }, i) => (
        <rect key={p} x={(i % MINI_COLS) * 5} y={Math.floor(i / MINI_COLS) * 5} width={4} height={4} rx={1} className={added.has(p) ? 'new' : ''} style={added.has(p) ? undefined : { fill: color(area) }} />
      ))}
    </svg>
  );
}

/** Wayback: step through checkpoints and watch the site map fill in. */
export default function Wayback({ data }: { data: HistoryData }) {
  const color = useAreaColor();
  const last = data.checkpoints.length - 1;
  const [index, setIndex] = useState(last);
  const [playing, setPlaying] = useState(false);
  const [tile, setTile] = useState<string | null>(null);
  const strip = useRef<HTMLDivElement>(null);
  const views = useMemo(() => data.checkpoints.map((_, i) => checkpointView(data, i)!), [data]);
  const maps = useMemo(() => views.map((v) => siteMap(v.routes, data.routes)), [views, data.routes]);
  const added = useMemo(() => views.map((v) => new Set(v.added)), [views]);
  const rows = Math.max(1, ...views.map((v) => Math.ceil(v.routes.length / MINI_COLS)));

  useEffect(() => {
    if (!playing) return;
    const t = setTimeout(() => { if (index >= last) setPlaying(false); else setIndex(index + 1); }, STEP_MS);
    return () => clearTimeout(t);
  }, [playing, index, last]);

  // Keep the current frame in the middle of the strip, without moving the page itself.
  useEffect(() => {
    const el = strip.current;
    const card = el?.children[index] as HTMLElement | undefined;
    if (!el || !card) return;
    el.scrollTo({ left: card.offsetLeft - el.clientWidth / 2 + card.offsetWidth / 2, behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
  }, [index]);

  const view = views[index];
  if (!view) return null;
  const isNew = added[index];
  const removed = new Set(view.removed);
  // Removed pages stay on the map as ghosts for one step, so a disappearance is visible too.
  const sections = siteMap([...view.routes, ...view.removed], data.routes);
  const before = new Set(index > 0 ? views[index - 1].routes.map((r) => r.split('/')[1] ?? '') : []);
  const tree = treeUrl(data.repo, view.hash);
  const go = (i: number) => { setPlaying(false); setIndex(Math.max(0, Math.min(last, i))); };
  const play = () => {
    if (playing) { setPlaying(false); return; }
    if (index >= last) setIndex(0);
    setPlaying(true);
  };

  return (
    <div className="sh-wayback">
      <div className="sh-wb-head">
        <div>
          <div className="sh-wb-title">{checkpointTitle(view.label, view.kind)}</div>
          <div className="sh-wb-when">{formatDay(view.day, true)} · commit {view.commitNumber} of {data.commits.length}</div>
        </div>
        <div className="sh-wb-nums">
          <span><b>{view.routes.length}</b> pages</span>
          <span><b>{compact(view.loc)}</b> lines</span>
        </div>
      </div>

      <div className="sh-slider">
        <button type="button" className="sh-btn sh-play" onClick={play} aria-label={playing ? 'Pause' : 'Play through time'}><svg viewBox="0 0 16 16" width="14" height="14" aria-hidden>{playing ? <path d="M4 3h3v10H4zM9 3h3v10H9z" /> : <path d="M4.5 2.5v11l9-5.5z" />}</svg><span>{playing ? 'Pause' : 'Play'}</span></button>
        <button type="button" className="sh-btn" aria-label="Earlier checkpoint" disabled={index <= 0} onClick={() => go(index - 1)}>‹</button>
        <input type="range" min={0} max={last} step={1} value={index} aria-label="Checkpoint" onChange={(e) => go(Number(e.target.value))} />
        <button type="button" className="sh-btn" aria-label="Later checkpoint" disabled={index >= last} onClick={() => go(index + 1)}>›</button>
      </div>

      <div className="sh-map" onPointerLeave={() => setTile(null)}>
        {sections.map((s) => {
          const fresh = index > 0 && !before.has(s.key) && s.pages.some((p) => !removed.has(p));
          return (
            <div key={s.key} className={`sh-block${fresh ? ' new' : ''}${s.pages.every((p) => removed.has(p)) ? ' gone' : ''}`} style={chipStyle(color(s.area))}>
              <span className="sh-block-name">{s.label}</span>
              <span className="sh-block-tiles">
                {s.pages.map((p) => (
                  <button
                    key={p} type="button" aria-label={p}
                    className={`sh-pg${isNew.has(p) ? ' new' : ''}${removed.has(p) ? ' gone' : ''}`}
                    onPointerEnter={() => setTile(p)} onFocus={() => setTile(p)} onClick={() => setTile(p)}
                  />
                ))}
              </span>
            </div>
          );
        })}
      </div>
      <p className="sh-map-caption">
        {tile
          ? <><code>{tile}</code>{isNew.has(tile) ? ' · new here' : removed.has(tile) ? ' · gone here' : ''}</>
          : index > 0 && (view.added.length || view.removed.length)
            ? <>{view.added.length > 0 && <span className="sh-new-key"><i /> {view.added.length} new page{view.added.length === 1 ? '' : 's'}</span>}{view.removed.length > 0 && <span> · {view.removed.length} removed</span>} · tap a square to see which</>
            : 'Each square is a page, grouped by section. Tap one to see which.'}
      </p>

      <div className="sh-strip" ref={strip} role="listbox" aria-label="Checkpoints">
        {data.checkpoints.map((cp, i) => (
          <button key={cp.c} type="button" role="option" aria-selected={i === index} className={`sh-frame${i === index ? ' on' : ''}${i < index ? ' past' : ''}`} onClick={() => go(i)}>
            <MiniMap sections={maps[i]} added={added[i]} rows={rows} />
            <span className="sh-frame-title">{checkpointTitle(cp.label, cp.kind)}</span>
            <span className="sh-frame-when">{formatDay(views[i].day)} · {views[i].routes.length} pages</span>
          </button>
        ))}
      </div>

      <p className="sh-fine" style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap', alignItems: 'center' }}>
        {tree && <a className="sh-link" href={tree} target="_blank" rel="noreferrer">Browse the code at this point ↗</a>}
        <span>Pages are read from the code at each checkpoint: the start of each month, and the day each area arrived.</span>
      </p>
    </div>
  );
}
