'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { CASES, getCase } from '@/lib/loop-lab/content';
import {
  CONTROLLER_KINDS,
  defaultController,
  DEFAULT_PID,
  type ControllerConfig,
  type ControllerKind,
} from '@/lib/loop-lab/controllers';
import { defaultParams, type ProcessDef, type ProcessId } from '@/lib/loop-lab/model';
import { getProcess, PROCESSES } from '@/lib/loop-lab/processes';
import { benchOn, CONTROLLER_GROUPS, KIND_HINT, metaOf } from '@/lib/loop-lab/catalog';
import { defaultSummary, type PlantSummary } from '@/lib/loop-lab/plant';
import Chart, { fmt } from './Chart';
import { computeRuns, type RunSet } from './useRuns';

const STARTERS = ['flow-pi', 'tank-schedule', 'hx-cascade-ff'];

type ShowcaseId = 'hx' | 'feeder' | 'tank';

interface ShowcaseItem {
  id: ShowcaseId;
  tabTitle: string;
  procId: ProcessId;
  title: string;
  tagline: string;
  kinds: [ControllerKind, ControllerKind];
  labels: [string, string];
  colors: [string, string];
  scenarioIds: string[];
}

const SHOWCASES: ShowcaseItem[] = [
  {
    id: 'hx',
    tabTitle: 'Heat Exchanger',
    procId: 'hx',
    title: 'Steam pressure drops on a heat exchanger',
    tagline: 'Steam pressure drop — One PI vs Cascade',
    kinds: ['pid', 'cascade'],
    labels: ['One PI', 'Cascade'],
    colors: ['var(--habit-2)', 'var(--habit-1)'],
    scenarioIds: ['steam-pressure'],
  },
  {
    id: 'feeder',
    tabTitle: 'Belt Weigh Feeder',
    procId: 'feeder',
    title: 'Dead-time dominant step on a weigh feeder',
    tagline: 'Dead-time dominant step — One PI vs Smith Predictor',
    kinds: ['pid', 'smith'],
    labels: ['One PI', 'Smith Predictor'],
    colors: ['var(--habit-2)', 'var(--habit-1)'],
    scenarioIds: ['sp-steps'],
  },
  {
    id: 'tank',
    tabTitle: 'Surge / Conical Tank',
    procId: 'tank',
    title: 'Nonlinear cross-section: gain shifts 7× across level',
    tagline: 'Wide level range — Fixed PI vs Gain Scheduling',
    kinds: ['pid', 'schedule'],
    labels: ['Fixed PI', 'Gain Scheduling'],
    colors: ['var(--habit-2)', 'var(--habit-1)'],
    scenarioIds: ['sp-range', 'sp-steps'],
  },
];

/** Interactive Hero comparison showcasing 3 classic control stories live. */
function HeroChart() {
  const [active, setActive] = useState<ShowcaseId>('hx');
  const sc = SHOWCASES.find((s) => s.id === active) ?? SHOWCASES[0];
  const proc = getProcess(sc.procId);
  const [runs, setRuns] = useState<RunSet[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    const id = window.setTimeout(() => {
      if (cancelled) return;
      const params = defaultParams(proc);
      const computed = sc.kinds.map((k) => {
        let ctrl: ControllerConfig = defaultController(k, proc);
        if (sc.procId === 'tank' && k === 'schedule') {
          ctrl = {
            kind: 'schedule',
            pid: { ...DEFAULT_PID, Kc: 3, Ti: 245, Td: 0 },
            on: 'pv',
            points: [
              { at: 0.4, Kc: 3, Ti: 245, Td: 0 },
              { at: 1.0, Kc: 9.8, Ti: 245, Td: 0 },
              { at: 1.6, Kc: 20, Ti: 245, Td: 0 },
            ],
          };
        }
        return computeRuns({ process: proc.id, params, controller: ctrl }, sc.scenarioIds, false);
      });
      setRuns(computed);
    }, 0);
    return () => {
      cancelled = true;
      window.clearTimeout(id);
    };
  }, [sc, proc]);

  const [c1, c2] = runs ?? [];
  const run1 = c1?.runs[0];
  const run2 = c2?.runs[0];

  return (
    <figure className="ll-hero-fig">
      <div className="ll-hero-tabs" role="tablist" aria-label="Showcase Comparisons">
        {SHOWCASES.map((s) => (
          <button
            key={s.id}
            role="tab"
            aria-selected={active === s.id}
            className={`ll-hero-tab${active === s.id ? ' is-active' : ''}`}
            onClick={() => {
              setActive(s.id);
              setRuns(null);
            }}
          >
            {s.tabTitle}
          </button>
        ))}
      </div>
      <figcaption className="ll-hero-caption">
        <strong>{sc.tagline}</strong>
      </figcaption>
      <div className="ll-hero-plot">
        {run1 && run2 ? (
          <Chart
            label={sc.title}
            height={230}
            x={{ label: 'Time (s)' }}
            y={{ label: `${proc.pv.label} (${proc.pv.unit})` }}
            series={[
              { label: 'Setpoint', color: 'var(--ll-sp)', x: run1.trace.t, y: run1.trace.sp, dash: '5 4', width: 1.3 },
              { label: sc.labels[0], color: sc.colors[0], x: run1.trace.t, y: run1.trace.pvTrue, width: 2 },
              { label: sc.labels[1], color: sc.colors[1], x: run2.trace.t, y: run2.trace.pvTrue, width: 2 },
            ]}
          />
        ) : (
          <div className="ll-hero-loading">Simulating real-time loop response…</div>
        )}
      </div>
    </figure>
  );
}

/** Controllability badge calculated from dead time θ and time constant τ */
function ControllabilityBadge({ summary }: { summary: PlantSummary | null }) {
  if (!summary) return null;
  if (summary.integrating) {
    return <span className="ll-badge is-warn">Integrating process</span>;
  }
  if (summary.tau <= 0) return null;
  const ratio = summary.theta / summary.tau;
  if (ratio < 0.2) {
    return <span className="ll-badge is-good" title="Lag dominant: straightforward for standard PI">Easy (θ/τ = {ratio.toFixed(2)})</span>;
  }
  if (ratio <= 0.8) {
    return <span className="ll-badge" title="Balanced lag and dead time">Moderate (θ/τ = {ratio.toFixed(2)})</span>;
  }
  return <span className="ll-badge is-warn" title="Dead-time dominant: difficult for standard PI">Dead-time dominant (θ/τ = {ratio.toFixed(2)})</span>;
}

export default function Home() {
  const [procFilter, setProcFilter] = useState<'all' | 'pid-wins' | 'escalation'>('all');

  const filteredProcesses = useMemo(() => {
    if (procFilter === 'all') return PROCESSES;
    return PROCESSES.filter((p) => p.family === procFilter);
  }, [procFilter]);

  return (
    <div className="ll ll-home">
      {/* ─── Hero Section ─── */}
      <header className="ll-hero">
        <div>
          <h1>See where PID is enough, and where it isn&rsquo;t.</h1>
          <p>
            Put a controller on a realistic process and run the same tests every time. Each loop is shown the way a
            mechanical engineer, a control engineer and an automation engineer would look at it, down to the SCL.
          </p>
          <div className="ll-actions">
            <Link className="ll-btn is-primary is-large" href="/loop-lab/bench">
              🎛️ Open the Test Bench
            </Link>
            <Link className="ll-btn is-large is-builder-cta" href="/loop-lab/builder">
              🧩 Launch Block Studio
            </Link>
            <Link className="ll-btn is-large is-quiet" href="/loop-lab/cases">
              📖 Guided Case Studies
            </Link>
          </div>
        </div>
        <HeroChart />
      </header>

      {/* ─── 4-Pillar Studio Cards ─── */}
      <section className="ll-paths" aria-label="Studio Pillars">
        <Link className="ll-path" href="/loop-lab/bench">
          <div className="ll-path-icon" aria-hidden>🎛️</div>
          <h2>Test Bench</h2>
          <p>Put any of 14 controllers on 13 realistic physical plants. Auto-tune, inject disturbances, scrub P&amp;ID schematics, and compare scorecards.</p>
          <span className="ll-path-go">Launch Bench</span>
        </Link>
        <Link className="ll-path is-highlight" href="/loop-lab/builder">
          <div className="ll-path-icon" aria-hidden>🧩</div>
          <h2>Block Studio (Simulink Mode)</h2>
          <p>Visually wire transfer functions, PIDs, lead-lag compensators, dead times, nonlinear valves, and scopes on an interactive block canvas.</p>
          <span className="ll-path-go">Launch Block Studio</span>
        </Link>
        <Link className="ll-path" href="/loop-lab/cases">
          <div className="ll-path-icon" aria-hidden>📖</div>
          <h2>Worked Case Studies</h2>
          <p>{CASES.length} step-by-step industrial problems with live simulations and honest engineering verdicts.</p>
          <span className="ll-path-go">Explore Cases</span>
        </Link>
        <div className="ll-path">
          <div className="ll-path-icon" aria-hidden>📚</div>
          <h2>Process &amp; Controller Encyclopedia</h2>
          <p>Deep mechanical, control, and PLC/SCL implementation guides for every plant and every rung of the ladder.</p>
          <div className="ll-path-links">
            <Link className="ll-path-go" href="/loop-lab/processes">{PROCESSES.length} processes</Link>
            <Link className="ll-path-go" href="/loop-lab/controllers">{CONTROLLER_KINDS.length} controllers</Link>
          </div>
        </div>
      </section>

      {/* ─── Interactive Process Showcase Section ─── */}
      <section className="ll-section">
        <div className="ll-section-head">
          <div>
            <h2>Process Plants Showcase</h2>
            <p className="ll-small">Explore plant dynamics, dead time, and nominal metrics across the catalog.</p>
          </div>
          <div className="ll-seg is-small" role="group" aria-label="Process Family Filter">
            <button
              aria-pressed={procFilter === 'all'}
              onClick={() => setProcFilter('all')}
            >
              All ({PROCESSES.length})
            </button>
            <button
              aria-pressed={procFilter === 'pid-wins'}
              onClick={() => setProcFilter('pid-wins')}
            >
              Where PID wins ({PROCESSES.filter((p) => p.family === 'pid-wins').length})
            </button>
            <button
              aria-pressed={procFilter === 'escalation'}
              onClick={() => setProcFilter('escalation')}
            >
              Where PID falls short ({PROCESSES.filter((p) => p.family === 'escalation').length})
            </button>
          </div>
        </div>

        <div className="ll-proc-grid">
          {filteredProcesses.map((p) => {
            const summary = defaultSummary(p);
            return (
              <article key={p.id} className="ll-proc-card">
                <div className="ll-proc-card-head">
                  <span className="ll-proc-icon" aria-hidden>{p.icon}</span>
                  <div>
                    <h3 className="ll-proc-title">
                      <Link href={`/loop-lab/processes/${p.id}`}>{p.name}</Link>
                    </h3>
                    <span className="ll-proc-pv">{p.pv.label} ({p.pv.unit})</span>
                  </div>
                </div>

                <p className="ll-proc-desc">{p.summary}</p>

                {summary && (
                  <div className="ll-dynamics-strip">
                    <div className="ll-dynamics-item" title="Dead time (theta)">
                      <span className="ll-dynamics-label">θ</span>
                      <span className="ll-dynamics-val">{fmt(summary.theta, 2)} s</span>
                    </div>
                    <div className="ll-dynamics-item" title="Time constant (tau)">
                      <span className="ll-dynamics-label">τ</span>
                      <span className="ll-dynamics-val">
                        {summary.integrating ? 'Ramp' : `${fmt(summary.tau, 2)} s`}
                      </span>
                    </div>
                    <div className="ll-dynamics-item" title="Gain (K)">
                      <span className="ll-dynamics-label">K</span>
                      <span className="ll-dynamics-val">
                        {summary.integrating ? fmt(summary.kPrime, 3) : fmt(summary.K, 2)}
                      </span>
                    </div>
                  </div>
                )}

                <div className="ll-proc-card-foot">
                  <ControllabilityBadge summary={summary} />
                  <div className="ll-proc-actions">
                    <Link className="ll-btn is-small" href={`/loop-lab/processes/${p.id}`}>Inspect →</Link>
                    <Link className="ll-btn is-small is-primary" href={benchOn(p.id)}>🎛️ Bench</Link>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      </section>

      {/* ─── Visual Controller Ladder Progression Strip ─── */}
      <section className="ll-section">
        <div className="ll-section-head">
          <div>
            <h2>The Controller Ladder</h2>
            <p className="ll-small">From on-off to model predictive control: climb only as far as your plant demands.</p>
          </div>
          <Link href="/loop-lab/controllers">All 14 Controllers →</Link>
        </div>

        <div className="ll-ladder-tiers">
          {CONTROLLER_GROUPS.map((g) => (
            <div key={g.label} className="ll-ladder-tier">
              <h3 className="ll-ladder-tier-title">{g.label}</h3>
              <div className="ll-ctrl-grid">
                {g.kinds.map((kind) => {
                  const meta = metaOf(kind);
                  const hint = KIND_HINT[kind];
                  return (
                    <Link key={kind} className="ll-ctrl-card" href={`/loop-lab/controllers/${kind}`}>
                      <div className="ll-ctrl-top">
                        <span className="ll-rung-badge" aria-hidden>{meta.rung}</span>
                        <span className="ll-ctrl-icon">{meta.icon}</span>
                        <strong>{meta.short}</strong>
                      </div>
                      <p className="ll-ctrl-hint">{hint}</p>
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ─── Featured Starters Section ─── */}
      <section className="ll-section">
        <div className="ll-section-head">
          <h2>Good places to start</h2>
          <Link href="/loop-lab/cases">All {CASES.length} case studies →</Link>
        </div>
        <div className="ll-rows">
          {STARTERS.map((id) => {
            const c = getCase(id);
            if (!c) return null;
            return (
              <Link key={id} className="ll-row" href={`/loop-lab/cases/${id}`}>
                <span className="ll-row-mark" aria-hidden>{getProcess(c.process).icon}</span>
                <span className="ll-row-text">
                  <strong>{c.title}</strong>
                  <span>{c.question}</span>
                </span>
              </Link>
            );
          })}
        </div>
      </section>
    </div>
  );
}
