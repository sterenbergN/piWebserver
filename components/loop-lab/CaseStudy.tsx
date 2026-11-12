'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { MathText } from '@/components/daily/MathText';
import { benchLink } from '@/lib/loop-lab/catalog';
import { CASES, getCase, type CasePreset } from '@/lib/loop-lab/content';
import { defaultParams, type ProcessDef } from '@/lib/loop-lab/model';
import { getProcess } from '@/lib/loop-lab/processes';
import type { Experiment } from '@/lib/loop-lab/setup';
import { PALETTE, ScorecardTable, TestTabs, TrendPanel } from './Results';
import { useRunsMany } from './useRuns';
import { OperatingPointSteps, RangeTable } from './Views';
import { OscillationReport, diagnoseRun } from './Oscillation';

const toExperiment = (proc: ProcessDef, preset: CasePreset): Experiment => ({
  process: proc.id,
  params: { ...defaultParams(proc), ...(preset.params as Record<string, number> | undefined) },
  controller: preset.controller,
});

/** Presets run through some tests: trends overlaid, scorecards side by side. */
function CaseRuns({ proc, presets, scenarios, colorOf, compact = true, diagnose = false }: { proc: ProcessDef; presets: CasePreset[]; scenarios?: string[]; colorOf: (label: string) => string; compact?: boolean; diagnose?: boolean }) {
  const exps = useMemo(() => presets.map((p) => toExperiment(proc, p)), [proc, presets]);
  const ids = scenarios ?? proc.scenarios.map((s) => s.id);
  const { results, busy } = useRunsMany(exps, ids, true, 0);
  const [view, setView] = useState(0);
  if (!results) return <div className="ll-empty">{busy ? 'Running the tests…' : ''}</div>;
  const idx = Math.min(view, results[0].runs.length - 1);
  return (
    <div className="ll-card">
      {results[0].runs.length > 1 && <TestTabs tests={results[0].score.tests} runs={results[0].runs} value={idx} onChange={setView} />}
      <p className="ll-purpose" style={{ marginTop: results[0].runs.length > 1 ? undefined : 0 }}>{results[0].runs[idx].scenario.purpose}</p>
      <div style={{ marginTop: '0.75rem' }}>
        <TrendPanel proc={proc} entries={results.map((r, i) => ({ label: presets[i].label, color: colorOf(presets[i].label), run: r.runs[idx] }))} />
      </div>
      {diagnose && (
        <div className="ll-part">
          <h3 style={{ fontSize: '0.95rem', margin: '0 0 0.3rem' }}>Is it cycling? Why?</h3>
          {results.map((r, i) => <OscillationReport key={presets[i].label} label={results.length > 1 ? presets[i].label : undefined} d={diagnoseRun(proc, exps[i], r.runs[idx])} />)}
        </div>
      )}
      <div className="ll-part">
        <ScorecardTable compact={compact} proc={proc} entries={results.map((r, i) => ({ label: presets[i].label, color: colorOf(presets[i].label), score: r.score }))} />
      </div>
      <div className="ll-open-links">
        {exps.map((e, i) => <Link key={i} className="ll-btn is-small" href={benchLink(e)}>Open “{presets[i].label}” on the bench</Link>)}
      </div>
    </div>
  );
}

/** Which of the page's sections is being read. */
export function useCurrentSection(ids: string[]) {
  const [current, setCurrent] = useState(ids[0]);
  const key = ids.join(' ');
  useEffect(() => {
    // The last section whose top has passed the upper quarter of the window.
    const update = () => {
      const line = window.innerHeight * 0.25;
      let at = key.split(' ')[0];
      for (const id of key.split(' ')) {
        const el = document.getElementById(id);
        if (el && el.getBoundingClientRect().top <= line) at = id;
      }
      setCurrent(at);
    };
    update();
    window.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);
    return () => {
      window.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
    };
  }, [key]);
  return current;
}

export default function CaseStudy({ id }: { id: string }) {
  const study = getCase(id)!;
  const proc = getProcess(study.process);
  // Every distinct setup in the case keeps one colour throughout.
  const seen = new Map<string, CasePreset>();
  for (const s of study.steps) for (const p of s.presets ?? []) if (!seen.has(p.label)) seen.set(p.label, p);
  const allPresets = [...seen.values()];
  const colorOf = (label: string) => PALETTE[Math.max(0, allPresets.findIndex((p) => p.label === label)) % PALETTE.length];
  const baseline = allPresets[0];
  const at = CASES.findIndex((c) => c.id === id);
  const prev = CASES[at - 1], next = CASES[at + 1];
  const sectionIds = study.steps.map((_, i) => `step-${i + 1}`);
  const current = useCurrentSection(sectionIds);

  return (
    <div className="ll ll-case">
      <div className="ll-read">
        <nav className="ll-rail" aria-label="Steps in this case">
          <ol>
            {study.steps.map((step, i) => {
              const last = i === study.steps.length - 1;
              return (
                <li key={step.title}>
                  <a href={`#step-${i + 1}`} aria-current={current === `step-${i + 1}` ? 'location' : undefined}>
                    <span className="ll-rail-num">{last ? '✓' : i + 1}</span>{last ? 'Verdict' : step.title}
                  </a>
                </li>
              );
            })}
          </ol>
        </nav>
        <div>
          <header className="ll-title">
            <div className="ll-crumbs"><Link href="/loop-lab/cases">Case studies</Link></div>
            <h1>{study.title}</h1>
            <p>{study.question}</p>
            <div className="ll-title-meta" style={{ gap: '0.5rem 0.85rem' }}>
              <Link className="ll-badge" href={`/loop-lab/processes/${proc.id}`} style={{ textDecoration: 'none', color: 'var(--foreground)' }}>
                <span>{proc.icon}</span> <strong>{proc.name}</strong>
              </Link>
              <span className={`ll-badge${study.family === 'pid-wins' ? ' is-good' : ' is-warn'}`}>{study.family === 'pid-wins' ? 'PID is the answer' : 'PID falls short'}</span>
              <span className="ll-badge">{study.steps.length} guided steps</span>
            </div>
            <div className="ll-actions">
              {baseline && <Link className="ll-btn is-primary is-small" href={benchLink(toExperiment(proc, baseline))}>Open Baseline on Bench</Link>}
              <Link className="ll-btn is-small" href="/loop-lab/builder">🧩 Block Studio</Link>
            </div>
          </header>

          {study.steps.map((step, i) => {
            const last = i === study.steps.length - 1;
            const text = (
              <>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.5rem', marginBottom: '0.2rem' }}>
                  <div className="ll-step-num">{last ? 'Verdict' : `Step ${i + 1}`}</div>
                  <span className="ll-badge" style={{ fontSize: '0.72rem', padding: '0.05rem 0.45rem' }}>Step {i + 1} of {study.steps.length}</span>
                </div>
                <h2>{step.title}</h2>
                <MathText className="ll-prose">{step.body}</MathText>
              </>
            );
            return (
              <section key={step.title} id={`step-${i + 1}`} className="ll-step">
                {last ? <div className="ll-verdict-box">{text}</div> : text}
                {step.show?.includes('linearization') && baseline && (
                  <div className="ll-card"><RangeTable proc={proc} exp={toExperiment(proc, baseline)} /></div>
                )}
                {step.show?.includes('operating-points') && baseline && (
                  <div className="ll-card"><OperatingPointSteps proc={proc} exp={toExperiment(proc, baseline)} /></div>
                )}
                {step.presets && (
                  <>
                    {step.presets.length > 1 && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', flexWrap: 'wrap', margin: '0.9rem 0 0.35rem', fontSize: '0.78rem' }}>
                        <span className="ll-muted">Comparing in this step:</span>
                        {step.presets.map((p) => (
                          <span key={p.label} className="ll-chip" style={{ fontSize: '0.74rem', padding: '0.05rem 0.45rem' }}>
                            <span className="ll-swatch" style={{ background: colorOf(p.label) }} />
                            <strong>{p.label}</strong>
                          </span>
                        ))}
                      </div>
                    )}
                    {step.scenarios && <CaseRuns proc={proc} presets={step.presets} scenarios={step.scenarios} colorOf={colorOf} diagnose={step.show?.includes('oscillation')} />}
                  </>
                )}
                {last && allPresets.length > 1 && (
                  <>
                    <h3 style={{ fontSize: '1rem', fontWeight: 650, margin: '1.5rem 0 0.6rem' }}>Everything in this case, through every test</h3>
                    <CaseRuns proc={proc} presets={allPresets} colorOf={colorOf} compact={false} />
                  </>
                )}
              </section>
            );
          })}

          <nav className="ll-case-next" aria-label="Other case studies">
            {prev && <Link href={`/loop-lab/cases/${prev.id}`}><span>Previous</span>{prev.title}</Link>}
            {next && <Link className="is-next" href={`/loop-lab/cases/${next.id}`}><span>Next</span>{next.title}</Link>}
          </nav>
        </div>
      </div>
    </div>
  );
}
