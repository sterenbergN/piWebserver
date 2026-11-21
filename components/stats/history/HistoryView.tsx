'use client';

import { useMemo, useRef, useState } from 'react';
import { areaPalette, summarize, workSessions } from '@/lib/site-history/stats';
import type { HistoryData } from '@/lib/site-history/types';
import { AreaColors } from './AreaChip';
import { AreaList, Network } from './Areas';
import Focus from './Focus';
import Hero from './Hero';
import Rhythm from './Rhythm';
import Timeline from './Timeline';
import Wayback from './Wayback';
import './history.css';

// The page reads as a story: how big it grew, what the attention was on, when the work
// happened, what the site looked like along the way, how the parts hang together, then every commit.
export default function HistoryView({ data }: { data: HistoryData }) {
  const [area, setArea] = useState<string | null>(null);
  const timeline = useRef<HTMLElement>(null);
  const today = data.generated.slice(0, 10);
  const summary = useMemo(() => summarize(data.commits, today), [data.commits, today]);
  const work = useMemo(() => workSessions(data.commits), [data.commits]);
  const palette = useMemo(() => areaPalette(data.commits), [data.commits]);
  const keep = useMemo(() => Object.keys(palette), [palette]);

  // Picking an area card filters the timeline, so bring the timeline into view.
  const pickArea = (a: string | null) => {
    setArea(a);
    if (a) timeline.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <AreaColors palette={palette}>
      <div className="sh-page animate-fade-in">
        <Hero data={data} summary={summary} work={work} />

        {data.shallow && <div className="sh-note">This build only had part of the history, so the numbers here are for recent commits only.</div>}

        <section className="glass-panel sh-panel">
          <h2>Where the attention went</h2>
          <p className="sh-sub">Commits each week, stacked by area; a commit that touched several areas is shared between them. Long quiet stretches are squeezed so the busy ones have room. Hover or tap the chart for a week, or a name to pick out one area.</p>
          <Focus commits={data.commits} keep={keep} />
        </section>

        <section className="glass-panel sh-panel">
          <h2>When the work happened</h2>
          <p className="sh-sub">One square per day; darker means more commits. Tap a day to see them.</p>
          <Rhythm commits={data.commits} today={today} work={work} />
        </section>

        <section className="glass-panel sh-panel">
          <h2>Wayback</h2>
          <p className="sh-sub">The site’s pages at each checkpoint. Press play to watch it grow; bright squares are pages that just arrived.</p>
          <Wayback data={data} />
        </section>

        <section className="glass-panel sh-panel">
          <h2>How the parts connect</h2>
          <p className="sh-sub">Areas that keep changing in the same commit are joined.</p>
          <Network commits={data.commits} />
          <h3 className="sh-h3" style={{ marginTop: '1.4rem' }}>Every area</h3>
          <p className="sh-sub" style={{ margin: '0.2rem 0 0.6rem' }}>By how many commits touched it. Tap one to filter the timeline.</p>
          <AreaList commits={data.commits} selected={area} onSelect={pickArea} />
        </section>

        <section className="glass-panel sh-panel" ref={timeline}>
          <h2>Every commit</h2>
          <Timeline commits={data.commits} repo={data.repo} area={area} onArea={setArea} />
        </section>

        <p className="sh-sub" style={{ textAlign: 'center' }}>Updated with each release · {today}</p>
      </div>
    </AreaColors>
  );
}
