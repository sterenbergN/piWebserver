'use client';

import Link from 'next/link';
import { useMemo, useRef, useState } from 'react';
import { checkpointView, summarize } from '@/lib/site-history/stats';
import type { HistoryData } from '@/lib/site-history/types';
import { Heatmap, Headline, SizeChart } from './Activity';
import { AreaList, Connections } from './Areas';
import Checkpoints from './Checkpoints';
import Timeline from './Timeline';
import './history.css';

export default function HistoryView({ data }: { data: HistoryData }) {
  const [area, setArea] = useState<string | null>(null);
  const [cp, setCp] = useState(Math.max(0, data.checkpoints.length - 1));
  const timeline = useRef<HTMLElement>(null);
  const today = data.generated.slice(0, 10);
  const summary = useMemo(() => summarize(data.commits, today), [data.commits, today]);
  const marker = checkpointView(data, cp)?.day;

  // Picking an area anywhere filters the timeline, so bring the timeline into view.
  const pickArea = (a: string | null) => {
    setArea(a);
    if (a) timeline.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <div className="sh-page animate-fade-in">
      <div>
        <Link href="/stats" className="sh-back">‹ Stats</Link>
        <h1>How this site was built</h1>
        <p className="sh-lede">Everything here is read from the site's own commit history: what changed, when, and which parts of the site changed together.</p>
      </div>

      {data.shallow && <div className="sh-note">This build only had part of the history, so the numbers below are for recent commits only.</div>}

      <Headline s={summary} />

      <section className="glass-panel sh-panel">
        <h2>Activity</h2>
        <p className="sh-sub">One square per day; darker means more commits. Tap a day to see them.</p>
        <Heatmap commits={data.commits} />
      </section>

      <section className="glass-panel sh-panel">
        <h2>Code size</h2>
        <p className="sh-sub">Lines of code over time. Lockfiles, site data, images and fonts aren't counted.</p>
        <SizeChart commits={data.commits} marker={marker} />
      </section>

      <section className="glass-panel sh-panel">
        <h2>Checkpoints</h2>
        <p className="sh-sub">Slide back through time to see which pages the site had. A checkpoint is the start of each month, or the day a section first appeared.</p>
        <Checkpoints data={data} index={cp} onChange={setCp} />
      </section>

      <section className="glass-panel sh-panel">
        <h2>Areas</h2>
        <p className="sh-sub">The sections of the site, by how many commits touched them. Tap one to filter the timeline.</p>
        <AreaList commits={data.commits} selected={area} onSelect={pickArea} />
      </section>

      <section className="glass-panel sh-panel">
        <h2>Connections</h2>
        <p className="sh-sub">Sections that keep changing in the same commit sit close together.</p>
        <Connections commits={data.commits} />
      </section>

      <section className="glass-panel sh-panel" ref={timeline}>
        <h2>Timeline</h2>
        <Timeline commits={data.commits} repo={data.repo} area={area} onArea={setArea} />
      </section>

      <p className="sh-sub" style={{ textAlign: 'center' }}>Updated with each release · {data.generated.slice(0, 10)}</p>
    </div>
  );
}
