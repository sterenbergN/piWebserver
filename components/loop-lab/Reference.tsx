'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { MathText, Tex } from '@/components/daily/MathText';
import { benchLink, CONTROLLER_GROUPS, metaOf, PROCESS_GROUPS } from '@/lib/loop-lab/catalog';
import { CASES, CONTROLLER_CONTENT, PROCESS_CONTENT } from '@/lib/loop-lab/content';
import { controllerMeta, defaultController, isAvailable, type ControllerConfig, type ControllerKind, type PidParams } from '@/lib/loop-lab/controllers';
import { defaultParams, type Params, type ProcessId } from '@/lib/loop-lab/model';
import { defaultSummary, plantSummary } from '@/lib/loop-lab/plant';
import { getProcess } from '@/lib/loop-lab/processes';
import { defaultExperiment, type Experiment } from '@/lib/loop-lab/setup';
import { TUNING_RULES } from '@/lib/loop-lab/tuning';
import { useCurrentSection } from './CaseStudy';
import { fmt } from './Chart';
import ComparePanel from './Compare';
import { BlockDiagram } from './Drawings';
import { PlantNow } from './PlantEditor';
import { ScorecardTable, TestTabs, TrendPanel } from './Results';
import { useRunsMany } from './useRuns';
import { AutomationView, CodeTabs, ControlView, MechanicalView } from './Views';

export function ProcessReference({ id }: { id: ProcessId }) {
  const proc = getProcess(id);
  const [params, setParams] = useState<Params>(() => defaultExperiment(id).params);
  useEffect(() => {
    setParams(defaultExperiment(id).params);
  }, [id]);

  const exp: Experiment = useMemo(() => ({
    ...defaultExperiment(id),
    params,
  }), [id, params]);

  const [tab, setTab] = useState<'compare' | 'mechanical' | 'control' | 'automation' | 'tests'>('compare');
  const cases = CASES.filter((c) => c.process === id);

  const defaults = useMemo(() => defaultParams(proc), [proc]);
  const now = useMemo(() => plantSummary(proc, params), [proc, params]);
  const was = useMemo(() => defaultSummary(proc), [proc]);
  const nChanged = proc.params.filter((s) => Math.abs(params[s.key] - defaults[s.key]) > 1e-9 * Math.max(1, Math.abs(defaults[s.key]))).length;

  return (
    <div className="ll">
      <header className="ll-title">
        <div className="ll-crumbs"><Link href="/loop-lab/processes">Processes</Link></div>
        <h1><span aria-hidden>{proc.icon}</span> {proc.name}</h1>
        <p>{proc.summary}</p>
        <div className="ll-actions">
          <Link className="ll-btn is-primary" href={benchLink(exp)}>Open on the bench</Link>
          <Link className="ll-btn" href="/loop-lab/builder">🧩 Build in Block Studio</Link>
          {cases.map((c) => <Link key={c.id} className="ll-btn" href={`/loop-lab/cases/${c.id}`}>Case study: {c.title.split(':').pop()!.trim()}</Link>)}
        </div>
      </header>

      {/* Plant Dynamics Summary Strip */}
      <div className="ll-card" style={{ marginBottom: '1.25rem' }}>
        <div className="ll-card-head">
          <div>
            <h3 style={{ fontSize: '0.98rem', fontWeight: 650 }}>Plant Dynamics at Nominal Point</h3>
            <span className="ll-small">FOPDT dynamics & controllability regime</span>
          </div>
          <div style={{ display: 'flex', gap: '0.45rem', flexWrap: 'wrap', alignItems: 'center' }}>
            <Link className="ll-btn is-primary is-small" href={benchLink(exp)}>Open on the bench</Link>
            <Link className="ll-btn is-small" href="/loop-lab/builder">🧩 Build in Block Studio</Link>
            {nChanged > 0 && (
              <button className="ll-link" style={{ fontSize: '0.78rem' }} onClick={() => setParams(defaults)}>
                Reset {nChanged} change{nChanged > 1 ? 's' : ''}
              </button>
            )}
          </div>
        </div>
        <PlantNow proc={proc} now={now} was={nChanged > 0 ? was : null} />
      </div>

      <div className="ll-verdict-box">
        <div className="ll-step-num">Verdict: {proc.family === 'pid-wins' ? 'PID is the answer' : 'PID falls short'}</div>
        <MathText className="ll-prose">{PROCESS_CONTENT[id].verdict}</MathText>
      </div>

      <div className="ll-tabs" role="tablist" aria-label="Perspective" style={{ marginTop: '1.5rem' }}>
        <button role="tab" aria-selected={tab === 'compare'} onClick={() => setTab('compare')}>Compare controllers</button>
        <button role="tab" aria-selected={tab === 'mechanical'} onClick={() => setTab('mechanical')}>Mechanical</button>
        <button role="tab" aria-selected={tab === 'control'} onClick={() => setTab('control')}>Control</button>
        <button role="tab" aria-selected={tab === 'automation'} onClick={() => setTab('automation')}>Automation</button>
        <button role="tab" aria-selected={tab === 'tests'} onClick={() => setTab('tests')}>Test scripts</button>
      </div>
      <div className="ll-view ll-flat">
        {tab === 'compare' && <ComparePanel proc={proc} params={exp.params} plantChanges={nChanged} />}
        {tab === 'mechanical' && <MechanicalView proc={proc} exp={exp} onParams={setParams} />}
        {tab === 'control' && <ControlView proc={proc} exp={exp} />}
        {tab === 'automation' && <AutomationView proc={proc} exp={exp} />}
        {tab === 'tests' && (
          <div>
            <p className="ll-small" style={{ marginBottom: '0.75rem' }}>Every controller on this process runs exactly these scripts, so their scorecards can be compared.</p>
            {proc.scenarios.map((s) => (
              <div key={s.id} className="ll-script">
                <strong>{s.name}</strong> <span className="ll-small">· {s.duration >= 600 ? `${Math.round(s.duration / 60)} min` : `${s.duration} s`}</span>
                <p>{s.purpose}</p>
              </div>
            ))}
          </div>
        )}
        {tab !== 'compare' && <p className="ll-note" style={{ marginTop: '1.5rem' }}>These views use the default PI tuning. Change the controller on the bench to see its own analysis and code.</p>}
      </div>
    </div>
  );
}

/** The process each rung is best seen on. */
const SHOWN_ON: Partial<Record<ControllerKind, ProcessId>> = {
  schedule: 'tank', characterized: 'tank', feedforward: 'hx', cascade: 'hx', smith: 'feeder', override: 'hx', ratio: 'blend',
  statefb: 'crane', multiloop: 'mixing', mpc: 'mixing', adrc: 'batch', adaptive: 'batch',
};

const DOC_SECTIONS = [
  { id: 'theory', label: 'Theory' },
  { id: 'fit', label: 'When it works' },
  { id: 'tuning', label: 'How to tune it' },
  { id: 'implementation', label: 'How to implement it' },
  { id: 'platforms', label: 'Siemens and elsewhere' },
  { id: 'example', label: 'On a process' },
];

export function ControllerReference({ kind }: { kind: ControllerKind }) {
  const meta = controllerMeta(kind);
  const c = CONTROLLER_CONTENT[kind];
  const [procId, setProcId] = useState<ProcessId>(SHOWN_ON[kind] ?? 'flow');
  const proc = getProcess(procId);
  const [ctrl, setCtrl] = useState<ControllerConfig>(() => defaultController(kind, getProcess(SHOWN_ON[kind] ?? 'flow')));
  const [scenarioIdx, setScenarioIdx] = useState(0);

  useEffect(() => {
    setCtrl(defaultController(kind, getProcess(procId)));
    setScenarioIdx(0);
  }, [kind, procId]);

  const thisExp: Experiment = useMemo(() => ({
    process: procId,
    params: defaultParams(proc),
    controller: ctrl,
  }), [procId, proc, ctrl]);

  const baselineCtrl = useMemo(() => defaultController('pid', proc), [proc]);
  const baselineExp: Experiment = useMemo(() => ({
    process: procId,
    params: defaultParams(proc),
    controller: baselineCtrl,
  }), [procId, proc, baselineCtrl]);

  const exps = useMemo(() => [thisExp, baselineExp], [thisExp, baselineExp]);
  const scenarioIds = useMemo(() => proc.scenarios.map((s) => s.id), [proc]);
  const { results, busy } = useRunsMany(exps, scenarioIds, false, 40);

  const activeIdx = results ? Math.min(scenarioIdx, results[0].runs.length - 1) : 0;
  const current = useCurrentSection(DOC_SECTIONS.map((s) => s.id));
  const choices = PROCESS_GROUPS.map((g) => ({ ...g, list: g.list.filter((p) => isAvailable(p, kind)) })).filter((g) => g.list.length);

  // Extract PID parameters if controller has them
  const pidParams: PidParams | null = 'pid' in ctrl ? ctrl.pid : ('outer' in ctrl ? ctrl.outer : null);

  const updatePidGain = (field: 'Kc' | 'Ti' | 'Td', value: number) => {
    const v = Math.max(field === 'Td' ? 0 : 0.001, Number(value));
    if ('pid' in ctrl) {
      setCtrl({ ...ctrl, pid: { ...ctrl.pid, [field]: v } });
    } else if ('outer' in ctrl) {
      setCtrl({ ...ctrl, outer: { ...ctrl.outer, [field]: v } });
    }
  };

  const nudgeGain = (field: 'Kc' | 'Ti' | 'Td', factor: number) => {
    if (!pidParams) return;
    const cur = pidParams[field];
    if (field === 'Td' && cur === 0 && factor > 1) {
      updatePidGain('Td', 0.5);
      return;
    }
    updatePidGain(field, Number((cur * factor).toPrecision(4)));
  };

  return (
    <div className="ll">
      <div className="ll-read">
        <nav className="ll-rail" aria-label="The controller ladder">
          <div className="ll-rail-title">On this page</div>
          <ul>
            {DOC_SECTIONS.map((s) => <li key={s.id}><a href={`#${s.id}`} aria-current={current === s.id ? 'location' : undefined}>{s.label}</a></li>)}
          </ul>
          {CONTROLLER_GROUPS.map((g) => (
            <div key={g.label}>
              <div className="ll-rail-title">{g.label}</div>
              <ul>
                {g.kinds.map((k) => (
                  <li key={k}><Link href={`/loop-lab/controllers/${k}`} aria-current={k === kind ? 'page' : undefined}><span className="ll-rail-num">{metaOf(k).rung}</span>{metaOf(k).short}</Link></li>
                ))}
              </ul>
            </div>
          ))}
        </nav>
        <div>
          <header className="ll-title">
            <div className="ll-crumbs"><Link href="/loop-lab/controllers">The controller ladder</Link> · rung {meta.rung}</div>
            <h1>{meta.name}</h1>
            <p>{c.summary}</p>
            <div className="ll-actions">
              <Link className="ll-btn is-primary" href={benchLink(thisExp)}>Try it on the bench</Link>
              <Link className="ll-btn" href="/loop-lab/builder">🧩 Open Block Studio</Link>
            </div>
          </header>

          <section id="theory" className="ll-doc-section">
            <h2>Theory</h2>
            <MathText className="ll-prose">{c.theory}</MathText>
          </section>
          <section id="fit" className="ll-doc-section">
            <h2>When it works, and when it breaks</h2>
            <div className="ll-split">
              <div><div className="ll-sub">Works</div><ul className="ll-list">{c.works.map((w) => <li key={w}><MathText>{w}</MathText></li>)}</ul></div>
              <div><div className="ll-sub">Breaks</div><ul className="ll-list">{c.breaks.map((w) => <li key={w}><MathText>{w}</MathText></li>)}</ul></div>
            </div>
          </section>
          <section id="tuning" className="ll-doc-section">
            <h2>How to tune it</h2>
            <MathText className="ll-prose">{c.tuning}</MathText>
            {kind !== 'onoff' && (
              <details className="ll-more">
                <summary>The tuning rules in the lab</summary>
                {TUNING_RULES.map((r) => (
                  <div key={r.id} className="ll-doc-rule">
                    <strong>{r.name}</strong> <span className="ll-small">({r.types.join(', ')})</span>
                    <div className="ll-tex-block"><Tex latex={r.formula} display /></div>
                    <p className="ll-small">{r.assumptions}</p>
                  </div>
                ))}
              </details>
            )}
          </section>
          <section id="implementation" className="ll-doc-section">
            <h2>How to implement it</h2>
            <MathText className="ll-prose">{c.implementation}</MathText>
          </section>
          <section id="platforms" className="ll-doc-section">
            <h2>Siemens and elsewhere</h2>
            <div className="ll-split">
              <div><div className="ll-sub">Siemens</div><MathText className="ll-prose">{c.siemens}</MathText></div>
              <div><div className="ll-sub">Elsewhere</div><MathText className="ll-prose">{c.broad}</MathText></div>
            </div>
          </section>
          <section id="example" className="ll-doc-section">
            <div className="ll-part-head">
              <div>
                <h2 style={{ fontSize: '1.15rem', fontWeight: 650 }}>Interactive Controller Sandbox</h2>
                <p className="ll-small" style={{ margin: '0.15rem 0 0' }}>
                  Test and tune {meta.name} live on a process, benchmark against baseline PI, and inspect the resulting code.
                </p>
              </div>
              <label className="ll-field" style={{ flexDirection: 'row', alignItems: 'center', gap: '0.5rem' }}>
                <span style={{ fontSize: '0.82rem', fontWeight: 600 }}>Process:</span>
                <select value={procId} onChange={(e) => setProcId(e.target.value as ProcessId)}>
                  {choices.map((g) => (
                    <optgroup key={g.label} label={g.label}>
                      {g.list.map((p) => <option key={p.id} value={p.id}>{p.icon} {p.name}</option>)}
                    </optgroup>
                  ))}
                </select>
              </label>
            </div>

            {/* Live PID Gains Tuner */}
            {pidParams && (
              <div className="ll-card" style={{ marginBottom: '1rem', background: 'var(--surface-hover)' }}>
                <div className="ll-card-head" style={{ marginBottom: '0.55rem' }}>
                  <div>
                    <h4 style={{ fontSize: '0.9rem', fontWeight: 650 }}>
                      Interactive Gains ({'pid' in ctrl ? 'Primary Loop' : 'Outer Loop'})
                    </h4>
                    <span className="ll-small">Drag sliders or nudge gains to observe the closed-loop transient response</span>
                  </div>
                  <button
                    type="button"
                    className="ll-btn is-small"
                    onClick={() => setCtrl(defaultController(kind, proc))}
                    title="Reset to default SIMC auto-tuning for this process"
                  >
                    ↺ Auto-tune (SIMC)
                  </button>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '0.75rem 1.25rem' }}>
                  {/* Kc */}
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.78rem', marginBottom: '0.2rem' }}>
                      <span><strong>Kc (gain):</strong> {fmt(pidParams.Kc, 3)}</span>
                      <div style={{ display: 'flex', gap: '0.2rem' }}>
                        <button type="button" className="ll-btn is-small" style={{ minHeight: '22px', padding: '0 0.35rem', fontSize: '0.7rem' }} onClick={() => nudgeGain('Kc', 0.8)}>−20%</button>
                        <button type="button" className="ll-btn is-small" style={{ minHeight: '22px', padding: '0 0.35rem', fontSize: '0.7rem' }} onClick={() => nudgeGain('Kc', 1.2)}>+20%</button>
                      </div>
                    </div>
                    <input
                      type="range"
                      min={0.01}
                      max={Math.max(10, Math.ceil(pidParams.Kc * 2.5))}
                      step={0.01}
                      value={pidParams.Kc}
                      onChange={(e) => updatePidGain('Kc', Number(e.target.value))}
                      style={{ width: '100%' }}
                      aria-label="Proportional gain Kc"
                    />
                  </div>
                  {/* Ti */}
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.78rem', marginBottom: '0.2rem' }}>
                      <span><strong>Ti (integral):</strong> {fmt(pidParams.Ti, 3)} s</span>
                      <div style={{ display: 'flex', gap: '0.2rem' }}>
                        <button type="button" className="ll-btn is-small" style={{ minHeight: '22px', padding: '0 0.35rem', fontSize: '0.7rem' }} onClick={() => nudgeGain('Ti', 0.8)}>−20%</button>
                        <button type="button" className="ll-btn is-small" style={{ minHeight: '22px', padding: '0 0.35rem', fontSize: '0.7rem' }} onClick={() => nudgeGain('Ti', 1.2)}>+20%</button>
                      </div>
                    </div>
                    <input
                      type="range"
                      min={0.1}
                      max={Math.max(30, Math.ceil(pidParams.Ti * 2.5))}
                      step={0.1}
                      value={pidParams.Ti}
                      onChange={(e) => updatePidGain('Ti', Number(e.target.value))}
                      style={{ width: '100%' }}
                      aria-label="Integral time Ti"
                    />
                  </div>
                  {/* Td */}
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.78rem', marginBottom: '0.2rem' }}>
                      <span><strong>Td (derivative):</strong> {fmt(pidParams.Td, 3)} s</span>
                      <div style={{ display: 'flex', gap: '0.2rem' }}>
                        <button type="button" className="ll-btn is-small" style={{ minHeight: '22px', padding: '0 0.35rem', fontSize: '0.7rem' }} onClick={() => nudgeGain('Td', 0.8)}>−20%</button>
                        <button type="button" className="ll-btn is-small" style={{ minHeight: '22px', padding: '0 0.35rem', fontSize: '0.7rem' }} onClick={() => nudgeGain('Td', 1.2)}>+20%</button>
                      </div>
                    </div>
                    <input
                      type="range"
                      min={0}
                      max={Math.max(5, Math.ceil((pidParams.Td || 1) * 2.5))}
                      step={0.05}
                      value={pidParams.Td}
                      onChange={(e) => updatePidGain('Td', Number(e.target.value))}
                      style={{ width: '100%' }}
                      aria-label="Derivative time Td"
                    />
                  </div>
                </div>
              </div>
            )}

            {/* Live Benchmark Simulation vs Baseline PI */}
            <div className="ll-card" style={{ marginBottom: '1.25rem' }}>
              <div className="ll-card-head" style={{ marginBottom: '0.4rem' }}>
                <h3 style={{ fontSize: '0.96rem', fontWeight: 650 }}>
                  Closed-Loop Response: {meta.short} vs Baseline PI
                </h3>
                {busy && <span className="ll-busy">Simulating…</span>}
              </div>

              {results && results[0]?.runs.length > 1 && (
                <TestTabs tests={results[0].score.tests} runs={results[0].runs} value={activeIdx} onChange={setScenarioIdx} />
              )}

              {results && (
                <>
                  <p className="ll-purpose" style={{ marginTop: results[0].runs.length > 1 ? '0.45rem' : 0 }}>
                    {results[0].runs[activeIdx].scenario.purpose}
                  </p>
                  <div style={{ marginTop: '0.75rem' }}>
                    <TrendPanel
                      proc={proc}
                      entries={[
                        { label: `${meta.short} (This controller)`, color: 'var(--habit-1)', run: results[0].runs[activeIdx] },
                        { label: 'Baseline PI', color: 'var(--muted)', run: results[1].runs[activeIdx] },
                      ]}
                    />
                  </div>
                  <div className="ll-part">
                    <ScorecardTable
                      compact
                      proc={proc}
                      entries={[
                        { label: `${meta.short} (This)`, color: 'var(--habit-1)', score: results[0].score },
                        { label: 'Baseline PI', color: 'var(--muted)', score: results[1].score },
                      ]}
                    />
                  </div>
                </>
              )}
              {!results && busy && <div className="ll-empty">Running test scenarios…</div>}
            </div>

            <div className="ll-sub">Block Diagram</div>
            <BlockDiagram proc={proc} config={ctrl} />
            <div className="ll-sub">Generated code</div>
            <CodeTabs proc={proc} exp={thisExp} />
            <div className="ll-actions" style={{ marginTop: '1.25rem' }}>
              <Link className="ll-btn is-primary" href={benchLink(thisExp)}>Try it on the bench</Link>
              <Link className="ll-btn" href="/loop-lab/builder">🧩 Open Block Studio</Link>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
