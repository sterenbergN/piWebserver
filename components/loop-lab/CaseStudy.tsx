'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { MathText } from '@/components/daily/MathText';
import { getCase, type CasePreset } from '@/lib/loop-lab/content';
import { defaultParams, type ProcessDef } from '@/lib/loop-lab/model';
import { getProcess } from '@/lib/loop-lab/processes';
import { encodeExperiment, type Experiment } from '@/lib/loop-lab/setup';
import { PALETTE, ScorecardTable, TrendPanel } from './Results';
import { useRunsMany } from './useRuns';
import { OperatingPointSteps, RangeTable } from './Views';

const toExperiment = (proc: ProcessDef, preset: CasePreset): Experiment => ({
  process: proc.id,
  params: { ...defaultParams(proc), ...(preset.params as Record<string, number> | undefined) },
  controller: preset.controller,
});

const benchLink = (e: Experiment) => `/loop-lab?setup=${encodeExperiment(e)}#tests`;

/** Presets run through some tests: trends overlaid, scorecards side by side. */
function CaseRuns({ proc, presets, scenarios, colorOf, compact = true }: { proc: ProcessDef; presets: CasePreset[]; scenarios?: string[]; colorOf: (label: string) => string; compact?: boolean }) {
  const exps = useMemo(() => presets.map((p) => toExperiment(proc, p)), [proc, presets]);
  const ids = scenarios ?? proc.scenarios.map((s) => s.id);
  const { results, busy } = useRunsMany(exps, ids, true, 0);
  const [view, setView] = useState(0);
  if (!results) return <div className="ll-empty">{busy ? 'Running the tests…' : ''}</div>;
  const idx = Math.min(view, results[0].runs.length - 1);
  return (
    <div className="ll-card">
      {results[0].runs.length > 1 && (
        <div className="ll-seg" role="tablist" aria-label="Test to plot" style={{ marginBottom: '0.5rem' }}>
          {results[0].runs.map((r, i) => <button key={r.scenario.id} role="tab" aria-selected={idx === i} onClick={() => setView(i)}>{r.scenario.name}</button>)}
        </div>
      )}
      <p className="ll-small" style={{ marginTop: 0 }}>{results[0].runs[idx].scenario.purpose}</p>
      <TrendPanel proc={proc} entries={results.map((r, i) => ({ label: presets[i].label, color: colorOf(presets[i].label), run: r.runs[idx] }))} />
      <ScorecardTable compact={compact} entries={results.map((r, i) => ({ label: presets[i].label, color: colorOf(presets[i].label), score: r.score }))} />
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem', marginTop: '0.6rem' }}>
        {exps.map((e, i) => <Link key={i} className="ll-btn is-small" href={benchLink(e)}>Open “{presets[i].label}” in the bench</Link>)}
      </div>
    </div>
  );
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

  return (
    <div className="ll ll-case animate-fade-in">
      <div className="ll-crumbs"><Link href="/loop-lab">Loop Lab</Link> / Case study</div>
      <div className="ll-head">
        <div>
          <h1>{proc.icon} {study.title}</h1>
          <p>{study.question}</p>
          <p style={{ marginTop: '0.5rem' }}>
            <span className={`ll-badge${study.family === 'pid-wins' ? ' is-good' : ' is-warn'}`}>{study.family === 'pid-wins' ? 'PID is the answer' : 'PID falls short'}</span>{' '}
            <Link className="ll-small" href={`/loop-lab/processes/${proc.id}`}>About the {proc.name.toLowerCase()} →</Link>
          </p>
        </div>
      </div>

      {study.steps.map((step, i) => {
        const last = i === study.steps.length - 1;
        return (
          <section key={step.title} className={`ll-step${last ? ' ll-verdict' : ''}`}>
            <div className="ll-step-num">{last ? 'Verdict' : `Step ${i + 1}`}</div>
            <h2>{step.title}</h2>
            <MathText className="ll-prose">{step.body}</MathText>
            {step.show?.includes('linearization') && baseline && (
              <div className="ll-card"><RangeTable proc={proc} exp={toExperiment(proc, baseline)} /></div>
            )}
            {step.show?.includes('operating-points') && baseline && (
              <div className="ll-card"><OperatingPointSteps proc={proc} exp={toExperiment(proc, baseline)} /></div>
            )}
            {step.presets && step.scenarios && <CaseRuns proc={proc} presets={step.presets} scenarios={step.scenarios} colorOf={colorOf} />}
            {last && allPresets.length > 1 && (
              <>
                <h3 style={{ fontSize: '1rem', margin: '1rem 0 0.5rem' }}>Everything in this case, through every test</h3>
                <CaseRuns proc={proc} presets={allPresets} colorOf={colorOf} compact={false} />
              </>
            )}
          </section>
        );
      })}
    </div>
  );
}
