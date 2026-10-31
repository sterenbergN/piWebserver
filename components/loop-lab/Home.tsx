'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { CASES, getCase } from '@/lib/loop-lab/content';
import { CONTROLLER_KINDS, defaultController } from '@/lib/loop-lab/controllers';
import { defaultParams } from '@/lib/loop-lab/model';
import { getProcess, PROCESSES } from '@/lib/loop-lab/processes';
import Chart from './Chart';
import { computeRuns, type RunSet } from './useRuns';

const STARTERS = ['flow-pi', 'tank-schedule', 'hx-cascade-ff'];

/** The whole idea in one picture: the same upset, one PI against a cascade. */
function HeroChart() {
  const proc = getProcess('hx');
  const [runs, setRuns] = useState<RunSet[] | null>(null);
  useEffect(() => {
    const id = window.setTimeout(() => {
      const params = defaultParams(proc);
      setRuns((['pid', 'cascade'] as const).map((k) => computeRuns({ process: proc.id, params, controller: defaultController(k, proc) }, ['steam-pressure'], false)));
    }, 0);
    return () => window.clearTimeout(id);
  }, [proc]);
  const [pid, cascade] = runs ?? [];
  return (
    <figure className="ll-hero-fig">
      <figcaption>Steam pressure drops on a heat exchanger. Same upset, two controllers.</figcaption>
      <div className="ll-hero-plot">
        {pid && cascade && (
          <Chart label="Outlet temperature after a steam pressure drop, with a PI and with a cascade" height={230} x={{ label: 'Time (s)' }} y={{ label: `${proc.pv.label} (${proc.pv.unit})` }}
            series={[
              { label: 'Setpoint', color: 'var(--ll-sp)', x: pid.runs[0].trace.t, y: pid.runs[0].trace.sp, dash: '5 4', width: 1.3 },
              { label: 'One PI', color: 'var(--habit-2)', x: pid.runs[0].trace.t, y: pid.runs[0].trace.pvTrue, width: 2 },
              { label: 'Cascade', color: 'var(--habit-1)', x: cascade.runs[0].trace.t, y: cascade.runs[0].trace.pvTrue, width: 2 },
            ]} />
        )}
      </div>
    </figure>
  );
}

export default function Home() {
  return (
    <div className="ll ll-home">
      <header className="ll-hero">
        <div>
          <h1>See where PID is enough, and where it isn&rsquo;t.</h1>
          <p>Put a controller on a realistic process and run the same tests every time. Each loop is shown the way a mechanical engineer, a control engineer and an automation engineer would look at it, down to the SCL.</p>
          <div className="ll-actions">
            <Link className="ll-btn is-primary is-large" href="/loop-lab/bench">Open the bench</Link>
            <Link className="ll-btn is-large" href="/loop-lab/cases/flow-pi">Start with a case study</Link>
          </div>
        </div>
        <HeroChart />
      </header>

      <section className="ll-paths" aria-label="What you can do here">
        <Link className="ll-path" href="/loop-lab/bench">
          <h2>Experiment</h2>
          <p>Pick a process and a controller, auto-tune it, read the results. Keep a setup and compare it with the next.</p>
          <span className="ll-path-go">The bench</span>
        </Link>
        <Link className="ll-path" href="/loop-lab/cases">
          <h2>Learn</h2>
          <p>{CASES.length} worked problems, each ending in an honest verdict, including the ones where PI is all you need.</p>
          <span className="ll-path-go">Case studies</span>
        </Link>
        <div className="ll-path">
          <h2>Look it up</h2>
          <p>The theory, the tuning and the implementation of every piece of plant and every rung of the ladder.</p>
          <span className="ll-path-links">
            <Link className="ll-path-go" href="/loop-lab/processes">{PROCESSES.length} processes</Link>
            <Link className="ll-path-go" href="/loop-lab/controllers">{CONTROLLER_KINDS.length} controllers</Link>
          </span>
        </div>
      </section>

      <section className="ll-section">
        <div className="ll-section-head">
          <h2>Good places to start</h2>
          <Link href="/loop-lab/cases">All case studies</Link>
        </div>
        <div className="ll-rows">
          {STARTERS.map((id) => {
            const c = getCase(id)!;
            return (
              <Link key={id} className="ll-row" href={`/loop-lab/cases/${id}`}>
                <span className="ll-row-mark" aria-hidden>{getProcess(c.process).icon}</span>
                <span className="ll-row-text"><strong>{c.title}</strong><span>{c.question}</span></span>
              </Link>
            );
          })}
        </div>
      </section>
    </div>
  );
}
